/**
 * Docker service: build images from project context and run containers (PRD §5.4).
 */

import Docker from 'dockerode';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as stream from 'stream';
import type { Project } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { DOCKERFILE_TEMPLATES, CONTAINER_PORTS, type DockerfileProjectType, injectNextPublicBuildArgs } from './dockerfile.templates';
import { patchNextConfig } from './nextjs-config-patcher';

const log = createLogger('docker');

function isPortConflictError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('port is already allocated') || msg.includes('address already in use');
}

const CONTAINER_RESOURCES: Record<string, { memory: number; cpuShares: number }> = {
  STATIC:  { memory: 128 * 1024 * 1024,  cpuShares: 256  },
  NODEJS:  { memory: 512 * 1024 * 1024,  cpuShares: 1024 },
  NEXTJS:  { memory: 1024 * 1024 * 1024, cpuShares: 1024 },
  DJANGO:  { memory: 512 * 1024 * 1024,  cpuShares: 512  },
  REACT:   { memory: 128 * 1024 * 1024,  cpuShares: 256  },
  FASTAPI: { memory: 512 * 1024 * 1024,  cpuShares: 512  },
  FLASK:   { memory: 256 * 1024 * 1024,  cpuShares: 512  },
  VUE:     { memory: 128 * 1024 * 1024,  cpuShares: 256  },
  SVELTE:  { memory: 128 * 1024 * 1024,  cpuShares: 256  },
  ANDROID: { memory: 4 * 1024 * 1024 * 1024, cpuShares: 2048 },
};

export interface DockerServiceConfig {
  socketPath?: string;
  memoryLimitBytes?: number;
  cpuShares?: number;
}

export class DockerService {
  private docker: Docker;
  private memoryLimitBytes: number;
  private cpuShares: number;

  constructor (config: DockerServiceConfig = {}) {
    const socketPath =
      config.socketPath ?? getConfig().DOCKER_SOCKET ?? '/var/run/docker.sock';
    this.docker = new Docker({ socketPath });
    this.memoryLimitBytes = config.memoryLimitBytes ?? 512 * 1024 * 1024;
    this.cpuShares = config.cpuShares ?? 1024;
  }

  /**
   * Returns Dockerfile content for the given project type.
   * For NEXTJS projects, injects ARG/ENV lines for NEXT_PUBLIC_* build args.
   */
  getDockerfileForProject(project: Project, buildArgKeys: string[] = []): string {
    const key =
      project.type in DOCKERFILE_TEMPLATES ? project.type : 'STATIC';
    let template = DOCKERFILE_TEMPLATES[key as keyof typeof DOCKERFILE_TEMPLATES];
    if (key === 'NEXTJS') {
      template = injectNextPublicBuildArgs(template, buildArgKeys);
    }
    return template;
  }

