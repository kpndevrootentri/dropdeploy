import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-dockerfile-'));
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
  STATIC_SERVE_DIR: TMP,
});

jest.mock('@/lib/redis', () => ({ getRedisConnection: () => ({ publish: async () => 1 }) }));
jest.mock('@/services/git-provider', () => ({ gitProviderService: { getTokenForDeployment: async () => null } }));
jest.mock('@/lib/type-detector', () => ({ detectFromFiles: async () => null }));
jest.mock('@/services/deployment/package-scanner', () => ({ scanPackages: async () => ({ blocked: [] }) }));
const mockSession = { userId: 'admin', email: 'admin@entri.me', role: 'CONTRIBUTOR', mustResetPassword: false };
jest.mock('@/lib/get-session', () => ({ getSession: async () => mockSession }));
const mockSetAllowed = jest.fn(async () => undefined);
jest.mock('@/services/admin', () => ({ adminService: { setRepoDockerfileAllowed: mockSetAllowed } }));
jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: (slug: string) => `dropdeploy-${slug}` }));

// Required, not imported: the env above must be set before the services read their config.
/* eslint-disable @typescript-eslint/no-require-imports */
const { forbiddenInstruction, baseImages, exposedPort, REPO_IMAGE_MAX_BYTES } = require('@/services/docker/repo-dockerfile');
const { DockerService } = require('@/services/docker/docker.service');
const { DeploymentService } = require('@/services/deployment/deployment.service');
const { AdminService } = require('@/services/admin/admin.service');
const { updateProjectSchema } = require('@/validators/project.validator');
const { PATCH } = require('@/app/api/admin/projects/[projectId]/dockerfile/route');
/* eslint-enable @typescript-eslint/no-require-imports */
import { NextRequest } from 'next/server';

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const repoDir = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(TMP, 'repo-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
};

describe('forbiddenInstruction', () => {
  it.each([
    ['ADD https://example.com/x /x', 'ADD'],
    ['FROM alpine\n  add https://example.com/x /x', 'ADD'],
    ['FROM alpine\nONBUILD RUN make', 'ONBUILD'],
    ['# escape=`\nFROM alpine', '# escape='],
    // Docker joins a continuation as is, so the keyword can be split across lines.
    ['FROM alpine\nAD\\\nD https://example.com/x /x', 'ADD'],
    ['FROM alpine\nADD \\\n  https://example.com/x /x \\', 'ADD'],
    // Docker trims with Go's spaces (U+0085 is one, U+FEFF is not) and lowercases with Go's rules.
    ['FROM alpine\n\u0085ADD https://example.com/x /x', 'ADD'],
    ['FROM alpine\nONBU\u0130LD ADD https://example.com/x /x', 'ONBU\u0130LD'],
    ['FROM alpine\nRUN echo \\\n\uFEFF\nADD https://example.com/x /x', 'ADD'],
    // A lone `\` starts an instruction whose next line keeps its indent.
    ['FROM alpine\n\\\n ADD https://example.com/x /x', 'ADD'],
    ['FROM alpine\n  \\\n\tONBUILD RUN id', 'ONBUILD'],
    // Docker reads a heredoc's lines as its body; a `#EOF` terminator would otherwise hide the ADD after it.
    ['FROM alpine\nRUN <<"#EOF"\necho \\\n#EOF\nADD https://example.com/x /x', 'RUN <<'],
    ['FROM alpine\ncopy <<EOF /x\nhi\nEOF', 'COPY <<'],
  ])('refuses %j', (dockerfile, hit) => {
    expect(forbiddenInstruction(dockerfile)).toBe(hit);
  });

  it('reads continuations and comments the way Docker does', () => {
    expect(forbiddenInstruction('FROM alpine\nRUN apk \\\n    add curl')).toBeNull();
    expect(forbiddenInstruction('FROM alpine\nRUN apk update && \\\n# ADD comment inside\n\n    apk add curl')).toBeNull();
    expect(forbiddenInstruction([
      'FROM node:22-alpine AS build', 'WORKDIR /app', 'COPY package*.json ./', 'RUN npm ci', 'COPY . .', 'RUN npm run build',
      'FROM nginxinc/nginx-unprivileged:alpine', 'COPY --from=build /app/dist /usr/share/nginx/html', 'EXPOSE 8080',
    ].join('\r\n'))).toBeNull();
    expect(forbiddenInstruction('\uFEFFFROM alpine\nRUN true')).toBeNull();
  });
});

