import type { Job } from 'bullmq';
import type { DockerOpRequest } from '@/lib/docker-ops';

const stopContainer = jest.fn(async () => undefined);
const executeCommand = jest.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }));
const removeProjectResources = jest.fn(async () => undefined);
const restartContainer = jest.fn(async () => undefined);
const getContainerInfo = jest.fn(async () => null);
const getContainerLogs = jest.fn(async () => 'log');
const removeSupersededImages = jest.fn(async () => undefined);

jest.mock('@/services/docker', () => ({
  dockerService: {
    stopContainer,
    restartContainer,
    getContainerInfo,
    getContainerLogs,
    getContainerStats: jest.fn(),
    removeSupersededImages,
  },
}));
jest.mock('@/services/docker/docker-terminal.service', () => ({
  dockerTerminalService: { executeCommand, executeSlashCommand: jest.fn() },
}));
jest.mock('@/services/project/project-cleanup', () => ({ removeProjectResources }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { processDockerOp } = require('@/workers/docker-ops.processor');

const job = (data: unknown): Job<DockerOpRequest> => ({ data } as Job<DockerOpRequest>);

describe('processDockerOp', () => {
  afterEach(() => jest.clearAllMocks());

  it('runs an operation on a project container', async () => {
    await expect(processDockerOp(job({ op: 'stopContainer', containerName: 'dropdeploy-shop' })))
      .resolves.toEqual({ ok: true, value: null });
    expect(stopContainer).toHaveBeenCalledWith('dropdeploy-shop');
  });

  it('refuses container stats for a non-project container', async () => {
    await expect(processDockerOp(job({ op: 'containerStats', containerName: 'postgres' })))
      .resolves.toMatchObject({ ok: false, code: 'INVALID_DOCKER_OPERATION' });
  });

  it.each(['caddy', 'postgres', 'dropdeploy-', 'dropdeploy-../x', 'dropdeploy-a;b'])(
    'refuses to touch %s, which is not a project container',
    async (containerName) => {
      await expect(processDockerOp(job({ op: 'stopContainer', containerName })))
        .resolves.toMatchObject({ ok: false, code: 'INVALID_DOCKER_OPERATION' });
      expect(stopContainer).not.toHaveBeenCalled();
    },
  );

  // A project created before `caddy` was reserved owns the name of the edge container.
  it.each([
    { op: 'terminal', containerName: 'dropdeploy-caddy', command: 'ls' },
    { op: 'containerInfo', containerName: 'dropdeploy-caddy' },
    { op: 'stopContainer', containerName: 'dropdeploy-caddy' },
    { op: 'restartContainer', containerName: 'dropdeploy-caddy' },
    { op: 'stopContainer', containerName: 'dropdeploy-tenants' },
  ])('refuses $op on a platform resource ($containerName)', async (request) => {
    await expect(processDockerOp(job(request)))
      .resolves.toMatchObject({ ok: false, code: 'INVALID_DOCKER_OPERATION', status: 400 });
    expect(stopContainer).not.toHaveBeenCalled();
    expect(restartContainer).not.toHaveBeenCalled();
    expect(getContainerInfo).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('still cleans up a normal project', async () => {
    await expect(processDockerOp(job({ op: 'removeProjectResources', slug: 'shop' })))
      .resolves.toEqual({ ok: true, value: null });
    expect(removeProjectResources).toHaveBeenCalledWith('shop', expect.anything());
  });

  it('refuses unknown operations', async () => {
    await expect(processDockerOp(job({ op: 'createContainer', image: 'alpine', privileged: true })))
      .resolves.toMatchObject({ ok: false, message: 'Unknown operation' });
  });

  it('refuses an invalid slug for cleanup', async () => {
    await expect(processDockerOp(job({ op: 'removeProjectResources', slug: '../../etc' })))
      .resolves.toMatchObject({ ok: false });
    expect(removeProjectResources).not.toHaveBeenCalled();
  });

  it('refuses an invalid slug for image pruning', async () => {
    await expect(processDockerOp(job({ op: 'removeSupersededImages', slug: 'a b' })))
      .resolves.toMatchObject({ ok: false });
    expect(removeSupersededImages).not.toHaveBeenCalled();
  });

  it('fails the job, rather than returning details, on an internal error', async () => {
    executeCommand.mockRejectedValueOnce(new Error('connect EACCES /var/run/docker.sock'));
    await expect(processDockerOp(job({ op: 'terminal', containerName: 'dropdeploy-shop', command: 'ls' })))
      .rejects.toThrow('EACCES');
  });

  it('refuses container logs for a non-project container', async () => {
    await expect(processDockerOp(job({ op: 'containerLogs', containerName: 'postgres', tail: 100 })))
      .resolves.toMatchObject({ ok: false, code: 'INVALID_DOCKER_OPERATION' });
    expect(getContainerLogs).not.toHaveBeenCalled();
  });

  it.each([[100, 100], [0, 1], [-5, 1], [10_000, 500], [12.9, 12], ['abc', 200], [undefined, 200]])(
    'clamps a log tail of %p to %p lines',
    async (tail, expected) => {
      await processDockerOp(job({ op: 'containerLogs', containerName: 'dropdeploy-shop', tail }));
      expect(getContainerLogs).toHaveBeenCalledWith('dropdeploy-shop', expected);
    },
  );
});
