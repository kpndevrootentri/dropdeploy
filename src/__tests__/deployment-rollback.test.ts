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

// Redis is only used for the per-project enqueue lock.
jest.mock('@/lib/redis', () => ({
  getRedisConnection: () => ({ set: async () => 'OK', del: async () => 1, publish: async () => 1 }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DeploymentService } = require('@/services/deployment/deployment.service');

type Row = Record<string, unknown>;

function makeService(rows: Row[]) {
  const created: Row[] = [];
  const deploymentRepo = {
    findByIdWithProject: jest.fn(async (id: string) => {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row, project: { userId: 'owner' } } : null;
    }),
    findQueuedDeploymentForProject: jest.fn(async () => null),
    findBuildingDeployment: jest.fn(async () => null),
    create: jest.fn(async (data: Row) => {
      const row = { id: `new-${created.length}`, ...data };
      created.push(row);
      return row;
    }),
  };
  const queue = { add: jest.fn(async () => 'job'), remove: jest.fn(), retryFailed: jest.fn() };
  const docker = {
    extractStaticFiles: jest.fn(async (_image: string, dest: string) => {
      await fs.promises.mkdir(dest, { recursive: true });
      await fs.promises.writeFile(path.join(dest, 'index.html'), 'v2');
    }),
  };
  const service = new DeploymentService(deploymentRepo, {}, queue, docker, {}, {});
  return { service, created, queue, docker };
}

const previous = { id: 'dep-1', projectId: 'p1', status: 'DEPLOYED', imageTag: 'dropdeploy/shop:d-dep-1', subdomain: null, commitHash: 'abc1234' };
const live = { id: 'dep-2', projectId: 'p1', status: 'DEPLOYED', imageTag: 'dropdeploy/shop:d-dep-2', subdomain: 'shop', commitHash: 'def5678' };

describe('createRollback', () => {
  it('queues a deployment that re-runs the earlier image', async () => {
    const { service, created, queue } = makeService([previous, live]);
    await service.createRollback('p1', 'owner', 'dep-1');
    expect(created[0]).toMatchObject({ projectId: 'p1', rollbackOfId: 'dep-1', commitHash: 'abc1234', status: 'QUEUED' });
    expect(queue.add).toHaveBeenCalledWith({ deploymentId: 'new-0', projectId: 'p1' });
  });

  it("refuses another user's deployment", async () => {
    const { service } = makeService([previous]);
    await expect(service.createRollback('p1', 'intruder', 'dep-1')).rejects.toThrow(/not found/i);
  });

  it('refuses the deployment that is already live', async () => {
    const { service } = makeService([live]);
    await expect(service.createRollback('p1', 'owner', 'dep-2')).rejects.toThrow(/already live/);
  });

  it('refuses a deployment whose image was pruned, or that failed', async () => {
    const { service } = makeService([
      { ...previous, id: 'pruned', imageTag: null },
      { ...previous, id: 'failed', status: 'FAILED' },
    ]);
    await expect(service.createRollback('p1', 'owner', 'pruned')).rejects.toThrow(/image is still kept/);
    await expect(service.createRollback('p1', 'owner', 'failed')).rejects.toThrow(/image is still kept/);
  });
});

describe('publishStaticFiles', () => {
  afterAll(async () => { await fs.promises.rm(STATIC_DIR, { recursive: true, force: true }); });

  it('swaps the new build in and leaves no staging directories behind', async () => {
    const live = path.join(STATIC_DIR, 'shop');
    await fs.promises.mkdir(live, { recursive: true });
    await fs.promises.writeFile(path.join(live, 'index.html'), 'v1');
    await fs.promises.writeFile(path.join(live, 'old-only.js'), 'stale');

    const { service } = makeService([]);
    await service['publishStaticFiles']('img', 'shop', 'dep-9');

    expect(await fs.promises.readFile(path.join(live, 'index.html'), 'utf8')).toBe('v2');
    expect(fs.existsSync(path.join(live, 'old-only.js'))).toBe(false);
    expect(await fs.promises.readdir(STATIC_DIR)).toEqual(['shop']);
  });

  it('keeps the live site when extraction fails', async () => {
    const live = path.join(STATIC_DIR, 'blog');
    await fs.promises.mkdir(live, { recursive: true });
    await fs.promises.writeFile(path.join(live, 'index.html'), 'v1');

    const { service, docker } = makeService([]);
    docker.extractStaticFiles.mockRejectedValueOnce(new Error('image has no /usr/share/nginx/html'));
    await expect(service['publishStaticFiles']('img', 'blog', 'dep-10')).rejects.toThrow();

    expect(await fs.promises.readFile(path.join(live, 'index.html'), 'utf8')).toBe('v1');
    expect((await fs.promises.readdir(STATIC_DIR)).filter((n) => n.startsWith('blog'))).toEqual(['blog']);
  });
});
