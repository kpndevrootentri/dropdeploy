Object.assign(process.env, {
  DATABASE_URL: 'postgresql://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
});

type Row = { id: string; projectId: string; key: string; environment: string; encryptedValue: string; iv: string; authTag: string };
type Upsert = { where: { projectId_key_environment: { projectId: string; key: string; environment: string } }; create: Omit<Row, 'id'>; update: Partial<Row> };

// An in-memory environment_variables table. Like a PrismaPromise, upsert() does nothing until $transaction runs it,
// and $transaction commits all of its upserts or none.
const mockDb = { rows: new Map<string, Row>(), failOnKey: null as string | null, nextId: 1 };
const mockAudit: { action: string; targetKey: string }[] = [];
const mockAuditWrites = { count: 0 };
type Where = { projectId_key_environment: { projectId: string; key: string; environment: string } };
const rowId = ({ projectId, key, environment }: Where['projectId_key_environment']): string => `${projectId}|${key}|${environment}`;
jest.mock('@/lib/prisma', () => ({
  prisma: {
    environmentVariable: {
      findMany: async ({ where }: { where: { projectId: string } }) =>
        [...mockDb.rows.values()].filter((r) => r.projectId === where.projectId),
      count: async ({ where }: { where: { projectId: string } }) =>
        [...mockDb.rows.values()].filter((r) => r.projectId === where.projectId).length,
      findUnique: async ({ where }: { where: Where }) => mockDb.rows.get(rowId(where.projectId_key_environment)) ?? null,
      create: async ({ data }: { data: Omit<Row, 'id'> }) => {
        const row = { id: `ev${mockDb.nextId++}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        mockDb.rows.set(rowId(data), row);
        return row;
      },
      upsert: (args: Upsert) => ({ args }),
    },
    $transaction: async (ops: { args: Upsert }[]) => {
      const next = new Map(mockDb.rows);
      for (const { args } of ops) {
        const { projectId, key, environment } = args.where.projectId_key_environment;
        if (key === mockDb.failOnKey) throw new Error('connection lost');
        const id = rowId({ projectId, key, environment });
        const found = next.get(id);
        next.set(id, found ? { ...found, ...args.update } : { id: `ev${mockDb.nextId++}`, ...args.create });
      }
      mockDb.rows = next;
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; targetKey: string } }) => {
        mockAudit.push(data);
        mockAuditWrites.count++;
      },
      createMany: async ({ data }: { data: { action: string; targetKey: string }[] }) => {
        mockAudit.push(...data);
        mockAuditWrites.count++;
      },
    },
  },
}));

const mockSession = { userId: 'owner', email: 'o@entri.me', role: 'USER', mustResetPassword: false };
jest.mock('@/lib/get-session', () => ({ getSession: async () => mockSession }));
jest.mock('@/services/project', () => {
  const { NotFoundError } = jest.requireActual('@/lib/errors');
  return {
    projectService: {
      getById: async (id: string, userId: string) => {
        if (id !== 'p1' || userId === 'intruder') throw new NotFoundError('Project');
        return { id, userId };
      },
    },
  };
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { NextRequest } = require('next/server');
const { POST } = require('@/app/api/projects/[id]/env-vars/bulk/route');
const { POST: createOne } = require('@/app/api/projects/[id]/env-vars/route');
const { encryptionService } = require('@/services/encryption');
const { checkEnvVarRateLimit } = require('@/lib/rate-limit');
/* eslint-enable @typescript-eslint/no-require-imports */

async function bulk(body: unknown, { projectId = 'p1', userId = 'owner' } = {}): Promise<{ status: number; json: { success: boolean; data?: unknown; error?: { message: string } } }> {
  mockSession.userId = userId;
  const res = await POST(
    new NextRequest(`http://localhost/api/projects/${projectId}/env-vars/bulk`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: projectId }) },
  );
  return { status: res.status, json: await res.json() };
}

const stored = (): Record<string, string> =>
  Object.fromEntries([...mockDb.rows.values()].map((r) => [`${r.key}@${r.environment}`, encryptionService.decrypt(r)]));

beforeEach(() => {
  mockDb.rows = new Map();
  mockDb.failOnKey = null;
  mockAudit.length = 0;
  mockAuditWrites.count = 0;
});

describe('POST /api/projects/[id]/env-vars/bulk', () => {
  it('saves every variable, encrypted, and logs each key like a single create', async () => {
    const res = await bulk({ content: 'A=1\nexport B="two\nlines"\n# comment\nC=x # note' });
    expect(res).toEqual({ status: 200, json: { success: true, data: { created: ['A', 'B', 'C'], updated: [] } } });
    expect(stored()).toEqual({ 'A@ALL': '1', 'B@ALL': 'two\nlines', 'C@ALL': 'x' });
    expect([...mockDb.rows.values()].map((r) => r.encryptedValue)).not.toContain('1');
    expect(mockAudit).toEqual(['A', 'B', 'C'].map((targetKey) => expect.objectContaining({ action: 'ENV_CREATED', targetKey })));
    expect(mockAuditWrites.count).toBe(1);
  });

  it('overwrites keys that exist in the same environment and leaves other environments alone', async () => {
    await bulk({ content: 'A=old\nB=old' });
    await bulk({ content: 'A=prod', environment: 'PRODUCTION' });
    mockAudit.length = 0;

    const res = await bulk({ content: 'A=new\nC=3' });
    expect(res.json.data).toEqual({ created: ['C'], updated: ['A'] });
    expect(stored()).toEqual({ 'A@ALL': 'new', 'B@ALL': 'old', 'A@PRODUCTION': 'prod', 'C@ALL': '3' });
    expect(mockAudit.map((a) => [a.action, a.targetKey])).toEqual([['ENV_CREATED', 'C'], ['ENV_UPDATED', 'A']]);
  });

  it.each([
    ['another user', { userId: 'intruder' }],
    ['a project that does not exist', { projectId: 'nope' }],
  ])('refuses %s with 404 and writes nothing', async (_name, who) => {
    const res = await bulk({ content: 'A=1' }, who);
    expect(res.status).toBe(404);
    expect(mockDb.rows.size).toBe(0);
  });

  it.each([
    ['an invalid key', 'A=1\nMY-KEY=x', 'Line 2 (MY-KEY): Key must be a valid environment variable name'],
    ['a line that is not KEY=VALUE', 'A=1\noops', 'Line 2: Not a KEY=VALUE line'],
    ['an unclosed double quote', 'A="x\nB=1', 'Line 1 (A): The double-quoted value is never closed'],
    ['no variables', '# only a comment\n', 'No variables found'],
  ])('rejects the whole file for %s', async (_name, content, message) => {
    const res = await bulk({ content });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toBe(message);
    expect(mockDb.rows.size).toBe(0);
  });

  it('applies the single-variable value limit and never echoes the value', async () => {
    const res = await bulk({ content: `A=1\nBIG=${'s'.repeat(10_001)}` });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/^Line 2 \(BIG\): Value: /);
    expect(JSON.stringify(res.json)).not.toContain('sss');
    expect(mockDb.rows.size).toBe(0);
  });

  it('rejects a bad environment or a missing content field', async () => {
    expect((await bulk({ content: 'A=1', environment: 'MARS' })).status).toBe(400);
    expect((await bulk({})).status).toBe(400);
    expect(mockDb.rows.size).toBe(0);
  });

  it('accepts 200 variables and refuses 201', async () => {
    const file = (n: number): string => Array.from({ length: n }, (_, i) => `K${i}=${i}`).join('\n');
    const over = await bulk({ content: file(201) });
    expect(over.status).toBe(400);
    expect(over.json.error?.message).toBe('At most 200 variables at a time');
    expect(mockDb.rows.size).toBe(0);

    expect((await bulk({ content: file(200) })).status).toBe(200);
    expect(mockDb.rows.size).toBe(200);
  });

  it('refuses a body over the size limit, and a file at the limit, without slowing down', async () => {
    let started = Date.now();
    const tooBig = await bulk({ content: '1=1\n'.repeat(1_000_000) });
    expect(Date.now() - started).toBeLessThan(100);
    expect(tooBig.json.error?.message).toBe('The .env file is too large');

    started = Date.now();
    const full = await bulk({ content: 'A=1\n'.repeat(525_000) });
    expect(Date.now() - started).toBeLessThan(100);
    expect(full.json.error?.message).toBe('At most 200 variables at a time');
    expect(mockDb.rows.size).toBe(0);
  });

  it('charges an import per variable and answers 429 past 600 a minute, writing nothing', async () => {
    const file = Array.from({ length: 200 }, (_, i) => `K${i}=${i}`).join('\n');
    for (let i = 0; i < 3; i++) expect((await bulk({ content: file }, { userId: 'busy' })).status).toBe(200);
    mockAudit.length = 0;

    const res = await bulk({ content: 'NEW=1' }, { userId: 'busy' });
    expect(res.status).toBe(429);
    expect(stored()['NEW@ALL']).toBeUndefined();
    expect(mockAudit).toEqual([]);
    // Each import cost the shared env-var budget 1, so the panel's list refresh is still allowed.
    expect(checkEnvVarRateLimit('busy')).toBeNull();
  });

  it('caps a project at 500 variables, for an import and for a single create', async () => {
    for (let i = 0; i < 450; i++) {
      mockDb.rows.set(rowId({ projectId: 'p1', key: `OLD${i}`, environment: 'PRODUCTION' }), {
        id: `old${i}`, projectId: 'p1', key: `OLD${i}`, environment: 'PRODUCTION', encryptedValue: '', iv: '', authTag: '',
      });
    }
    const file = (n: number): string => Array.from({ length: n }, (_, i) => `NEW${i}=${i}`).join('\n');
    const who = { userId: 'filler' };

    const over = await bulk({ content: file(51) }, who);
    expect(over.status).toBe(400);
    expect(over.json.error?.message).toBe('A project can hold at most 500 variables; it has 450 and this file would add 51');
    expect(mockDb.rows.size).toBe(450);

    // Overwriting an existing key adds nothing, so 50 new keys plus an overwrite fit exactly.
    expect((await bulk({ content: `${file(50)}\nOLD0=x`, environment: 'PRODUCTION' }, who)).status).toBe(200);
    expect(mockDb.rows.size).toBe(500);

    const one = await createOne(
      new NextRequest('http://localhost/api/projects/p1/env-vars', { method: 'POST', body: JSON.stringify({ key: 'ONE_MORE', value: '1' }) }),
      { params: Promise.resolve({ id: 'p1' }) },
    );
    expect(one.status).toBe(400);
    expect((await one.json()).error.message).toBe('A project can hold at most 500 variables');
    expect(mockDb.rows.size).toBe(500);
  });

  it('counts a repeated key once and keeps its last value', async () => {
    const res = await bulk({ content: 'A=1\nA=2' });
    expect(res.json.data).toEqual({ created: ['A'], updated: [] });
    expect(stored()).toEqual({ 'A@ALL': '2' });
  });

  it('is all or nothing: a failure part way writes and logs nothing', async () => {
    await bulk({ content: 'A=old' });
    mockAudit.length = 0;
    mockDb.failOnKey = 'C';

    const res = await bulk({ content: 'A=new\nB=2\nC=3\nD=4' });
    expect(res.status).toBe(500);
    expect(stored()).toEqual({ 'A@ALL': 'old' });
    expect(mockAudit).toEqual([]);
  });
});