  /**
   * Writes Dockerfile to context path, then builds image using dockerode.
   * Context path must contain cloned repo files.
   * buildArgs are passed as Docker build args (used for NEXT_PUBLIC_* vars).
   */
  async buildImage(
    project: Project,
    contextPath: string,
    buildArgs: Record<string, string> = {},
    secretValues: string[] = [],
    onLog?: (line: string) => void,
    platform?: string,
  ): Promise<string> {
    const imageName = `dropdeploy/${project.slug}:latest`;
    const dockerfilePath = path.join(contextPath, 'Dockerfile');
    const hasCustomDockerfile = await fs.promises.access(dockerfilePath).then(() => true).catch(() => false);
    if (hasCustomDockerfile) {
      // Strip BuildKit-only directives so the classic builder doesn't choke on
      // user-supplied Dockerfiles that contain `# syntax=...` or `--mount=...`.
      let content = await fs.promises.readFile(dockerfilePath, 'utf8');
      content = this.stripBuildKitDirectives(content);
      if (project.type === 'ANDROID') {
        content = this.injectPlatform(content, 'linux/amd64');
      }
      await fs.promises.writeFile(dockerfilePath, content, 'utf8');
    } else {
      let dockerfile = this.getDockerfileForProject(project, Object.keys(buildArgs));
      if (project.type === 'ANDROID') {
        dockerfile = this.injectPlatform(dockerfile, 'linux/amd64');
      }
      await fs.promises.writeFile(dockerfilePath, dockerfile, 'utf8');
    }

    // Write .dockerignore to prevent .env files from leaking into image
    await this.writeDockerignore(contextPath);

    // Patch Next.js config to skip lint/type errors during build
    if (project.type === 'NEXTJS') {
      await patchNextConfig(contextPath);
    }

    log.info('Building image', { imageName });

    // Build a scrubber to redact secret values from build output
    const scrub = this.buildScrubber(secretValues);

    // Use Docker CLI with BuildKit for platform-specific builds (e.g. Android on ARM hosts).
    // The classic dockerode builder ignores --platform in FROM directives.
    if (platform) {
      await this.buildImageWithCli(imageName, contextPath, buildArgs, platform, scrub, onLog);
    } else {
      await this.buildImageWithDockerode(imageName, contextPath, buildArgs, scrub, onLog);
    }

    // Verify the image exists (Docker build can "succeed" from stream perspective but fail to produce an image).
    try {
      await this.docker.getImage(imageName).inspect();
    } catch {
      throw new Error(
        'Docker build did not produce an image. For Node.js: ensure package.json has a "start" script (e.g. "node index.js"). Check your repo and try again.'
      );
    }

    return imageName;
  }

  /**
   * Creates and starts a container from the image; returns the host port.
   * Static projects expose 80, Node/Next expose 3000.
   */
  async runContainer(
    imageName: string,
    projectType: string,
    containerName?: string,
    envVars: Record<string, string> = {},
    excludePorts: number[] = [],
  ): Promise<number> {
    try {
      await this.docker.getImage(imageName).inspect();
    } catch {
      throw new Error(
        `Image ${imageName} was not found. The Docker build likely failed. For Node.js: ensure package.json has a "start" script (e.g. "node index.js") and that the repo builds. Check deployment logs.`
      );
    }

    // Stop and remove existing container with the same name (redeploy scenario)
    if (containerName) {
      try {
        const existing = this.docker.getContainer(containerName);
        const info = await existing.inspect();
        if (info.State.Running) {
          await existing.stop();
        }
        await existing.remove();
      } catch {
        // Container doesn't exist — that's fine
      }
    }

    const containerPort = CONTAINER_PORTS[projectType as DockerfileProjectType] ?? 3000;

    // Convert env vars to Docker format: ["KEY=value", ...]
    const envArray = Object.entries(envVars).map(
      ([key, value]) => `${key}=${value}`,
    );

    const resources = CONTAINER_RESOURCES[projectType] ?? {
      memory: this.memoryLimitBytes,
      cpuShares: this.cpuShares,
    };

    const tried = new Set<number>(excludePorts);
    for (let attempt = 0; attempt < 3; attempt++) {
      const hostPort = await this.findAvailablePort([...tried]);
      tried.add(hostPort);

      const container = await this.docker.createContainer({
        Image: imageName,
        name: containerName,
        Env: envArray.length > 0 ? envArray : undefined,
        ExposedPorts: { [`${containerPort}/tcp`]: {} },
        HostConfig: {
          PortBindings: {
            [`${containerPort}/tcp`]: [{ HostPort: String(hostPort) }],
          },
          Memory: resources.memory,
          CpuShares: resources.cpuShares,
          RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
        },
      });

      try {
        await container.start();
        return hostPort;
      } catch (err) {
        await container.remove().catch(() => {});
        if (!isPortConflictError(err) || attempt >= 2) throw err;
        log.warn('Port conflict on start, retrying', { hostPort, attempt: attempt + 1 });
      }
    }
    throw new Error('Failed to start container after 3 port allocation attempts');
  }

