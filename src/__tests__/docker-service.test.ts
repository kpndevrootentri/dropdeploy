import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import * as tarStream from 'tar-stream';
import { DockerService } from '@/services/docker/docker.service';
import { DOCKERFILE_TEMPLATES, WORDPRESS_CONFIG, WORDPRESS_CONFIG_FILE } from '@/services/docker/dockerfile.templates';

const MiB = 1024 * 1024;

/** The dockerode calls DockerService makes, as mocks. Each test overrides what it needs. */
function fakeDocker() {
  const container = {
    start: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    getArchive: jest.fn(),
  };
  const image = { inspect: jest.fn().mockResolvedValue({}), remove: jest.fn().mockResolvedValue(undefined) };
  const network = { inspect: jest.fn().mockResolvedValue({}) };
  return {
    container,
    image,
    network,
    getImage: jest.fn(() => image),
    // No container of that name yet, for startContainer's stale-container cleanup.
    getContainer: jest.fn((name: string): unknown => ({ name, inspect: jest.fn().mockRejectedValue({ statusCode: 404 }) })),
    getNetwork: jest.fn(() => network),
    createNetwork: jest.fn().mockResolvedValue({}),
    createContainer: jest.fn().mockResolvedValue(container),
    listImages: jest.fn().mockResolvedValue([]),
    buildImage: jest.fn().mockResolvedValue({}),
    modem: { followProgress: jest.fn() },
  };
}

function service(docker = fakeDocker()) {
  const svc = new DockerService({ socketPath: '/nonexistent.sock' });
  (svc as unknown as { docker: unknown }).docker = docker;
  return { svc, docker };
}

const startOpts = { imageName: 'dropdeploy/shop:latest', projectType: 'NODEJS', slug: 'shop', containerName: 'dropdeploy-shop' };

let tmp: string;
beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docker-service-'));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

describe('startContainer', () => {
  it('sends the hardened container config: loopback-only port, tenant network, data volume, dropped capabilities', async () => {
    const { svc, docker } = service();
    jest.spyOn(svc, 'findAvailablePort').mockResolvedValue(4321);
    await expect(svc.startContainer({ ...startOpts, envVars: { API_KEY: 'k' } })).resolves.toBe(4321);
    expect(docker.createContainer).toHaveBeenCalledWith({
      Image: 'dropdeploy/shop:latest',
      name: 'dropdeploy-shop',
      Env: ['API_KEY=k', 'DROPDEPLOY_DATA_DIR=/data'],
      ExposedPorts: { '3000/tcp': {} },
      HostConfig: {
        PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '4321' }] },
        NetworkMode: 'dropdeploy-tenants',
        Mounts: [{ Type: 'volume', Source: 'dropdeploy-data-shop', Target: '/data' }],
        Memory: 512 * MiB,
        MemorySwap: 512 * MiB,
        CpuShares: 1024,
        PidsLimit: 512,
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'SETUID', 'SETGID', 'NET_BIND_SERVICE', 'DAC_OVERRIDE'],
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });
  });

  it.each([
    ['STATIC', 80, 128 * MiB, 256],
    ['NEXTJS', 3000, 1024 * MiB, 1024],
    ['DJANGO', 8000, 512 * MiB, 512],
    ['WORDPRESS', 8080, 256 * MiB, 512],
    // No entry of its own: the constructor's defaults.
    ['GO', 8080, 512 * MiB, 1024],
  ])('%s listens on %i with its memory and CPU share', async (projectType, port, memory, cpuShares) => {
    const { svc, docker } = service();
    jest.spyOn(svc, 'findAvailablePort').mockResolvedValue(4321);
    await svc.startContainer({ ...startOpts, projectType });
    const { ExposedPorts, HostConfig } = docker.createContainer.mock.calls[0][0];
    expect(ExposedPorts).toEqual({ [`${port}/tcp`]: {} });
    expect(HostConfig).toMatchObject({ Memory: memory, MemorySwap: memory, CpuShares: cpuShares });
  });

  it('retries a port conflict on another port, removing the failed container', async () => {
    const { svc, docker } = service();
    const findPort = jest.spyOn(svc, 'findAvailablePort').mockResolvedValueOnce(4321).mockResolvedValueOnce(4322);
    docker.container.start.mockRejectedValueOnce(new Error('Bind for 127.0.0.1:4321 failed: port is already allocated'));
    await expect(svc.startContainer({ ...startOpts, excludePorts: [5000] })).resolves.toBe(4322);
    expect(findPort.mock.calls).toEqual([[[5000]], [[5000, 4321]]]);
    expect(docker.container.remove).toHaveBeenCalledTimes(1);
    expect(docker.container.remove).toHaveBeenCalledWith({ v: true });
    expect(docker.createContainer.mock.calls[1][0].HostConfig.PortBindings['3000/tcp'][0].HostPort).toBe('4322');
  });

  it('throws any other start error at once', async () => {
    const { svc, docker } = service();
    jest.spyOn(svc, 'findAvailablePort').mockResolvedValue(4321);
    docker.container.start.mockRejectedValue(new Error('OCI runtime create failed'));
    await expect(svc.startContainer(startOpts)).rejects.toThrow('OCI runtime create failed');
    expect(docker.createContainer).toHaveBeenCalledTimes(1);
    expect(docker.container.remove).toHaveBeenCalledWith({ v: true });
  });

  it('fails before creating anything when the image is missing', async () => {
    const { svc, docker } = service();
    docker.image.inspect.mockRejectedValue({ statusCode: 404 });
    await expect(svc.startContainer(startOpts)).rejects.toThrow('Image dropdeploy/shop:latest was not found');
    expect(docker.createContainer).not.toHaveBeenCalled();
  });
});

