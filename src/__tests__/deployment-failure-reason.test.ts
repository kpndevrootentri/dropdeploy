import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-reason-'));
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
  STATIC_SERVE_DIR: WORK_DIR,
  PROJECTS_DIR: '/srv/projects',
  BULLMQ_JOB_TIMEOUT_MS: String(15 * 60_000),
});

jest.mock('@/lib/redis', () => ({ getRedisConnection: () => ({ publish: async () => 1 }) }));
jest.mock('@/services/git-provider', () => ({ gitProviderService: { getTokenForDeployment: async () => null } }));
jest.mock('@/lib/type-detector', () => ({ detectFromFiles: async () => null }));
const mockScan = jest.fn(async () => ({ blocked: [] as string[] }));
jest.mock('@/services/deployment/package-scanner', () => ({ scanPackages: () => mockScan() }));
const mockPrisma = { deployment: { updateMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => []) }, project: { findMany: jest.fn(async () => []) } };
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Required, not imported: the env above must be set before the services read their config.
/* eslint-disable @typescript-eslint/no-require-imports */
const { DeploymentService } = require('@/services/deployment/deployment.service');
const { failureReason } = require('@/services/deployment/failure-reason');
const { DeploymentRepository } = require('@/repositories/deployment.repository');
const { CohortRepository } = require('@/repositories/cohort.repository');
const { ProjectRepository } = require('@/repositories/project.repository');
const { UploadDeployService } = require('@/services/upload/upload.deploy.service');
const { DockerService } = require('@/services/docker/docker.service');
/* eslint-enable @typescript-eslint/no-require-imports */

afterAll(() => fs.rmSync(WORK_DIR, { recursive: true, force: true }));