  /**
   * Build using Docker CLI with BuildKit — required for --platform to work correctly.
   */
  private async buildImageWithCli(
    imageName: string,
    contextPath: string,
    buildArgs: Record<string, string>,
    platform: string,
    scrub: (text: string) => string,
    onLog?: (line: string) => void,
  ): Promise<void> {
    const args = ['build', '--platform', platform, '-t', imageName];
    for (const [key, value] of Object.entries(buildArgs)) {
      args.push('--build-arg', `${key}=${value}`);
    }
    args.push(contextPath);

    const { spawn } = await import('child_process');
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('docker', args, {
        env: { ...process.env, DOCKER_BUILDKIT: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const buildLog: string[] = [];
      const handleData = (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          const now = new Date();
          const ts = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}]`;
          const formatted = `${ts} ${scrub(line)}`;
          buildLog.push(formatted);
          onLog?.(formatted);
        }
      };

      proc.stdout.on('data', handleData);
      proc.stderr.on('data', handleData);

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const tail = buildLog.slice(-20).join('\n');
          reject(new Error(`Docker build failed with exit code ${code}\n\nBuild output (last 20 lines):\n${tail}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Build using dockerode (classic builder) — used for non-platform-specific builds.
   */
  private async buildImageWithDockerode(
    imageName: string,
    contextPath: string,
    buildArgs: Record<string, string>,
    scrub: (text: string) => string,
    onLog?: (line: string) => void,
  ): Promise<void> {
    const buildStream = await this.docker.buildImage(
      { context: contextPath, src: ['.'] },
      {
        t: imageName,
        ...(Object.keys(buildArgs).length > 0 ? { buildargs: buildArgs } : {}),
      } as Record<string, unknown>,
    );

    const buildLog: string[] = [];
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        buildStream,
        (err: Error | null, output: Array<{ stream?: string; error?: string; errorDetail?: { message?: string } }>) => {
          if (err) {
            reject(err);
            return;
          }
          const buildError = output?.find((o) => o.error ?? o.errorDetail);
          if (buildError) {
            const msg = scrub(
              buildError.error ??
              buildError.errorDetail?.message ??
              'Docker build failed',
            );
            const tail = buildLog.slice(-20).join('');
            reject(new Error(`${msg}\n\nBuild output (last 20 lines):\n${tail}`));
            return;
          }
          resolve();
        },
        (event: { stream?: string; error?: string }) => {
          if (event.stream) {
            const now = new Date();
            const ts = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}]`;
            const formatted = `${ts} ${scrub(event.stream)}`;
            buildLog.push(formatted);
            onLog?.(formatted);
          }
        }
      );
    });
  }

  /**
   * Returns a function that replaces all secret values in a string with [REDACTED].
   * Only scrubs values that are 3+ characters to avoid false positives.
   */
  private buildScrubber(secretValues: string[]): (text: string) => string {
    const meaningful = secretValues.filter((v) => v.length >= 3);
    if (meaningful.length === 0) return (text) => text;

    // Escape regex special chars and sort longest-first for greedy matching
    const escaped = meaningful
      .sort((a, b) => b.length - a.length)
      .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(escaped.join('|'), 'g');

    return (text: string) => text.replace(pattern, '[REDACTED]');
  }

  /**
   * Appends .env* exclusions to .dockerignore to prevent secret leakage.
   */
  private async writeDockerignore(contextPath: string): Promise<void> {
    const ignorePath = path.join(contextPath, '.dockerignore');
    const envIgnore = '\n# Prevent .env secret leakage\n.env*\n';
    try {
      const existing = await fs.promises.readFile(ignorePath, 'utf8');
      if (!existing.includes('.env*')) {
        await fs.promises.writeFile(ignorePath, existing + envIgnore, 'utf8');
      }
    } catch {
      await fs.promises.writeFile(ignorePath, envIgnore.trim() + '\n', 'utf8');
    }
  }

  /**
   * Find an available host port in range 8000–9999 by probing with a TCP server.
   * Uses a sequential scan from a random offset so concurrent workers diverge quickly.
   */
  async findAvailablePort(excludePorts: number[] = []): Promise<number> {
    const base = 8000;
    const range = 2000;
    const excluded = new Set(excludePorts);
    const start = Math.floor(Math.random() * range);
    for (let i = 0; i < range; i++) {
      const port = base + ((start + i) % range);
      if (!excluded.has(port) && await this.isPortAvailable(port)) return port;
    }
    throw new Error('No available port found in range 8000–9999');
  }

  /**
   * Stops a running container by name without removing it.
   */
  async stopContainer(containerName: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerName);
      const info = await container.inspect();
      if (info.State.Running) await container.stop();
    } catch {
      // Container doesn't exist or already stopped — fine
    }
  }

  /**
   * Restarts a container by name.
   */
  async restartContainer(containerName: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerName);
      await container.restart();
    } catch {
      // Container doesn't exist — fine
    }
  }

  /**
   * Stops and removes a container by name. Silently ignores missing containers.
   */
  async stopAndRemoveContainer(containerName: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerName);
      const info = await container.inspect();
      if (info.State.Running) await container.stop();
      await container.remove();
    } catch {
      // Container doesn't exist or already removed — fine
    }
  }

  /**
   * Removes BuildKit-only directives from a Dockerfile so the classic builder
   * can process it.  Specifically:
   *   • `# syntax = ...` directives (trigger remote BuildKit frontend pull)
   *   • `--mount=...` flags on RUN instructions (BuildKit cache/secret mounts)
   */
  /**
   * Injects --platform=<platform> into FROM lines that don't already specify one.
   * Ensures multi-arch hosts (e.g. Apple Silicon) always build for the target platform.
   */
  private injectPlatform(content: string, platform: string): string {
    return content.replace(
      /^(FROM\s+)(?!--platform)(\S+)/gim,
      `$1--platform=${platform} $2`,
    );
  }

  private stripBuildKitDirectives(content: string): string {
    return content
      .split('\n')
      // Drop `# syntax=docker/dockerfile:...` lines
      .filter((line) => !/^\s*#\s*syntax\s*=/i.test(line))
      .join('\n')
      // Strip --mount=... flags (with their trailing whitespace) from RUN lines
      .replace(/--mount=\S+\s*/g, '');
  }

  /**
   * Extracts a single file from a Docker image into destPath.
   * Creates a temporary stopped container, uses getArchive to pull the tar stream,
   * extracts the target file, then removes the container and image.
   */
  async extractArtifactFromImage(imageName: string, artifactPath: string, destPath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

    const container = await this.docker.createContainer({ Image: imageName });
    try {
      const tarStream = await container.getArchive({ path: artifactPath }) as NodeJS.ReadableStream;

      await new Promise<void>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const passthrough = new stream.PassThrough();

        tarStream.pipe(passthrough);

        passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
        passthrough.on('error', reject);
        passthrough.on('end', async () => {
          try {
            const tarBuffer = Buffer.concat(chunks);
            // Parse tar manually: each entry is 512-byte header + data blocks
            let offset = 0;
            while (offset + 512 <= tarBuffer.length) {
              const header = tarBuffer.slice(offset, offset + 512);
              // Check for end-of-archive (two 512-byte zero blocks)
              if (header.every((b) => b === 0)) break;

              const nameRaw = header.slice(0, 100).toString('utf8').replace(/\0/g, '');
              const sizeOctal = header.slice(124, 136).toString('utf8').replace(/\0/g, '').trim();
              const size = parseInt(sizeOctal, 8) || 0;
              const typeFlag = header[156];

              offset += 512;
              // typeFlag 0 or 0x30 = regular file
              if ((typeFlag === 0 || typeFlag === 0x30) && nameRaw && size > 0) {
                const fileData = tarBuffer.slice(offset, offset + size);
                await fs.promises.writeFile(destPath, fileData);
                break; // Only one file expected
              }
              // Skip data blocks (round up to 512-byte boundary)
              offset += Math.ceil(size / 512) * 512;
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    } finally {
      await container.remove().catch(() => {});
      await this.docker.getImage(imageName).remove({ force: true }).catch(() => {});
    }

    // Verify extraction succeeded
    const stat = await fs.promises.stat(destPath).catch(() => null);
    if (!stat || stat.size === 0) {
      throw new Error(`Failed to extract APK from image at path: ${artifactPath}`);
    }
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '127.0.0.1');
    });
  }
}

export const dockerService = new DockerService();
