/**
 * Docker service: build images from project context and run containers (PRD §5.4).
 */

import Docker from 'dockerode';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import type { Project } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { DOCKERFILE_TEMPLATES, CONTAINER_PORTS, type DockerfileProjectType, injectNextPublicBuildArgs } from './dockerfile.templates';
import { patchNextConfig } from './nextjs-config-patcher';

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
  ): Promise<string> {
    const imageName = `dropdeploy/${project.slug}:latest`;
    const dockerfile = this.getDockerfileForProject(project, Object.keys(buildArgs));
    const dockerfilePath = path.join(contextPath, 'Dockerfile');
    await fs.promises.writeFile(dockerfilePath, dockerfile, 'utf8');

    // Write .dockerignore to prevent .env files from leaking into image
    await this.writeDockerignore(contextPath);

    // Patch Next.js config to skip lint/type errors during build
    if (project.type === 'NEXTJS') {
      await patchNextConfig(contextPath);
    }

    console.log('[docker] Building image:', imageName);
    const stream = await this.docker.buildImage(
      { context: contextPath, src: ['.'] },
      {
        t: imageName,
        ...(Object.keys(buildArgs).length > 0 ? { buildargs: buildArgs } : {}),
      },
    );

    // Build a scrubber to redact secret values from build output
    const scrub = this.buildScrubber(secretValues);

    // Collect build output for diagnostics
    const buildLog: string[] = [];
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
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
            buildLog.push(scrub(event.stream));
          }
        }
      );
    });

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
    const hostPort = await this.findAvailablePort(excludePorts);

    // Convert env vars to Docker format: ["KEY=value", ...]
    const envArray = Object.entries(envVars).map(
      ([key, value]) => `${key}=${value}`,
    );

    const container = await this.docker.createContainer({
      Image: imageName,
      name: containerName,
      Env: envArray.length > 0 ? envArray : undefined,
      ExposedPorts: { [`${containerPort}/tcp`]: {} },
      HostConfig: {
        PortBindings: {
          [`${containerPort}/tcp`]: [{ HostPort: String(hostPort) }],
        },
        Memory: this.memoryLimitBytes,
        CpuShares: this.cpuShares,
      },
    });

    await container.start();
    return hostPort;
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
   */
  async findAvailablePort(excludePorts: number[] = []): Promise<number> {
    const base = 8000;
    const range = 2000;
    const excluded = new Set(excludePorts);
    for (let attempts = 0; attempts < 50; attempts++) {
      const port = base + Math.floor(Math.random() * range);
      if (!excluded.has(port) && await this.isPortAvailable(port)) return port;
    }
    throw new Error('No available port found in range 8000-9999 after 50 attempts');
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