describe('failureReason', () => {
  it('picks the first line of the output that reads like an error, skipping warnings and headings', () => {
    const message = [
      "The command '/bin/sh -c npm run build' returned a non-zero code: 1",
      '',
      'Build output (last 20 lines):',
      '[10:00:00.000] npm warn deprecated inflight@1.0.6: not supported',
      '[10:00:00.001] npm error Lifecycle script `build` failed with error:',
      '[10:00:00.002] npm error Missing script: "build"',
      '[10:00:00.003] npm error A complete log of this run can be found in: /root/.npm/_logs/x.log',
    ].join('\n');
    expect(failureReason(message)).toBe('npm error Missing script: "build"');
  });

  it("drops the colour codes Docker puts on a build's stderr", () => {
    expect(failureReason("The command returned a non-zero code: 1\n[10:00:00.000] \u001b[91msrc/app.ts(3,7): error TS2322: bad\u001b[0m")).toBe('src/app.ts(3,7): error TS2322: bad');
  });

  it('falls back to the summary line when the output has no error line', () => {
    expect(failureReason('The app did not start listening within 60s.\nServer ready\n')).toBe('The app did not start listening within 60s.');
  });

  it('never shows an env var value, even one printed by the app or split over lines', () => {
    const message = 'The app exited during startup (exit code 1).\nError: bad DATABASE_URL postgres://u:hunter22@db/x and key -----BEGIN-----abcdef';
    const reason = failureReason(message, ['postgres://u:hunter22@db/x', '-----BEGIN-----abcdef\nghijkl\n-----END-----']);
    expect(reason).toBe('Error: bad DATABASE_URL [REDACTED] and key [REDACTED]');
  });

  it('skips the heading lines npm and webpack builds print before the cause', () => {
    const tail = (...lines: string[]) => ["The command '/bin/sh -c npm ci' returned a non-zero code: 1", '', 'Build output (last 20 lines):', ...lines.map((l) => `[10:00:00.000] ${l}`)].join('\n');
    expect(failureReason(tail('npm error code ERESOLVE', 'npm error ERESOLVE could not resolve', 'npm error', 'npm error While resolving: app@0.1.0', 'npm error peer react@"^18.0.0" from some-lib@1.0.0')))
      .toBe('npm error ERESOLVE could not resolve');
    expect(failureReason(tail('npm error code E404', 'npm error 404 Not Found - GET https://registry.npmjs.org/reactt - Not found', 'npm error 404')))
      .toBe('npm error 404 Not Found - GET https://registry.npmjs.org/reactt - Not found');
    expect(failureReason(tail('Failed to compile.', '', './src/app/page.tsx', "Module not found: Can't resolve '@/components/Foo'", '> Build failed because of webpack errors')))
      .toBe("Module not found: Can't resolve '@/components/Foo'");
  });

  it("skips npm ci's refusal of a repo with no lockfile, for the npm install error after it", () => {
    // Abridged from a real build of a repo with a misspelled dependency and no package-lock.json.
    const message = "The command '/bin/sh -c ... (npm ci || npm install); fi' returned a non-zero code: 1\n\nBuild output (last 20 lines):\n" +
      '[03:22:10.040]  ---> Running in edb652b9f961\n' +
      '[03:22:10.261] \u001b[91mnpm error code EUSAGE\n\u001b[0m[03:22:10.262] \u001b[91mnpm error\n' +
      'npm error The `npm ci` command can only install with an existing package-lock.json or\nnpm error Usage:\nnpm error npm ci\n' +
      'npm error Run "npm help ci" for more info\n\u001b[0m[03:22:10.262] \u001b[91mnpm error A complete log of this run can be found in: /home/node/.npm/_logs/a.log\n' +
      '\u001b[0m[03:22:10.818] \u001b[91mnpm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/reactt-no-such-pkg - Not found\n' +
      "\u001b[0m[03:22:10.818] \u001b[91mnpm error 404\nnpm error 404  'reactt-no-such-pkg@^1.0.0' is not in this registry.\n";
    expect(failureReason(message)).toBe('npm error 404 Not Found - GET https://registry.npmjs.org/reactt-no-such-pkg - Not found');
  });

  it("cuts the server's own directories out of paths", () => {
    expect(failureReason(`ENOSPC: no space left on device, open '${WORK_DIR}/shop.next-abc/index.html'`)).toBe("ENOSPC: no space left on device, open 'shop.next-abc/index.html'");
    expect(failureReason(`ENOENT: no such file or directory, rename '${WORK_DIR}/shop.next-abc' -> '${WORK_DIR}/shop'`)).toBe("ENOENT: no such file or directory, rename 'shop.next-abc' -> 'shop'");
    expect(failureReason("fatal: destination path '/srv/projects/shop' already exists and is not an empty directory.")).toBe("fatal: destination path 'shop' already exists and is not an empty directory.");
    expect(failureReason("EACCES: permission denied, mkdir '/srv/projects'")).toBe("EACCES: permission denied, mkdir '…'");
  });

  it('cuts the directories before redacting, so an env value that is part of one cannot keep the path', () => {
    expect(failureReason("EACCES: permission denied, mkdir '/srv/projects/shop'", ['projects'])).toBe("EACCES: permission denied, mkdir 'shop'");
  });

  it('caps the length after redacting, so no part of a value survives the cut', () => {
    const secret = 's'.repeat(400);
    const reason = failureReason(`Error: ${'x'.repeat(280)}${secret}`, [secret]);
    expect(reason.length).toBeLessThanOrEqual(300);
    expect(reason).not.toContain('sss');
    expect(failureReason(`Error: ${'y'.repeat(500)}`)).toHaveLength(300);
  });
});

