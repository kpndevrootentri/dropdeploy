import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import * as protobuf from 'protobufjs';
import { getConfig } from '@/lib/config';
import { DOCKERFILE_TEMPLATES, djangoDockerfile, withCacheMounts } from '@/services/docker/dockerfile.templates';
import { failureReason } from '@/services/deployment/failure-reason';

/* eslint-disable @typescript-eslint/no-require-imports */
const { DockerService } = require('@/services/docker/docker.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const config = getConfig();
let dir: string;

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'buildkit-'));
  Object.assign(config, { BUILDKIT_PROJECTS: 'blog, shop', BUILD_CACHE_MAX_MB: 4096 });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await fs.promises.rm(dir, { recursive: true, force: true });
});

/**
 * A DockerService whose daemon answers every build with `events`, or breaks the
 * stream with that error, after refusing the first `refusals` builds.
 */
function fakeDaemon(events: object[] | Error = [], refusals = 0) {
  const service = new DockerService({ socketPath: '/nonexistent.sock' });
  const docker = service['docker'];
  const dockerfiles: string[] = [];
  const ended = jest.fn();
  const build = jest.spyOn(docker, 'buildImage').mockImplementation(async () => {
    dockerfiles.push(await fs.promises.readFile(path.join(dir, 'Dockerfile'), 'utf8'));
    if (build.mock.calls.length <= refusals) throw new Error('session dial failed');
    const stream = new PassThrough();
    stream.on('end', ended);
    if (events instanceof Error) setImmediate(() => stream.destroy(events));
    else stream.end(events.map((e) => `${JSON.stringify(e)}\n`).join(''));
    return stream;
  });
  const dial = jest.spyOn(docker.modem, 'dial').mockImplementation((...args: unknown[]) => (args[1] as (err: null, data: object) => void)(null, { SpaceReclaimed: 1 }));
  jest.spyOn(docker, 'getImage').mockReturnValue({ inspect: async () => ({}) });
  const lines: string[] = [];
  const buildProject = (slug: string, signal?: AbortSignal) =>
    service.buildImage({ id: `id-${slug}`, slug, type: 'NODEJS' }, dir, {}, ['s3cr3t-value'], (l: string) => lines.push(l), signal);
  const options = (call: number) => build.mock.calls[call][1] as Record<string, unknown>;
  return { service, build, dial, dockerfiles, lines, buildProject, options, ended };
}

describe('Dockerfiles', () => {
  const all: Record<string, string> = { ...DOCKERFILE_TEMPLATES, DJANGO_GUNICORN: djangoDockerfile({ settings: 'mysite.settings' }) };

  it('keep the classic builder text unchanged, with no cache mounts', () => {
    for (const template of Object.values(all)) expect(withCacheMounts(template, null)).not.toMatch(/--mount|{{CACHE_ID}}/);
    expect(withCacheMounts(DOCKERFILE_TEMPLATES.FLASK, null)).toContain('\nRUN pip install --no-cache-dir -r requirements.txt gunicorn\n');
    expect(withCacheMounts(DOCKERFILE_TEMPLATES.NEXTJS, null)).toContain('\nRUN if [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile; \\\n');
    const service = new DockerService({ socketPath: '/nonexistent.sock' });
    expect(service.getDockerfileForProject({ id: 'p1', type: 'NODEJS' })).toBe(withCacheMounts(DOCKERFILE_TEMPLATES.NODEJS, null));
  });

  it('give every npm and pip install under BuildKit a cache mount of its own project', () => {
    for (const template of Object.values(all)) {
      const dockerfile = withCacheMounts(template, 'p1');
      expect(dockerfile).not.toMatch(/--no-cache-dir|{{CACHE_ID}}/);
      for (const run of dockerfile.split('\n').filter((l) => /^RUN .*(pip install|if \[ -f pnpm-lock\.yaml \])/.test(l))) {
        expect(run).toMatch(/^RUN --mount=type=cache,id=p1-(npm|npm-node|pip),target=\S+ (pip|if) /);
      }
    }
    const service = new DockerService({ socketPath: '/nonexistent.sock' });
    // The node user (uid 1000) runs the NODEJS install; root runs the builder stages.
    expect(service.getDockerfileForProject({ id: 'p2', type: 'NODEJS' }, { buildkit: true })).toContain(
      '\nRUN --mount=type=cache,id=p2-npm-node,target=/home/node/.npm,uid=1000,gid=1000 if [ -f pnpm-lock.yaml ]',
    );
    expect(service.getDockerfileForProject({ id: 'p3', type: 'NEXTJS', useStaticHosting: true }, { buildkit: true })).toContain(
      '\nRUN --mount=type=cache,id=p3-npm,target=/root/.npm if [ -f pnpm-lock.yaml ]',
    );
    expect(service.getDockerfileForProject({ id: 'p4', type: 'DJANGO' }, { django: { settings: 'mysite.settings' }, buildkit: true })).toContain(
      "\nRUN --mount=type=cache,id=p4-pip,target=/root/.cache/pip pip install -r requirements.txt && pip install 'gunicorn>=21' whitenoise\n",
    );
  });
});