describe('the tenant network', () => {
  it('is created without inter-container traffic when missing', async () => {
    const { svc, docker } = service();
    docker.network.inspect.mockRejectedValue({ statusCode: 404 });
    await svc['ensureTenantNetwork']();
    expect(docker.createNetwork).toHaveBeenCalledWith({
      Name: 'dropdeploy-tenants',
      Driver: 'bridge',
      Options: { 'com.docker.network.bridge.enable_icc': 'false' },
    });
  });

  it('tolerates another worker creating it first, and rethrows other errors', async () => {
    const { svc, docker } = service();
    docker.network.inspect.mockRejectedValue({ statusCode: 404 });
    docker.createNetwork.mockRejectedValueOnce(new Error('network with name dropdeploy-tenants already exists'));
    await expect(svc['ensureTenantNetwork']()).resolves.toBeUndefined();
    docker.createNetwork.mockRejectedValueOnce(new Error('permission denied'));
    await expect(svc['ensureTenantNetwork']()).rejects.toThrow('permission denied');
  });
});

describe('buildImage', () => {
  /** A daemon that streams `lines`, then finishes with `output`. */
  function daemon(lines: string[] = [], output: unknown[] = []) {
    const { svc, docker } = service();
    docker.modem.followProgress.mockImplementation((_stream, done, progress) => {
      for (const line of lines) progress({ stream: line });
      done(null, output);
    });
    return { svc, docker };
  }

  it('labels the image with its slug and bounds the build, with no build args when there are none', async () => {
    const { svc, docker } = daemon();
    const signal = new AbortController().signal;
    await expect(svc.buildImage({ slug: 'shop', type: 'NODEJS' } as never, tmp, {}, [], undefined, signal)).resolves.toBe('dropdeploy/shop:latest');
    const [context, options] = docker.buildImage.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(context).toEqual({ context: tmp, src: ['.'] });
    expect(options).toEqual({
      t: 'dropdeploy/shop:latest',
      labels: { 'dropdeploy.slug': 'shop' },
      memory: 3072 * MiB,
      memswap: 3072 * MiB,
      cpuperiod: 100_000,
      cpuquota: 200_000,
      abortSignal: signal,
    });
    expect(options).not.toHaveProperty('buildargs');
    expect(await fs.promises.readFile(path.join(tmp, 'Dockerfile'), 'utf8')).toBe(DOCKERFILE_TEMPLATES.NODEJS);
    expect(await fs.promises.readFile(path.join(tmp, '.dockerignore'), 'utf8')).toBe(
      '# Entrify: keep secrets and git history out of the image\n.env*\n.git\n',
    );
  });

  it('passes build args and declares them in the Dockerfile', async () => {
    const { svc, docker } = daemon();
    await svc.buildImage({ slug: 'shop', type: 'REACT' } as never, tmp, { VITE_API: 'https://api.test' });
    expect(docker.buildImage.mock.calls[0][1]).toMatchObject({ buildargs: { VITE_API: 'https://api.test' } });
    expect(await fs.promises.readFile(path.join(tmp, 'Dockerfile'), 'utf8')).toContain('ARG VITE_API\nENV VITE_API=$VITE_API\n');
  });

  it("rejects with the daemon's error, redacted, and the last 20 lines of output", async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `step ${String(i + 1).padStart(2, '0')}\n`);
    const { svc } = daemon(lines, [{ errorDetail: { message: 'npm install failed for token sk-fake-secret' } }]);
    const message = await svc.buildImage({ slug: 'shop', type: 'NODEJS' } as never, tmp, {}, ['sk-fake-secret']).then(() => '', (e: Error) => e.message);
    expect(message).toMatch(/^npm install failed for token \[REDACTED\]\n\nBuild output \(last 20 lines\):\n/);
    expect(message).toContain('step 06\n');
    expect(message).toContain('step 25\n');
    expect(message).not.toContain('step 05');
    expect(message).not.toContain('sk-fake-secret');
  });

  it('fails when the build reports success but left no image', async () => {
    const { svc, docker } = daemon();
    docker.image.inspect.mockRejectedValue({ statusCode: 404 });
    await expect(svc.buildImage({ slug: 'shop', type: 'NODEJS' } as never, tmp)).rejects.toThrow('did not produce an image');
  });

  it("writes the platform's wp-config for WordPress", async () => {
    const { svc } = daemon();
    await svc.buildImage({ slug: 'blog', type: 'WORDPRESS' } as never, tmp);
    expect(await fs.promises.readFile(path.join(tmp, WORDPRESS_CONFIG_FILE), 'utf8')).toBe(WORDPRESS_CONFIG);
  });
});

