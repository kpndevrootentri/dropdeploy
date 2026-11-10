import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const STATIC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'static-sites-'));
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
  STATIC_SERVE_DIR: STATIC_DIR,
});

jest.mock('@/lib/redis', () => ({
  getRedisConnection: () => ({ set: async () => 'OK', del: async () => 1, publish: async () => 1 }),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { DockerService } = require('@/services/docker/docker.service');
const { removeProjectResources } = require('@/services/project/project-cleanup');
const { DeploymentService } = require('@/services/deployment/deployment.service');
/* eslint-enable @typescript-eslint/no-require-imports */

afterAll(() => fs.rmSync(STATIC_DIR, { recursive: true, force: true }));

// A project created before `caddy` was reserved owns the edge container's name.
describe('DockerService refuses platform resources', () => {
  function service() {
    const docker = new DockerService({ socketPath: '/nonexistent.sock' });
    const getContainer = jest.spyOn(docker['docker'], 'getContainer');
    return { docker, getContainer };
  }

  it.each([
    ['stopAndRemoveContainer', ['dropdeploy-caddy']],
    ['stopContainer', ['dropdeploy-caddy']],
    ['restartContainer', ['dropdeploy-caddy']],
    ['stopAndRemoveContainer', ['dropdeploy-tenants']],
    ['promoteContainer', ['caddy', 'dropdeploy-caddy-next-abcd1234', 0]],
  ])('%s(%j) throws before touching Docker', async (method, args) => {
    const { docker, getContainer } = service();
    await expect(docker[method](...args)).rejects.toMatchObject({ code: 'INVALID_DOCKER_OPERATION', statusCode: 400 });
    expect(getContainer).not.toHaveBeenCalled();
  });

  it('still acts on a tenant container', async () => {
    const { docker, getContainer } = service();
    await expect(docker.stopAndRemoveContainer('dropdeploy-shop')).resolves.toBeUndefined();
    expect(getContainer).toHaveBeenCalledWith('dropdeploy-shop');
  });

  it('stops project cleanup before it deletes anything', async () => {
    fs.mkdirSync(path.join(STATIC_DIR, 'caddy'));
    await expect(removeProjectResources('caddy', service().docker)).rejects.toMatchObject({ code: 'INVALID_DOCKER_OPERATION' });
    expect(fs.existsSync(path.join(STATIC_DIR, 'caddy'))).toBe(true);
  });
});

describe('buildAndDeploy with a platform slug', () => {
  function makeService(slug: string) {
    const project = { id: 'p1', slug, type: 'NODEJS', useStaticHosting: false, githubUrl: 'https://github.com/a/b', userId: 'u1' };
    const deploymentRepo = {
      findByIdWithProject: jest.fn(async () => ({ id: 'dep-2', rollbackOfId: 'dep-1', project })),
      findById: jest.fn(async () => ({ id: 'dep-1', projectId: 'p1', imageTag: `dropdeploy/${slug}:d-dep-1`, commitHash: 'abc1234' })),
      update: jest.fn(async () => ({})),
      activate: jest.fn(async () => ({})),
      findActiveContainerPorts: jest.fn(async () => []),
      findWithRetainedImages: jest.fn(async () => []),
    };
    const docker = {
      startContainer: jest.fn(async () => 4000),
      waitUntilReady: jest.fn(async () => undefined),
      promoteContainer: jest.fn(async () => undefined),
      stopAndRemoveContainer: jest.fn(async () => undefined),
      removeSupersededImages: jest.fn(async () => undefined),
      removeImage: jest.fn(async () => undefined),
    };
    const git = { ensureRepo: jest.fn() };
    const envVar = { resolveForDeployment: jest.fn(async () => ({})) };
    const service = new DeploymentService(deploymentRepo, {}, {}, docker, git, envVar);
    return { service, deploymentRepo, docker, git };
  }

  it('fails a deploy of `caddy` before any container work', async () => {
    const { service, deploymentRepo, docker, git } = makeService('caddy');
    await expect(service.buildAndDeploy('dep-2')).resolves.toBeNull();
    expect(deploymentRepo.update).toHaveBeenCalledTimes(1);
    expect(deploymentRepo.update).toHaveBeenCalledWith('dep-2', expect.objectContaining({
      status: 'FAILED',
      buildLog: expect.stringContaining('reserved for the platform'),
    }));
    for (const fn of Object.values(docker)) expect(fn).not.toHaveBeenCalled();
    expect(git.ensureRepo).not.toHaveBeenCalled();
  });

  it('still deploys a normal project', async () => {
    const { service, docker, deploymentRepo } = makeService('shop');
    await expect(service.buildAndDeploy('dep-2')).resolves.toMatchObject({ slug: 'shop', servingMethod: 'CONTAINER', containerPort: 4000 });
    expect(docker.promoteContainer).toHaveBeenCalledWith('shop', expect.stringMatching(/^dropdeploy-shop-next-/));
    expect(deploymentRepo.activate).toHaveBeenCalled();
  });
});
