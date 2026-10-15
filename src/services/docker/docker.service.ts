/**
 * Docker service: build images from project context and run containers (PRD §5.4).
 */

import Docker from 'dockerode';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import * as tarStream from 'tar-stream';
import type { Project } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import {
  DOCKERFILE_TEMPLATES,
  CONTAINER_PORTS,
  WORDPRESS_CONFIG,
  WORDPRESS_CONFIG_FILE,
  type DockerfileProjectType,
  injectBuildArgs,
} from './dockerfile.templates';
import { patchNextConfig } from './nextjs-config-patcher';
import { readRepoFile, writeRepoFile } from '@/lib/repo-fs';

const log = createLogger('docker');

function isPortConflictError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('port is already allocated') || msg.includes('address already in use');
}

const CONTAINER_RESOURCES: Record<string, { memory: number; cpuShares: number }> = {
  STATIC: { memory: 128 * 1024 * 1024, cpuShares: 256 },
  NODEJS: { memory: 512 * 1024 * 1024, cpuShares: 1024 },
  NEXTJS: { memory: 1024 * 1024 * 1024, cpuShares: 1024 },
  DJANGO: { memory: 512 * 1024 * 1024, cpuShares: 512 },
  REACT: { memory: 128 * 1024 * 1024, cpuShares: 256 },
  FASTAPI: { memory: 512 * 1024 * 1024, cpuShares: 512 },
  FLASK: { memory: 256 * 1024 * 1024, cpuShares: 512 },
  VUE: { memory: 128 * 1024 * 1024, cpuShares: 256 },
  SVELTE: { memory: 128 * 1024 * 1024, cpuShares: 256 },
  WORDPRESS: { memory: 256 * 1024 * 1024, cpuShares: 512 },
};

/**
 * Network every tenant container joins instead of Docker's default bridge.
 * Inter-container traffic is disabled on it, so one tenant's container cannot
 * reach another's port directly — around the proxy's private-URL gate.
 */
export const TENANT_NETWORK = 'dropdeploy-tenants';

/** The project's live container. */
export const liveContainerName = (slug: string): string => `dropdeploy-${slug}`;

/** A deployment's container while it starts up next to the live one. */
export const candidateContainerName = (slug: string, deploymentId: string): string =>
  `dropdeploy-${slug}-next-${deploymentId.slice(-8).toLowerCase()}`;

/**
 * Whether the app on 127.0.0.1:port answers HTTP — any status counts, a 500
 * included: the app is up and handling requests. A bare TCP connect is not
 * enough, because Docker's port proxy accepts connections on the host port
 * before the app inside is listening, then drops them.
 */
function answersHttp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 2000 },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.once('timeout', () => req.destroy());
    req.once('error', () => resolve(false));
    req.end();
  });
}

/** Where each project's persistent volume is mounted inside its container. */
const DATA_MOUNT = '/data';

/** The persistent data volume of a project. */
export const dataVolumeName = (slug: string): string => `dropdeploy-data-${slug}`;

