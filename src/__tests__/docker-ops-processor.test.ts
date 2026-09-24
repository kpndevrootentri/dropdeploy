import type { Job } from 'bullmq';
import type { DockerOpRequest } from '@/lib/docker-ops';

const stopContainer = jest.fn(async () => undefined);
const executeCommand = jest.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }));
const removeProjectResources = jest.fn(async () => undefined);

jest.mock('@/services/docker', () => ({
  dockerService: { stopContainer, restartContainer: jest.fn(), getContainerInfo: jest.fn() },
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

  it.each(['caddy', 'postgres', 'dropdeploy-', 'dropdeploy-../x', 'dropdeploy-a;b'])(
    'refuses to touch %s, which is not a project container',
    async (containerName) => {
      await expect(processDockerOp(job({ op: 'stopContainer', containerName })))
        .resolves.toMatchObject({ ok: false, code: 'INVALID_DOCKER_OPERATION' });
      expect(stopContainer).not.toHaveBeenCalled();
    },
  );

  it('refuses unknown operations', async () => {
    await expect(processDockerOp(job({ op: 'createContainer', image: 'alpine', privileged: true })))
      .resolves.toMatchObject({ ok: false, message: 'Unknown operation' });
  });

  it('refuses an invalid slug for cleanup', async () => {
    await expect(processDockerOp(job({ op: 'removeProjectResources', slug: '../../etc' })))
      .resolves.toMatchObject({ ok: false });
    expect(removeProjectResources).not.toHaveBeenCalled();
  });

  it('fails the job, rather than returning details, on an internal error', async () => {
    executeCommand.mockRejectedValueOnce(new Error('connect EACCES /var/run/docker.sock'));
    await expect(processDockerOp(job({ op: 'terminal', containerName: 'dropdeploy-shop', command: 'ls' })))
      .rejects.toThrow('EACCES');
  });
});