/** A deployment that goes through buildAndDeploy, with Docker and git stubbed out. */
function setup(over: { project?: Record<string, unknown>; rollbackOfId?: string } = {}) {
  const row: Record<string, unknown> = { id: 'dep-1', projectId: 'p1', status: 'QUEUED', buildStep: null, rollbackOfId: over.rollbackOfId ?? null };
  const project = {
    id: 'p1', slug: 'shop', type: 'NODEJS', useStaticHosting: false, githubUrl: 'https://github.com/o/shop',
    branch: 'main', source: 'GITHUB', userId: 'u1', ...over.project,
  };
  const deploymentRepo = {
    findByIdWithProject: jest.fn(async () => ({ ...row, project })),
    findById: jest.fn(async () => null),
    update: jest.fn(async (_id: string, data: Record<string, unknown>) => Object.assign(row, data)),
    activate: jest.fn(async () => row),
    findActiveContainerPorts: jest.fn(async () => []),
    findWithRetainedImages: jest.fn(async () => []),
  };
  const docker = {
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
  const git = { ensureRepo: jest.fn(async () => ({ workDir: WORK_DIR, commitHash: 'abc1234' })) };
  const envVar = { resolveForDeployment: jest.fn(async () => ({ API_KEY: 'sk-live-123456' })) };
  const service = new DeploymentService(deploymentRepo as never, {} as never, {} as never, docker as never, git as never, envVar as never);
  return { service, row, docker, git, deploymentRepo };
}

describe('each way a deployment fails records where and why', () => {
  beforeEach(() => mockScan.mockResolvedValue({ blocked: [] }));

  it('clone: a revoked token', async () => {
    const { service, row, git } = setup();
    git.ensureRepo.mockRejectedValueOnce(new Error('fatal: Authentication failed for https://github.com/o/shop'));
    await expect(service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(row).toMatchObject({ status: 'FAILED', buildStep: 'CLONING', failureReason: expect.stringMatching(/^Git authentication failed for GITHUB\. .*reconnect/) });
  });

  it('clone: a branch that does not exist, without the server path git prints first', async () => {
    const { service, row, git } = setup();
    git.ensureRepo.mockRejectedValueOnce(new Error("Cloning into '/srv/projects/shop'...\nwarning: Could not find remote branch dev to clone.\nfatal: Remote branch dev not found in upstream origin\n"));
    await expect(service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(row).toMatchObject({ buildStep: 'CLONING', failureReason: 'fatal: Remote branch dev not found in upstream origin' });
  });

  it("clone: a network failure keeps git's own line; only a 401 or 403 is blamed on the token", async () => {
    const offline = setup();
    offline.git.ensureRepo.mockRejectedValueOnce(new Error("Cloning into '/srv/projects/shop'...\nfatal: unable to access 'https://github.com/o/shop/': Could not resolve host: github.com\n"));
    await expect(offline.service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(offline.row).toMatchObject({ buildStep: 'CLONING', failureReason: "fatal: unable to access 'https://github.com/o/shop/': Could not resolve host: github.com" });

    const forbidden = setup();
    forbidden.git.ensureRepo.mockRejectedValueOnce(new Error("fatal: unable to access 'https://github.com/o/shop/': The requested URL returned error: 403"));
    await expect(forbidden.service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(forbidden.row.failureReason).toMatch(/^Git authentication failed for GITHUB\./);
  });

  it('package scan: a blocked package', async () => {
    mockScan.mockResolvedValueOnce({ blocked: ['event-stream'] });
    const { service, row } = setup();
    await expect(service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(row).toMatchObject({ buildStep: 'SCANNING', failureReason: 'Blocked package(s) detected: event-stream' });
  });

  it('build: the failing line of the build output, with env var values redacted', async () => {
    const { service, row, docker } = setup();
    docker.buildImage.mockRejectedValueOnce(new Error(
      "The command '/bin/sh -c npm run build' returned a non-zero code: 1\n\nBuild output (last 20 lines):\n" +
      '[10:00:00.000] Error: invalid key sk-live-123456\n',
    ));
    await expect(service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(row).toMatchObject({ buildStep: 'BUILDING_IMAGE', failureReason: 'Error: invalid key [REDACTED]' });
  });

  it('static export: extraction fails', async () => {
    const { service, row, docker } = setup({ project: { type: 'REACT', useStaticHosting: true } });
    docker.extractStaticFiles.mockRejectedValueOnce(new Error('No build output found at /app/dist'));
    await expect(service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(row).toMatchObject({ buildStep: 'EXTRACTING', failureReason: 'No build output found at /app/dist' });
  });

  it("start: the app crashes, with its own error line and no env var value (container output isn't scrubbed)", async () => {
    const { service, row, docker } = setup();
    docker.waitUntilReady.mockRejectedValueOnce(new Error(
      'The app exited during startup (exit code 1).\nlistening...\nError: key sk-live-123456 was rejected\n    at Module._resolveFilename',
    ));
    await expect(service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(row).toMatchObject({ buildStep: 'STARTING', failureReason: 'Error: key [REDACTED] was rejected' });
    expect(String(row.buildLog)).toContain('Error: key [REDACTED] was rejected');
    expect(String(row.buildLog)).not.toContain('sk-live-123456');
    expect(String(row.buildLog)).toContain('previous deployment is still live');
  });

  it('start: the app never listens', async () => {
    const { service, row, docker } = setup();
    docker.waitUntilReady.mockRejectedValueOnce(new Error('The app did not start listening within 60s.\n(no output)'));
    await expect(service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(row).toMatchObject({ buildStep: 'STARTING', failureReason: 'The app did not start listening within 60s.' });
  });

  it('rollback: the image is gone', async () => {
    const { service, row } = setup({ rollbackOfId: 'dep-0' });
    await expect(service.buildAndDeploy('dep-1')).rejects.toThrow();
    expect(row).toMatchObject({ buildStep: 'STARTING', failureReason: expect.stringContaining('no longer has an image') });
  });

  it('timeout: the worker aborted the job', async () => {
    const { service, row, docker } = setup();
    const controller = new AbortController();
    docker.buildImage.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('The operation was aborted');
    });
    await expect(service.buildAndDeploy('dep-1', controller.signal)).rejects.toThrow();
    expect(row).toMatchObject({ buildStep: 'BUILDING_IMAGE', failureReason: 'Stopped after 15 minutes, the longest a build may run.' });
  });

  it('a platform slug, and a project with no repository', async () => {
    const reserved = setup({ project: { slug: 'caddy' } });
    await expect(reserved.service.buildAndDeploy('dep-1')).resolves.toBeNull();
    expect(reserved.row).toMatchObject({ status: 'FAILED', failureReason: expect.stringContaining('reserved for the platform') });

    const noRepo = setup({ project: { githubUrl: null } });
    await expect(noRepo.service.buildAndDeploy('dep-1')).resolves.toBeNull();
    expect(noRepo.row).toMatchObject({ status: 'FAILED', failureReason: 'The project has no repository to build from.' });
  });

  it('a deployment that succeeds records no reason', async () => {
    const { service, row } = setup();
    await expect(service.buildAndDeploy('dep-1')).resolves.toMatchObject({ servingMethod: 'CONTAINER' });
    expect(row.failureReason).toBeUndefined();
  });

  it('a worker restart mid-build', async () => {
    await new DeploymentRepository().markBuildingAsFailed();
    expect(mockPrisma.deployment.updateMany).toHaveBeenCalledWith({
      where: { status: 'BUILDING' },
      data: expect.objectContaining({ status: 'FAILED', failureReason: expect.stringContaining('build server restarted') }),
    });
  });

  it('an upload that cannot be extracted', async () => {
    const row: Record<string, unknown> = {};
    const repo = { create: async () => ({ id: 'dep-u' }), update: async (_id: string, data: Record<string, unknown>) => Object.assign(row, data) };
    const service = new UploadDeployService(repo as never);
    await expect(service.deploy(Buffer.from('not a zip'), 'zip', { id: 'p1', slug: 'site' } as never)).rejects.toThrow();
    expect(row).toMatchObject({ status: 'FAILED', failureReason: 'Invalid or corrupted zip file' });
  });

  it("an upload the server cannot write, with the server's directory cut from the log too", async () => {
    jest.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error(`ENOSPC: no space left on device, open '${WORK_DIR}/site.staging-1/index.html'`));
    const row: Record<string, unknown> = {};
    const repo = { create: async () => ({ id: 'dep-u' }), update: async (_id: string, data: Record<string, unknown>) => Object.assign(row, data) };
    const service = new UploadDeployService(repo as never);
    await expect(service.deploy(Buffer.from('<h1>hi</h1>'), 'html', { id: 'p1', slug: 'site' } as never)).rejects.toThrow('ENOSPC');
    expect(row).toMatchObject({ status: 'FAILED', failureReason: "ENOSPC: no space left on device, open 'site.staging-1/index.html'" });
    expect(row.buildLog).toBe(row.failureReason);
  });

  it('retrying clears the old reason', async () => {
    const row = { id: 'dep-1', projectId: 'p1', status: 'FAILED', buildStep: 'BUILDING_IMAGE', failureReason: 'boom', project: { userId: 'u1' } };
    const repo = {
      findByIdWithProject: async () => row,
      update: jest.fn(async (_id: string, data: Record<string, unknown>) => Object.assign(row, data)),
      findBuildingDeployment: async () => null,
    };
    const service = new DeploymentService(repo as never, {} as never, { retryFailed: jest.fn() } as never, {} as never, {} as never, {} as never);
    await service.retryFailedDeployment('dep-1', 'u1');
    expect(row).toMatchObject({ status: 'QUEUED', buildStep: null, failureReason: null });
  });
});

describe('the lists owners, mentors and admins read carry the step and reason', () => {
  const selected = (fn: jest.Mock) => JSON.stringify((fn.mock.calls[0] as unknown[])[0]);

  it("a project's deployment list (owner, mentor and admin history)", async () => {
    await new DeploymentRepository().findByProjectId('p1');
    expect(selected(mockPrisma.deployment.findMany)).toMatch(/"buildStep":true.*"failureReason":true/);
    expect(selected(mockPrisma.deployment.findMany)).not.toContain('buildLog');
  });

  it("a batch's projects (mentor batch page) and the admin projects table", async () => {
    await new CohortRepository().listProjects('c1');
    expect(selected(mockPrisma.project.findMany)).toMatch(/"deployments":\{.*"buildStep":true,"failureReason":true/);
    mockPrisma.project.findMany.mockClear();
    await new ProjectRepository().findAll();
    expect(selected(mockPrisma.project.findMany)).toMatch(/"deployments":\{.*"buildStep":true,"failureReason":true/);
  });
});

describe('the build log', () => {
  it('hides each line of a multi-line env value, as the failure reason does', async () => {
    const service = new DockerService({ socketPath: '/nonexistent.sock' });
    const docker = service['docker'];
    jest.spyOn(docker, 'buildImage').mockResolvedValue({});
    jest.spyOn(docker.modem, 'followProgress').mockImplementation((...args: unknown[]) => {
      const [, done, progress] = args as [unknown, (err: null, out: unknown[]) => void, (e: { stream: string }) => void];
      progress({ stream: 'key: -----BEGIN KEY-----\n' });
      progress({ stream: 'abcdef123456\n' });
      done(null, []);
    });
    jest.spyOn(docker, 'getImage').mockReturnValue({ inspect: async () => ({}) });
    const lines: string[] = [];
    const contextDir = fs.mkdtempSync(path.join(WORK_DIR, 'ctx-'));
    await service.buildImage({ slug: 'shop', type: 'NODEJS' }, contextDir, {
      secretValues: ['-----BEGIN KEY-----\nabcdef123456\n-----END KEY-----'],
      onLog: (l: string) => lines.push(l),
    });
    expect(lines.join('')).toContain('key: [REDACTED]');
    expect(lines.join('')).not.toMatch(/BEGIN KEY|abcdef123456/);
  });
});
