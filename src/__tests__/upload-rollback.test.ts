import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const STATIC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'static-sites-'));
const UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
  STATIC_SERVE_DIR: STATIC_DIR,
  UPLOADS_DIR,
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UploadDeployService, KEPT_UPLOADS } = require('@/services/upload/upload.deploy.service');

type Row = { id: string; projectId: string; status: string; subdomain: string | null; rollbackOfId?: string };

function makeService() {
  const rows: Row[] = [];
  const deploymentRepo = {
    create: jest.fn(async (data: Omit<Row, 'id' | 'subdomain'>) => {
      const row: Row = { id: `d${rows.length + 1}`, subdomain: null, ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async (id: string, data: Partial<Row>) => Object.assign(rows.find((r) => r.id === id)!, data)),
    clearSubdomainForOtherDeployments: jest.fn(async (projectId: string, _sub: string, keepId: string) => {
      rows.filter((r) => r.projectId === projectId && r.id !== keepId).forEach((r) => { r.subdomain = null; });
    }),
    findById: jest.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    // Newest first, like the real repository.
    findByProjectId: jest.fn(async (projectId: string, limit: number) =>
      rows.filter((r) => r.projectId === projectId).reverse().slice(0, limit)),
  };
  return { service: new UploadDeployService(deploymentRepo), rows };
}

const project = { id: 'p1', slug: 'shop' };
const live = (): string => fs.readFileSync(path.join(STATIC_DIR, 'shop', 'index.html'), 'utf8');
const kept = (): string[] => fs.readdirSync(path.join(UPLOADS_DIR, 'shop')).sort();

describe('upload versions', () => {
  it('keeps the last uploads and rolls back to a kept one', async () => {
    const { service, rows } = makeService();
    for (let v = 1; v <= KEPT_UPLOADS + 1; v++) {
      await service.deploy(Buffer.from(`v${v}`), 'html', project);
    }
    expect(live()).toBe(`v${KEPT_UPLOADS + 1}`);
    // d1 is pruned; the newest five, including the live one, stay.
    expect(kept()).toEqual(['d2.html', 'd3.html', 'd4.html', 'd5.html', 'd6.html']);

    const { deployment } = await service.rollback(project, 'd3');
    expect(live()).toBe('v3');
    expect(deployment).toMatchObject({ rollbackOfId: 'd3', status: 'DEPLOYED', subdomain: 'shop' });
    expect(rows.find((r) => r.id === 'd6')?.subdomain).toBeNull();
  });

  it('refuses a pruned upload, the live one, and another project\'s', async () => {
    const { service } = makeService();
    for (let v = 1; v <= KEPT_UPLOADS + 1; v++) {
      await service.deploy(Buffer.from(`v${v}`), 'html', project);
    }
    await expect(service.rollback(project, 'd1')).rejects.toThrow('no longer kept');
    await expect(service.rollback(project, `d${KEPT_UPLOADS + 1}`)).rejects.toThrow('already live');
    await expect(service.rollback({ id: 'other', slug: 'other' }, 'd2')).rejects.toThrow('not found');
    expect(live()).toBe(`v${KEPT_UPLOADS + 1}`);
  });
});