describe('waitUntilReady', () => {
  const running = { State: { Running: true, Restarting: false, ExitCode: 0 }, RestartCount: 0 };

  function withContainer(info: object) {
    const { svc, docker } = service();
    docker.getContainer.mockReturnValue({
      inspect: jest.fn().mockResolvedValue(info),
      logs: jest.fn().mockResolvedValue(Buffer.from('Error: Cannot find module express\n')),
    });
    return svc;
  }

  async function closedPort(): Promise<number> {
    const server = http.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as AddressInfo;
    await new Promise((r) => server.close(r));
    return port;
  }

  it('resolves once the app answers HTTP, even with a 500', async () => {
    const server = http.createServer((_req, res) => { res.statusCode = 500; res.end(); }).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const { port } = server.address() as AddressInfo;
      await expect(withContainer(running).waitUntilReady('dropdeploy-shop', port, 10_000)).resolves.toBeUndefined();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('fails fast with the logs when the container has restarted', async () => {
    const svc = withContainer({ ...running, State: { ...running.State, ExitCode: 1 }, RestartCount: 1 });
    await expect(svc.waitUntilReady('dropdeploy-shop', await closedPort(), 60_000))
      .rejects.toThrow('The app exited during startup (exit code 1).\nError: Cannot find module express');
  });

  it('times out with the logs when nothing listens', async () => {
    await expect(withContainer(running).waitUntilReady('dropdeploy-shop', await closedPort(), 500))
      .rejects.toThrow(/did not start listening within 1s\.\nError: Cannot find module express/);
  });
});

describe('promoteContainer', () => {
  function withLive(exists: boolean) {
    const { svc, docker } = service();
    const calls: string[] = [];
    const live = {
      inspect: jest.fn(async () => {
        if (!exists) throw { statusCode: 404 };
        return { State: { Running: true } };
      }),
      stop: jest.fn(async () => { calls.push('stop'); }),
      remove: jest.fn(async (opts: unknown) => { calls.push(`remove ${JSON.stringify(opts)}`); }),
    };
    const candidate = { rename: jest.fn(async (opts: unknown) => { calls.push(`rename ${JSON.stringify(opts)}`); }) };
    docker.getContainer.mockImplementation((name: string) => (name === 'dropdeploy-shop' ? live : candidate));
    return { svc, calls };
  }

  it('retires the live container, then gives the candidate its name', async () => {
    const { svc, calls } = withLive(true);
    await svc.promoteContainer('shop', 'dropdeploy-shop-next-abcd1234', 0);
    expect(calls).toEqual(['stop', 'remove {"v":true}', 'rename {"name":"dropdeploy-shop"}']);
  });

  it('only renames on a first deploy', async () => {
    const { svc, calls } = withLive(false);
    await svc.promoteContainer('shop', 'dropdeploy-shop-next-abcd1234', 0);
    expect(calls).toEqual(['rename {"name":"dropdeploy-shop"}']);
  });
});

describe('extractStaticFiles', () => {
  it("writes the image's html/ tree, a symlink entry as an empty regular file, and removes the container", async () => {
    const pack = tarStream.pack();
    pack.entry({ name: 'html/', type: 'directory' });
    pack.entry({ name: 'html/index.html' }, '<h1>hi</h1>');
    pack.entry({ name: 'html/assets/app.js' }, 'console.log(1)');
    pack.entry({ name: 'html/passwd', type: 'symlink', linkname: '/etc/passwd' });
    pack.finalize();
    const { svc, docker } = service();
    docker.container.getArchive.mockResolvedValue(pack);
    const dest = path.join(tmp, 'site');
    await svc.extractStaticFiles('dropdeploy/shop:latest', dest);
    expect(docker.createContainer).toHaveBeenCalledWith({ Image: 'dropdeploy/shop:latest' });
    expect(docker.container.getArchive).toHaveBeenCalledWith({ path: '/usr/share/nginx/html' });
    expect(await fs.promises.readFile(path.join(dest, 'index.html'), 'utf8')).toBe('<h1>hi</h1>');
    expect(await fs.promises.readFile(path.join(dest, 'assets/app.js'), 'utf8')).toBe('console.log(1)');
    const link = await fs.promises.lstat(path.join(dest, 'passwd'));
    expect(link.isFile()).toBe(true);
    expect(link.size).toBe(0);
    expect(docker.container.start).not.toHaveBeenCalled();
    expect(docker.container.remove).toHaveBeenCalled();
  });

  it('removes the throwaway container when the copy fails', async () => {
    const { svc, docker } = service();
    docker.container.getArchive.mockRejectedValue(new Error('no such path'));
    await expect(svc.extractStaticFiles('dropdeploy/shop:latest', path.join(tmp, 'site'))).rejects.toThrow('no such path');
    expect(docker.container.remove).toHaveBeenCalled();
  });
});

describe('removeSupersededImages', () => {
  it("removes only the slug's dangling images, carrying on past a failure", async () => {
    const { svc, docker } = service();
    docker.listImages.mockResolvedValue([{ Id: 'sha256:a' }, { Id: 'sha256:b' }]);
    const removes: Record<string, jest.Mock> = {
      'sha256:a': jest.fn().mockRejectedValue(new Error('image is being used by a container')),
      'sha256:b': jest.fn().mockResolvedValue(undefined),
    };
    docker.getImage.mockImplementation(((id: string) => ({ remove: removes[id] })) as never);
    await expect(svc.removeSupersededImages('shop')).resolves.toBeUndefined();
    expect(docker.listImages).toHaveBeenCalledWith({ filters: { label: ['dropdeploy.slug=shop'], dangling: ['true'] } });
    expect(removes['sha256:a']).toHaveBeenCalled();
    expect(removes['sha256:b']).toHaveBeenCalled();
  });
});

describe('findAvailablePort', () => {
  it('skips excluded and busy ports', async () => {
    const { svc } = service();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    jest.spyOn(svc as unknown as { isPortAvailable: (p: number) => Promise<boolean> }, 'isPortAvailable')
      .mockImplementation(async (port) => port !== 4002);
    await expect(svc.findAvailablePort([4000, 4001])).resolves.toBe(4003);
  });
});