describe('DockerService.buildImage with BuildKit', () => {
  it('uses BuildKit only for the projects BUILDKIT_PROJECTS names, or every project for *', async () => {
    const { buildProject, options, dockerfiles, lines } = fakeDaemon();
    await buildProject('shop');
    expect(options(0)).toMatchObject({ version: '2', memory: 3072 * 1024 * 1024 });
    expect(dockerfiles[0]).toContain('--mount=type=cache,id=id-shop-npm-node,');
    expect(lines).toEqual(['Building with BuildKit\n']);

    await buildProject('shopping');
    expect(Object.keys(options(1))).not.toContain('version');
    expect(dockerfiles[1]).not.toContain('--mount');

    config.BUILDKIT_PROJECTS = '*';
    await buildProject('shopping');
    expect(options(2)).toHaveProperty('version', '2');

    config.BUILDKIT_PROJECTS = undefined;
    await buildProject('shop');
    expect(Object.keys(options(3))).not.toContain('version');
  });

  it('builds with the classic builder when the daemon refuses the BuildKit build, and stays classic until restart', async () => {
    const { buildProject, build, options, dockerfiles, lines, dial } = fakeDaemon([], 1);
    await buildProject('shop');
    expect(build).toHaveBeenCalledTimes(2);
    expect(options(0)).toHaveProperty('version', '2');
    expect(Object.keys(options(1))).not.toContain('version');
    expect(dockerfiles[0]).toContain('--mount=');
    expect(dockerfiles[1]).not.toContain('--mount=');
    expect(lines).toEqual(['BuildKit is unavailable; building with the classic builder\n']);
    expect(dial).not.toHaveBeenCalled();

    // dockerode leaves each refused build's session open, so the next build doesn't ask for BuildKit again.
    await buildProject('blog');
    expect(build).toHaveBeenCalledTimes(3);
    expect(Object.keys(options(2))).not.toContain('version');
    expect(dockerfiles[2]).not.toContain('--mount=');
    expect(lines).toEqual(['BuildKit is unavailable; building with the classic builder\n', 'BuildKit is unavailable; building with the classic builder\n']);
  });

  it('does not retry an aborted build, a classic one, or one that failed inside the build', async () => {
    const aborted = fakeDaemon([], 1);
    await expect(aborted.buildProject('shop', AbortSignal.abort())).rejects.toThrow('session dial failed');
    expect(aborted.build).toHaveBeenCalledTimes(1);

    const classic = fakeDaemon([], 1);
    await expect(classic.buildProject('shopping')).rejects.toThrow('session dial failed');
    expect(classic.build).toHaveBeenCalledTimes(1);

    const failing = fakeDaemon([{ errorDetail: { message: 'exit code: 1' }, error: 'exit code: 1' }]);
    await expect(failing.buildProject('shop')).rejects.toThrow('exit code: 1');
    expect(failing.build).toHaveBeenCalledTimes(1);
  });

  it('ends the stream of a broken BuildKit build, the only way dockerode closes its session', async () => {
    const buildkit = fakeDaemon(new Error('aborted'));
    await expect(buildkit.buildProject('shop')).rejects.toThrow('aborted');
    expect(buildkit.ended).toHaveBeenCalledTimes(1);

    const classic = fakeDaemon(new Error('aborted'));
    await expect(classic.buildProject('shopping')).rejects.toThrow('aborted');
    expect(classic.ended).not.toHaveBeenCalled();
  });

  it('trims the build cache after every BuildKit build, failed ones too, and never after a classic one', async () => {
    const ok = fakeDaemon();
    await ok.buildProject('shopping');
    expect(ok.dial).not.toHaveBeenCalled();
    await ok.buildProject('shop');
    const bytes = 4096 * 1024 * 1024;
    expect(ok.dial).toHaveBeenCalledTimes(1);
    expect(ok.dial.mock.calls[0][0]).toMatchObject({ path: '/build/prune?', method: 'POST', options: { 'keep-storage': bytes, 'max-used-space': bytes } });

    const failing = fakeDaemon([{ error: 'boom' }]);
    failing.dial.mockImplementation((...args: unknown[]) => (args[1] as (err: Error) => void)(new Error('prune refused')));
    await expect(failing.buildProject('shop')).rejects.toThrow('boom');
    expect(failing.dial).toHaveBeenCalledTimes(1);
    // The prune's own error is logged, never thrown.
    await expect(failing.service.pruneBuildCache()).resolves.toBeUndefined();
  });

  it("decodes BuildKit's trace events into the redacted build log, so the failure reason finds the error", async () => {
    const StatusResponse = protobuf
      .loadSync(require.resolve('dockerode/lib/proto/buildkit_status.proto'))
      .lookupType('moby.buildkit.v1.StatusResponse');
    const trace = (status: object) => ({
      id: 'moby.buildkit.trace',
      aux: Buffer.from(StatusResponse.encode(StatusResponse.fromObject(status)).finish()).toString('base64'),
    });
    const vertex = { digest: 'sha256:0123456789abcdef', name: '[4/5] RUN npm run build', started: { seconds: 1 } };
    const exit = 'process "/bin/sh -c npm run build" did not complete successfully: exit code: 1';
    const { buildProject, lines } = fakeDaemon([
      trace({ vertexes: [{ digest: 'sha256:aa', name: '[3/5] COPY package.json ./', started: { seconds: 1 }, completed: { seconds: 1 }, cached: true }] }),
      trace({ vertexes: [vertex] }),
      trace({ logs: [{ vertex: vertex.digest, msg: Buffer.from('token=s3cr3t-value\nnpm error Missing script: "build"\n') }] }),
      trace({ vertexes: [{ ...vertex, completed: { seconds: 2 }, error: exit }] }),
      { errorDetail: { message: exit }, error: exit },
    ]);
    const err = await buildProject('shop').catch((e: Error) => e);
    const log = lines.join('');
    expect(log).toContain('] CACHED [3/5] COPY package.json ./\n');
    expect(log).toContain('] [4/5] RUN npm run build\n');
    expect(log).toContain('token=[REDACTED]\nnpm error Missing script: "build"\n');
    expect(log).not.toContain('s3cr3t');
    expect(failureReason(err.message)).toBe('npm error Missing script: "build"');
  });
});