/** Image label naming the project an image was built for. */
const SLUG_LABEL = 'dropdeploy.slug';

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
    let key: keyof typeof DOCKERFILE_TEMPLATES =
      project.type in DOCKERFILE_TEMPLATES ? project.type as keyof typeof DOCKERFILE_TEMPLATES : 'STATIC';
    if (project.type === 'NEXTJS' && project.useStaticHosting) {
      key = 'NEXTJS_STATIC';
    }
    return injectBuildArgs(DOCKERFILE_TEMPLATES[key], buildArgKeys);
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
    signal?: AbortSignal,
  ): Promise<string> {
    const imageName = `dropdeploy/${project.slug}:latest`;
    const dockerfilePath = path.join(contextPath, 'Dockerfile');
    const dockerfile = this.getDockerfileForProject(project, Object.keys(buildArgs));
    await writeRepoFile(dockerfilePath, dockerfile);
    if (project.type === 'WORDPRESS') {
      await writeRepoFile(path.join(contextPath, WORDPRESS_CONFIG_FILE), WORDPRESS_CONFIG);
    }

    // Write .dockerignore to keep .env files and .git out of the image
    await this.writeDockerignore(contextPath);

    // Patch Next.js config to skip lint/type errors during build;
    // also inject output: 'export' for static builds so the out/ dir is generated
    if (project.type === 'NEXTJS') {
      await patchNextConfig(contextPath, { addStaticExport: project.useStaticHosting });
    }

    log.info('Building image', { imageName });
    const { BUILD_MEMORY_MB, BUILD_CPUS } = getConfig();
    const buildMemory = BUILD_MEMORY_MB * 1024 * 1024;
    const stream = await this.docker.buildImage(
      { context: contextPath, src: ['.'] },
      {
        t: imageName,
        // Lets removeSupersededImages find this project's images once a
        // rebuild has moved the tag off them.
        labels: { [SLUG_LABEL]: project.slug },
        ...(Object.keys(buildArgs).length > 0 ? { buildargs: buildArgs } : {}),
        // Bound each RUN step. memswap equal to memory means no swap on top.
        memory: buildMemory,
        memswap: buildMemory,
        cpuperiod: 100_000,
        cpuquota: Math.round(BUILD_CPUS * 100_000),
        // Aborting closes the connection, which makes the daemon cancel the build.
        abortSignal: signal,
      } as Record<string, unknown>,
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
            const now = new Date();
            const ts = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}]`;
            const formatted = `${ts} ${scrub(event.stream)}`;
            buildLog.push(formatted);
            onLog?.(formatted);
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
   * Creates and starts a container from the image under `containerName`;
   * returns the host port. Static projects expose 80, Node/Next expose 3000.
   *
   * Only a stale container of the *same* name is replaced. The project's live
   * container keeps running: a redeploy starts its successor under a
   * candidate name alongside it (see candidateContainerName), waits for it to
   * be ready, switches traffic, and only then retires the old one.
   */
  async startContainer(opts: {
    imageName: string;
    projectType: string;
    slug: string;
    containerName: string;
    envVars?: Record<string, string>;
    excludePorts?: number[];
  }): Promise<number> {
    const { imageName, projectType, slug, containerName, envVars = {}, excludePorts = [] } = opts;
    try {
      await this.docker.getImage(imageName).inspect();
    } catch {
      throw new Error(
        `Image ${imageName} was not found. The Docker build likely failed. For Node.js: ensure package.json has a "start" script (e.g. "node index.js") and that the repo builds. Check deployment logs.`
      );
    }

    // A leftover under this exact name (e.g. a candidate from a crashed
    // deploy) is replaced. Never the live container, which has another name.
    await this.stopAndRemoveContainer(containerName);

    await this.ensureTenantNetwork();

    const containerPort = CONTAINER_PORTS[projectType as DockerfileProjectType] ?? 3000;

    // Convert env vars to Docker format: ["KEY=value", ...]
    const envArray = Object.entries({ ...envVars, DROPDEPLOY_DATA_DIR: DATA_MOUNT }).map(
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
          // Loopback only. The in-app proxy reaches containers on 127.0.0.1,
          // and it is the only thing that should: a port published on every
          // interface is reachable from the internet (Docker's iptables rules
          // bypass ufw), skipping the private-URL gate entirely.
          PortBindings: {
            [`${containerPort}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(hostPort) }],
          },
          NetworkMode: TENANT_NETWORK,
          // Survives redeploys; everything else in the container is replaced.
          Mounts: [{ Type: 'volume', Source: dataVolumeName(slug), Target: DATA_MOUNT }],
          Memory: resources.memory,
          MemorySwap: resources.memory,
          CpuShares: resources.cpuShares,
          // A fork bomb otherwise exhausts the host's PID table.
          PidsLimit: 512,
          SecurityOpt: ['no-new-privileges'],
          // Only what nginx's root master needs (bind :80, drop to its worker
          // user, own its temp dirs). Everything else — raw sockets (ARP/ICMP
          // spoofing on the bridge), mknod, chroot, setfcap, kill — is gone.
          // Non-root apps get none of these at all.
          CapDrop: ['ALL'],
          CapAdd: ['CHOWN', 'SETUID', 'SETGID', 'NET_BIND_SERVICE', 'DAC_OVERRIDE'],
          // json-file logs are otherwise unbounded and fill the host disk.
          LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
          // Come back after crashes (Docker backs off between attempts) and
          // after host reboots; a container an admin stopped stays stopped.
          RestartPolicy: { Name: 'unless-stopped' },
        },
      });

      try {
        await container.start();
        return hostPort;
      } catch (err) {
        await container.remove().catch(() => { });
        if (!isPortConflictError(err) || attempt >= 2) throw err;
        log.warn('Port conflict on start, retrying', { hostPort, attempt: attempt + 1 });
      }
    }
    throw new Error('Failed to start container after 3 port allocation attempts');
  }

  /**
   * Waits until the app answers HTTP on its host port, or fails fast if the
   * container exits. On failure the
   * error carries the container's last log lines so the deploy log shows why.
   */
  async waitUntilReady(containerName: string, hostPort: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const container = this.docker.getContainer(containerName);
    while (Date.now() < deadline) {
      const info = await container.inspect();
      // With restart-unless-stopped a crashing app looks "running" between
      // restarts; any restart during startup means it crashed.
      if (!info.State.Running || info.State.Restarting || info.RestartCount > 0) {
        throw new Error(
          `The app exited during startup (exit code ${info.State.ExitCode}).\n${await this.tailLogs(containerName)}`,
        );
      }
      if (await answersHttp(hostPort)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `The app did not start listening within ${Math.round(timeoutMs / 1000)}s.\n${await this.tailLogs(containerName)}`,
    );
  }

  /**
   * Retires the project's previous live container and gives the candidate the
   * canonical name. Call after traffic has been switched to the candidate.
   * The old container gets a short grace period for requests already in
   * flight, then a normal `docker stop` (SIGTERM, then SIGKILL after 10s).
   */
  async promoteContainer(slug: string, candidateName: string, graceMs = 5_000): Promise<void> {
    const liveName = liveContainerName(slug);
    const old = this.docker.getContainer(liveName);
    const exists = await old.inspect().then(() => true, () => false);
    if (exists) {
      await new Promise((r) => setTimeout(r, graceMs));
      await this.stopAndRemoveContainer(liveName);
    }
    await this.docker.getContainer(candidateName).rename({ name: liveName });
  }

  /** Last lines of a container's output, for failure messages. */
  private async tailLogs(containerName: string, lines = 30): Promise<string> {
    try {
      const buf = await this.docker.getContainer(containerName).logs({ stdout: true, stderr: true, tail: lines });
      // Strip Docker's 8-byte multiplexing headers.
      return (buf as unknown as Buffer).toString('utf8').replace(/[\x00-\x08]/g, '').trim() || '(no output)';
    } catch {
      return '(logs unavailable)';
    }
  }

  /**
   * Tags a built image for a specific deployment so it can be re-run later
   * (rollback) after `:latest` has moved on. Returns the tag.
   */
  async tagForDeployment(imageName: string, slug: string, deploymentId: string): Promise<string> {
    const tag = `d-${deploymentId}`;
    await this.docker.getImage(imageName).tag({ repo: `dropdeploy/${slug}`, tag });
    return `dropdeploy/${slug}:${tag}`;
  }

  /** Creates {@link TENANT_NETWORK} on first use. */
  private async ensureTenantNetwork(): Promise<void> {
    try {
      await this.docker.getNetwork(TENANT_NETWORK).inspect();
      return;
    } catch {
      // Not created yet.
    }
    try {
      await this.docker.createNetwork({
        Name: TENANT_NETWORK,
        Driver: 'bridge',
        Options: { 'com.docker.network.bridge.enable_icc': 'false' },
      });
    } catch (err) {
      // Another worker created it between our inspect and create.
      if (!String(err).includes('already exists')) throw err;
    }
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
   * Appends the platform's exclusions to .dockerignore:
   *  - `.env*`, so secret files never reach an image layer;
   *  - `.git`, so a repo's history (and anything ever committed to it) is not
   *    copied into the image — for static sites that would mean serving it.
   *
   * Always appended, never skipped when already present: later lines win in
   * .dockerignore, so a repo line such as `!.env*` must not come after ours.
   * The clone is reset and cleaned before every build, so this cannot pile up.
   */
  private async writeDockerignore(contextPath: string): Promise<void> {
    const ignorePath = path.join(contextPath, '.dockerignore');
    const platformRules = '\n# DropDeploy: keep secrets and git history out of the image\n.env*\n.git\n';
    const existing = await readRepoFile(ignorePath);
    await writeRepoFile(ignorePath, existing === null ? platformRules.trimStart() : existing + platformRules);
  }

  /**
   * Find an available host port in range 8000–9999 by probing with a TCP server.
   * Uses a sequential scan from a random offset so concurrent workers diverge quickly.
   */
  async findAvailablePort(excludePorts: number[] = []): Promise<number> {
    const base = 4000;
    const range = 6000;
    const excluded = new Set(excludePorts);
    const start = Math.floor(Math.random() * range);
    for (let i = 0; i < range; i++) {
      const port = base + ((start + i) % range);
      if (!excluded.has(port) && await this.isPortAvailable(port)) return port;
    }
    throw new Error('No available port found in range 4000–9999');
  }

  /**
   * Returns key container details for a given container name, or null if not found.
   */
  async getContainerInfo(containerName: string): Promise<{
    id: string;
    status: string;
    running: boolean;
    startedAt: string;
    image: string;
    ports: { hostPort: number; containerPort: number }[];
    cpuLimit: number;
    memoryLimitBytes: number;
    restartCount: number;
  } | null> {
    try {
      const container = this.docker.getContainer(containerName);
      const info = await container.inspect();
      const portBindings = info.HostConfig?.PortBindings ?? {};
      const ports = Object.entries(portBindings).flatMap(([containerPort, bindings]) => {
        const cp = parseInt(containerPort.split('/')[0], 10);
        const list = Array.isArray(bindings) ? bindings as { HostPort: string }[] : [];
        return list.map((b) => ({
          hostPort: parseInt(b.HostPort, 10),
          containerPort: cp,
        }));
      });
      return {
        id: info.Id.slice(0, 12),
        status: info.State.Status,
        running: info.State.Running,
        startedAt: info.State.StartedAt,
        image: info.Config?.Image ?? info.Image,
        ports,
        cpuLimit: info.HostConfig?.CpuShares ?? 0,
        memoryLimitBytes: info.HostConfig?.Memory ?? 0,
        restartCount: info.RestartCount ?? 0,
      };
    } catch {
      return null;
    }
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
   * Extracts /usr/share/nginx/html from a built image into destPath on the host filesystem.
   * Creates a throwaway container (never started), copies the archive, then removes it.
   */
  async extractStaticFiles(imageName: string, destPath: string): Promise<void> {
    await fs.promises.mkdir(destPath, { recursive: true });
    const container = await this.docker.createContainer({ Image: imageName });
    try {
      const archiveStream = await container.getArchive({ path: '/usr/share/nginx/html' });
      await new Promise<void>((resolve, reject) => {
        const extract = tarStream.extract();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extract.on('entry', (header: any, stream: any, next: () => void) => {
          const entryName = header.name.replace(/^html\/?/, '');
          if (!entryName) { stream.resume(); stream.on('end', next); return; }
          const destFile = path.join(destPath, entryName);
          if (header.type === 'directory') {
            fs.promises.mkdir(destFile, { recursive: true })
              .then(() => { stream.resume(); stream.on('end', next); })
              .catch(reject);
          } else {
            fs.promises.mkdir(path.dirname(destFile), { recursive: true })
              .then(() => {
                const w = fs.createWriteStream(destFile);
                w.on('error', reject);
                w.on('finish', next);
                stream.pipe(w);
              })
              .catch(reject);
          }
        });
        extract.on('finish', resolve);
        extract.on('error', reject);
        (archiveStream as NodeJS.ReadableStream).pipe(extract);
      });
    } finally {
      await container.remove().catch(() => {});
    }
  }

  /**
   * Removes a project's superseded images — the ones a rebuild left untagged
   * when `dropdeploy/<slug>:latest` moved to the new build. Each redeploy
   * otherwise leaves a full image behind until the disk fills.
   *
   * Non-forced: an image a container still runs is kept.
   */
  async removeSupersededImages(slug: string): Promise<void> {
    let images: Docker.ImageInfo[];
    try {
      images = await this.docker.listImages({
        filters: { label: [`${SLUG_LABEL}=${slug}`], dangling: ['true'] },
      });
    } catch (err) {
      log.warn('Failed to list superseded images', { slug, error: String(err) });
      return;
    }
    for (const image of images) {
      await this.docker.getImage(image.Id).remove().catch((err: unknown) => {
        log.warn('Failed to remove superseded image', { slug, imageId: image.Id, error: String(err) });
      });
    }
  }

  /** Deletes a project's persistent data volume. Call only after its container is gone. */
  async removeDataVolume(slug: string): Promise<void> {
    await this.docker.getVolume(dataVolumeName(slug)).remove().catch((err: unknown) => {
      const msg = String(err);
      if (!msg.includes('404') && !msg.includes('no such volume')) {
        log.warn('Failed to remove data volume', { slug, error: msg });
      }
    });
  }

  /**
   * Removes a Docker image by name. Silently ignores missing images.
   */
  async removeImage(imageName: string): Promise<void> {
    try {
      await this.docker.getImage(imageName).remove({ force: true });
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('No such image') && !msg.includes('404')) {
        log.warn('Failed to remove image', { imageName, error: msg });
      }
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