describe('baseImages', () => {
  const DIGEST = `sha256:${'a'.repeat(64)}`;

  it('lists each pinned image, leaving out scratch and earlier stages', () => {
    expect(baseImages([
      `FROM node:22-alpine@${DIGEST} AS build`, 'RUN npm ci', `from nginxinc/nginx-unprivileged@${DIGEST}`,
      'COPY --from=build /app/dist /usr/share/nginx/html', 'FROM BUILD', 'FROM scratch',
    ].join('\n'))).toEqual([`node:22-alpine@${DIGEST}`, `nginxinc/nginx-unprivileged@${DIGEST}`]);
  });

  it.each([
    ['FROM node:22-alpine', 'Pin each base image by digest'],
    ['FROM build', 'Pin each base image by digest'],
    [`ARG BASE=node@${DIGEST}\nFROM $BASE`, 'without variables'],
    [`FROM --platform=linux/amd64 node@${DIGEST}`, 'without variables or --platform'],
    [`FROM "node@${DIGEST}"`, 'without variables'],
    // A build pull must never re-tag one of the platform's own images.
    [`FROM dropdeploy/other@${DIGEST}`, "not one of Entrify's own images"],
    [`FROM node@${DIGEST}\nCOPY --from=dropdeploy/other:d-1 /app /app`, "not one of Entrify's own images"],
    [`FROM node@${DIGEST}\nCOPY --chown=1 --from=docker.io/dropdeploy/other /app /app`, "not one of Entrify's own images"],
    [`FROM node@${DIGEST}\nARG IMG=dropdeploy/other\nCOPY --from=$IMG /app /app`, 'without variables'],
    [`FROM node@${DIGEST}\nCOPY --from="dropdeploy/other" /app /app`, 'without quotes'],
  ])('refuses %j', (dockerfile, message) => {
    expect(() => baseImages(dockerfile)).toThrow(message);
  });

  it('allows COPY --from an earlier stage, a stage index or another image', () => {
    expect(baseImages([
      `FROM node@${DIGEST} AS build`, `FROM nginx@${DIGEST}`,
      'COPY --from=BUILD /a /a', 'COPY --from=0 /a /a', 'COPY --chown=101 --from=busybox:1.36 /bin/sh /sh',
    ].join('\n'))).toEqual([`node@${DIGEST}`, `nginx@${DIGEST}`]);
  });
});

describe('exposedPort', () => {
  it('returns the one TCP port and refuses anything else', () => {
    expect(exposedPort({ '3000/tcp': {}, '53/udp': {} })).toBe(3000);
    expect(() => exposedPort(undefined)).toThrow('exposes none');
    expect(() => exposedPort({ '80/tcp': {}, '8080/tcp': {} })).toThrow('exposes 80/tcp, 8080/tcp');
    expect(() => exposedPort({ '3000-3001/tcp': {} })).toThrow('exactly one TCP port');
  });
});

/** A DockerService whose daemon calls are stubbed; returns the build options it received. */
function stubbedDocker(imageInfo: Record<string, unknown> = { Size: 1000 }) {
  const service = new DockerService({ socketPath: '/nonexistent.sock' });
  const docker = service['docker'];
  const build = jest.spyOn(docker, 'buildImage').mockResolvedValue({});
  jest.spyOn(docker.modem, 'followProgress').mockImplementation((...args: unknown[]) => (args[1] as (e: null, o: unknown[]) => void)(null, []));
  const remove = jest.fn(async () => undefined);
  jest.spyOn(docker, 'getImage').mockReturnValue({ inspect: async () => imageInfo, remove });
  return { service, docker, build, remove, buildOptions: () => build.mock.calls[0][1] as Record<string, unknown> };
}

describe('DockerService.buildImage', () => {
  const OWN = 'FROM alpine\nEXPOSE 8080\nCMD ["httpd", "-f"]\n';

  it("builds the repository's Dockerfile untouched, labelled, always pulling, with the platform's ignore rules", async () => {
    const dir = repoDir({ Dockerfile: OWN, '.dockerignore': 'Dockerfile\n', 'next.config.js': 'module.exports = {};\n' });
    const { service, buildOptions } = stubbedDocker();
    await service.buildImage({ slug: 'shop', type: 'NEXTJS', useStaticHosting: true }, dir, { useRepo: true });
    expect(fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8')).toBe(OWN);
    expect(fs.readFileSync(path.join(dir, 'next.config.js'), 'utf8')).toBe('module.exports = {};\n');
    expect(fs.readFileSync(path.join(dir, '.dockerignore'), 'utf8')).toMatch(/^Dockerfile\n[^]*\n\.env\*\n\.git\n!Dockerfile\n$/);
    expect(buildOptions()).toMatchObject({ labels: { 'dropdeploy.slug': 'shop', 'dropdeploy.dockerfile': 'repo' }, pull: true });
  });

  it('still overwrites a repo Dockerfile with the template when the project is not switched', async () => {
    const dir = repoDir({ Dockerfile: OWN, 'package.json': '{}' });
    const { service, buildOptions } = stubbedDocker();
    await service.buildImage({ slug: 'shop', type: 'NODEJS' }, dir);
    expect(fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8')).toBe(service.getDockerfileForProject({ type: 'NODEJS' }));
    expect(buildOptions().labels).toEqual({ 'dropdeploy.slug': 'shop' });
    expect(buildOptions()).not.toHaveProperty('pull');
  });

  it('removes a repo-built image over the size cap', async () => {
    const dir = repoDir({ Dockerfile: OWN });
    const { service, remove } = stubbedDocker({ Size: REPO_IMAGE_MAX_BYTES + 512 * 1024 ** 2 });
    await expect(service.buildImage({ slug: 'shop', type: 'NODEJS' }, dir, { useRepo: true }))
      .rejects.toThrow('The image is 2.5 GB, over the 2.0 GB limit');
    expect(remove).toHaveBeenCalledWith({ force: true });
  });
});

describe('DockerService.checkBaseImages', () => {
  const DIGEST = `sha256:${'b'.repeat(64)}`;
  const check = (Config: Record<string, unknown>) => {
    const { service, docker } = stubbedDocker({ Config });
    const pull = jest.spyOn(docker, 'pull').mockResolvedValue({});
    const getImage = docker.getImage as jest.Mock;
    return { run: () => service.checkBaseImages([`node:22-alpine@${DIGEST}`, `node:22-alpine@${DIGEST}`]), pull, getImage };
  };

  it('pulls each base image once, by digest, and passes one without ONBUILD', async () => {
    const { run, pull, getImage } = check({ OnBuild: null });
    await run();
    expect(pull.mock.calls).toEqual([[`node@${DIGEST}`, { abortSignal: undefined }]]);
    expect(getImage).toHaveBeenCalledWith(`node@${DIGEST}`);
  });

  it('refuses a base image with ONBUILD triggers, which would run inside the build', async () => {
    const { run } = check({ OnBuild: ['ADD http://127.0.0.1:4001/ /x'] });
    await expect(run()).rejects.toThrow(`The base image node:22-alpine@${DIGEST} has ONBUILD instructions`);
  });
});

describe('DockerService.startContainer', () => {
  const start = async (Config: Record<string, unknown>) => {
    const service = new DockerService({ socketPath: '/nonexistent.sock' });
    const docker = service['docker'];
    jest.spyOn(docker, 'getImage').mockReturnValue({ inspect: async () => ({ Config }) });
    jest.spyOn(service, 'stopAndRemoveContainer').mockResolvedValue(undefined);
    jest.spyOn(service, 'findAvailablePort').mockResolvedValue(4100);
    service['ensureTenantNetwork'] = async () => undefined;
    const create = jest.spyOn(docker, 'createContainer').mockResolvedValue({ start: async () => undefined });
    await service.startContainer({
      imageName: 'dropdeploy/shop:d-1', projectType: 'NEXTJS', slug: 'shop', containerName: 'dropdeploy-shop', envVars: { PORT: '1', API_KEY: 'k' },
    });
    return create.mock.calls[0][0] as Record<string, unknown> & { HostConfig: Record<string, unknown> };
  };

  it('runs a repo-built image as uid 10001 on its EXPOSEd port, with PORT set and default memory', async () => {
    const opts = await start({ Labels: { 'dropdeploy.dockerfile': 'repo' }, ExposedPorts: { '8080/tcp': {} }, User: 'root' });
    expect(opts.User).toBe('10001:10001');
    expect(opts.ExposedPorts).toEqual({ '8080/tcp': {} });
    expect(opts.HostConfig.PortBindings).toEqual({ '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '4100' }] });
    expect(opts.Env).toEqual(['PORT=8080', 'API_KEY=k', 'DROPDEPLOY_DATA_DIR=/data']);
    expect(opts.HostConfig).toMatchObject({
      Memory: 512 * 1024 ** 2, CpuShares: 1024, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], PidsLimit: 512, NetworkMode: 'dropdeploy-tenants',
    });
  });

  it('leaves a template image as it was', async () => {
    const opts = await start({ Labels: { 'dropdeploy.slug': 'shop' }, ExposedPorts: { '8080/tcp': {} } });
    expect(opts).not.toHaveProperty('User');
    expect(opts.ExposedPorts).toEqual({ '3000/tcp': {} });
    expect(opts.Env).toEqual(['PORT=1', 'API_KEY=k', 'DROPDEPLOY_DATA_DIR=/data']);
    expect(opts.HostConfig.Memory).toBe(1024 * 1024 ** 2);
  });
});

/** buildAndDeploy with git and Docker stubbed; the clone is `workDir`. */
function deploy(workDir: string, project: Record<string, unknown>, rollbackOfId: string | null = null) {
  const row: Record<string, unknown> = { id: 'dep-1', projectId: 'p1', status: 'QUEUED', buildStep: null, rollbackOfId };
  const deploymentRepo = {
    findById: jest.fn(async () => ({ id: 'dep-0', projectId: 'p1', imageTag: 'dropdeploy/shop:d-dep-0', commitHash: 'abc1234' })),
    findByIdWithProject: jest.fn(async () => ({
      ...row,
      project: { id: 'p1', slug: 'shop', type: 'NODEJS', useStaticHosting: false, githubUrl: 'https://github.com/o/shop', branch: 'main', source: 'GITHUB', userId: 'u1', ...project },
    })),
    update: jest.fn(async (_id: string, data: Record<string, unknown>) => Object.assign(row, data)),
    activate: jest.fn(async (_id: string, _projectId: string, _slug: string, data: Record<string, unknown>) => Object.assign(row, data)),
    findActiveContainerPorts: jest.fn(async () => []),
    findWithRetainedImages: jest.fn(async () => []),
  };
  const docker = {
    checkBaseImages: jest.fn(async () => undefined),
    isRepoImage: jest.fn(async () => true),
    buildImage: jest.fn(async () => 'dropdeploy/shop:latest'),
    tagForDeployment: jest.fn(async () => 'dropdeploy/shop:d-dep-1'),
    extractStaticFiles: jest.fn(async () => undefined),
    startContainer: jest.fn(async () => 4000),
    waitUntilReady: jest.fn(async () => undefined),
    promoteContainer: jest.fn(async () => undefined),
    stopAndRemoveContainer: jest.fn(async () => undefined),
    removeSupersededImages: jest.fn(async () => undefined),
    removeImage: jest.fn(async () => undefined),
  };
  const git = { ensureRepo: async () => ({ workDir, commitHash: 'abc1234' }) };
  const envVar = { resolveForDeployment: async () => ({}) };
  const service = new DeploymentService(deploymentRepo as never, {} as never, {} as never, docker as never, git as never, envVar as never);
  return { run: () => service.buildAndDeploy('dep-1'), row, docker };
}

describe('DeploymentService.buildAndDeploy with a repo Dockerfile', () => {
  const PINNED = `FROM alpine@sha256:${'c'.repeat(64)}\n`;
  const buildOpts = (docker: { buildImage: jest.Mock }) => (docker.buildImage.mock.calls[0] as unknown[])[2] as { useRepo: boolean };

  it('builds from it when an admin allowed it, and runs a container even for a static-hosted type', async () => {
    const { run, row, docker } = deploy(repoDir({ Dockerfile: `${PINNED}EXPOSE 80\n` }), { type: 'REACT', useStaticHosting: true, allowRepoDockerfile: true });
    await expect(run()).resolves.toMatchObject({ servingMethod: 'CONTAINER' });
    expect(docker.checkBaseImages).toHaveBeenCalledWith([`alpine@sha256:${'c'.repeat(64)}`], undefined);
    expect(buildOpts(docker).useRepo).toBe(true);
    expect(docker.extractStaticFiles).not.toHaveBeenCalled();
    expect(row.buildLog).toContain("▶ Using the repository's Dockerfile");
  });

  it('uses the template when not allowed, and says why', async () => {
    const { run, row, docker } = deploy(repoDir({ Dockerfile: 'FROM alpine\n' }), { allowRepoDockerfile: false });
    await run();
    expect(buildOpts(docker).useRepo).toBe(false);
    expect(docker.checkBaseImages).not.toHaveBeenCalled();
    expect(row.buildLog).toContain('the one in your repository is not used. An admin can switch');
  });

  it('fails at SCANNING on an unpinned base image, before pulling or building', async () => {
    const { run, row, docker } = deploy(repoDir({ Dockerfile: 'FROM alpine\n' }), { allowRepoDockerfile: true });
    await expect(run()).rejects.toThrow();
    expect(row).toMatchObject({ status: 'FAILED', buildStep: 'SCANNING', failureReason: expect.stringContaining('Pin each base image by digest') });
    expect(row.buildLog).toContain('✗ Pin each base image by digest');
    expect(docker.checkBaseImages).not.toHaveBeenCalled();
    expect(docker.buildImage).not.toHaveBeenCalled();
  });

  it("rolls back to a repo-built image as a container, whatever the project's static hosting says", async () => {
    const { run, docker } = deploy(repoDir({}), { type: 'REACT', useStaticHosting: true, allowRepoDockerfile: false }, 'dep-0');
    await expect(run()).resolves.toMatchObject({ servingMethod: 'CONTAINER' });
    expect(docker.isRepoImage).toHaveBeenCalledWith('dropdeploy/shop:d-dep-0');
    expect(docker.extractStaticFiles).not.toHaveBeenCalled();
    expect(docker.stopAndRemoveContainer).not.toHaveBeenCalledWith('dropdeploy-shop');
  });

  it('fails at SCANNING on an ADD line, before any build', async () => {
    const { run, row, docker } = deploy(repoDir({ Dockerfile: 'FROM alpine\nADD http://example.com/x /x\n' }), { allowRepoDockerfile: true });
    await expect(run()).rejects.toThrow();
    expect(row).toMatchObject({ status: 'FAILED', buildStep: 'SCANNING', failureReason: expect.stringMatching(/^Your Dockerfile uses ADD, which Entrify does not allow/) });
    expect(docker.buildImage).not.toHaveBeenCalled();
  });

  it('fails on a symlinked Dockerfile without following it', async () => {
    const dir = repoDir({});
    const target = path.join(TMP, 'host-file');
    fs.writeFileSync(target, 'ADD http://example.com/x /x\n');
    fs.symlinkSync(target, path.join(dir, 'Dockerfile'));
    const { run, row, docker } = deploy(dir, { allowRepoDockerfile: true });
    await expect(run()).rejects.toThrow();
    expect(row).toMatchObject({ status: 'FAILED', buildStep: 'SCANNING', failureReason: expect.stringContaining('symbolic link') });
    expect(docker.buildImage).not.toHaveBeenCalled();
  });
});

describe('who can switch it', () => {
  const patch = (role: string, body: unknown) => {
    mockSession.role = role;
    return PATCH(
      new NextRequest('http://localhost/api/admin/projects/p1/dockerfile', { method: 'PATCH', body: JSON.stringify(body) }),
      { params: Promise.resolve({ projectId: 'p1' }) },
    );
  };
  beforeEach(() => mockSetAllowed.mockClear());

  it('admins only, with a boolean', async () => {
    expect((await patch('USER', { allowed: true })).status).toBe(403);
    expect((await patch('CONTRIBUTOR', { allowed: 'yes' })).status).toBe(400);
    expect(mockSetAllowed).not.toHaveBeenCalled();
    const res = await patch('CONTRIBUTOR', { allowed: true });
    expect(res.status).toBe(200);
    expect(mockSetAllowed).toHaveBeenCalledWith('p1', true, 'admin');
  });

  it('records each switch in the admin audit log', async () => {
    const projectRepo = { findById: async () => ({ id: 'p1', name: 'Shop', slug: 'shop' }), setAllowRepoDockerfile: jest.fn(async () => undefined) };
    const create = jest.fn(async () => ({}));
    const service = new AdminService({ findById: async () => ({ email: 'admin@entri.me' }) } as never, projectRepo as never, {} as never, {} as never, { create } as never);
    await service.setRepoDockerfileAllowed('p1', true, 'admin');
    await service.setRepoDockerfileAllowed('p1', false, 'admin');
    expect(projectRepo.setAllowRepoDockerfile.mock.calls).toEqual([['p1', true], ['p1', false]]);
    expect(create.mock.calls.map(([entry]: unknown[]) => (entry as { action: string }).action)).toEqual(['PROJECT_DOCKERFILE_ALLOWED', 'PROJECT_DOCKERFILE_DISALLOWED']);
  });

  it("an owner's project update drops the field", () => {
    expect(updateProjectSchema.parse({ name: 'shop', allowRepoDockerfile: true })).toEqual({ name: 'shop' });
  });
});
