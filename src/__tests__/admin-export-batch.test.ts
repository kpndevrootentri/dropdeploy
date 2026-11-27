// The admin CSV exports: the batch column (appended, so old spreadsheets keep their columns),
// the ?cohortId= filter, and the queries behind them.
const mockSession = { userId: 'admin', email: 'admin@entri.me', role: 'CONTRIBUTOR', mustResetPassword: false };
jest.mock('@/lib/get-session', () => ({ getSession: async () => mockSession }));
const mockListAllProjects = jest.fn<Promise<unknown[]>, [{ cohortId?: string }?]>(async () => [
  { name: 'Portfolio', slug: 'portfolio', user: { email: 's1@entri.me' }, type: 'STATIC', source: 'UPLOAD', createdAt: new Date('2027-01-02T00:00:00.000Z'), deployments: [], cohort: { name: 'FSD Jan 2027' } },
  { name: 'Side', slug: 'side', user: { email: 's2@entri.me' }, type: 'NODEJS', source: 'GITHUB', createdAt: new Date('2027-01-03T00:00:00.000Z'), deployments: [], cohort: null },
]);
const mockListAllUsers = jest.fn<Promise<unknown[]>, [{ cohortId?: string }?]>(async () => [
  {
    email: 's1@entri.me', role: 'USER', projectQuota: 5, domainQuota: 1, mustResetPassword: false, createdAt: new Date('2027-01-01T00:00:00.000Z'),
    _count: { projects: 1, customDomains: 0 },
    cohortMemberships: [{ role: 'STUDENT', cohort: { name: 'FSD Jan 2027' } }, { role: 'MENTOR', cohort: { name: 'Data, Feb 2027' } }],
  },
  {
    email: 'solo@entri.me', role: 'USER', projectQuota: 5, domainQuota: 1, mustResetPassword: false, createdAt: new Date('2027-01-01T00:00:00.000Z'),
    _count: { projects: 0, customDomains: 0 },
    cohortMemberships: [],
  },
]);
jest.mock('@/services/admin', () => ({ adminService: { listAllProjects: mockListAllProjects, listAllUsers: mockListAllUsers } }));
const mockPrisma = {
  project: { findMany: jest.fn<Promise<never[]>, [unknown]>(async () => []) },
  user: { findMany: jest.fn<Promise<never[]>, [unknown]>(async () => []) },
  customDomain: { findMany: async () => [] },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));
// The real one reads the env when it loads; nothing here signs or checks a session.
jest.mock('@/services/auth/auth.service', () => ({ SALT_ROUNDS: 4, authService: {} }));

import { NextRequest } from 'next/server';
import { GET as exportProjects } from '@/app/api/admin/projects/export/route';
import { GET as exportUsers } from '@/app/api/admin/users/export/route';
import { ProjectRepository } from '@/repositories/project.repository';
import { AdminService } from '@/services/admin/admin.service';

const get = (handler: (req: NextRequest) => Promise<Response>, path: string) => handler(new NextRequest(`http://localhost${path}`));
const lines = async (res: Response) => (await res.text()).trimEnd().split('\r\n');

beforeEach(() => {
  mockSession.role = 'CONTRIBUTOR';
  jest.clearAllMocks();
});

describe('GET /api/admin/projects/export', () => {
  it("appends a batch column with the project's batch, empty when it has none", async () => {
    const [header, inBatch, noBatch] = await lines(await get(exportProjects, '/api/admin/projects/export'));
    expect(header).toBe('name,slug,owner,type,source,last_deploy_status,last_deploy_at,url,created_at,batch');
    expect(inBatch).toBe('Portfolio,portfolio,s1@entri.me,STATIC,UPLOAD,,,,2027-01-02T00:00:00.000Z,FSD Jan 2027');
    expect(noBatch.endsWith(',2027-01-03T00:00:00.000Z,')).toBe(true);
    expect(mockListAllProjects).toHaveBeenCalledWith({ cohortId: undefined });
  });

  it('passes ?cohortId= on as the filter', async () => {
    await get(exportProjects, '/api/admin/projects/export?cohortId=c1');
    expect(mockListAllProjects).toHaveBeenCalledWith({ cohortId: 'c1' });
  });

  it('refuses anyone but an admin', async () => {
    mockSession.role = 'USER';
    expect((await get(exportProjects, '/api/admin/projects/export?cohortId=c1')).status).toBe(403);
    expect(mockListAllProjects).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/users/export', () => {
  it('appends a batch column with their current batches, mentors marked', async () => {
    const [header, member, solo] = await lines(await get(exportUsers, '/api/admin/users/export'));
    expect(header).toBe('email,role,project_quota,projects,domain_quota,custom_domains,must_reset_password,created_at,batch');
    expect(member).toBe('s1@entri.me,USER,5,1,1,0,false,2027-01-01T00:00:00.000Z,"FSD Jan 2027; Data, Feb 2027 (mentor)"');
    expect(solo).toBe('solo@entri.me,USER,5,0,1,0,false,2027-01-01T00:00:00.000Z,');
  });

  it('passes ?cohortId= on as the filter, and refuses anyone but an admin', async () => {
    await get(exportUsers, '/api/admin/users/export?cohortId=c1');
    expect(mockListAllUsers).toHaveBeenCalledWith({ cohortId: 'c1' });
    mockSession.role = 'USER';
    mockListAllUsers.mockClear();
    expect((await get(exportUsers, '/api/admin/users/export')).status).toBe(403);
    expect(mockListAllUsers).not.toHaveBeenCalled();
  });
});

describe('the export queries', () => {
  it('reads every project, or one batch, with its batch name in the same query', async () => {
    const repo = new ProjectRepository();
    await repo.findAll();
    await repo.findAll({ cohortId: 'c1' });
    const [all, one] = mockPrisma.project.findMany.mock.calls.map(([args]) => args as { where?: unknown; include: { cohort: unknown } });
    expect(all.where).toBeUndefined();
    expect(one.where).toEqual({ cohortId: 'c1' });
    expect(one.include.cohort).toEqual({ select: { name: true } });
  });

  it("reads every user, or a batch's current members, with their current batches in the same query", async () => {
    const service = new AdminService({} as never, {} as never, {} as never, {} as never, {} as never);
    await service.listAllUsers();
    await service.listAllUsers({ cohortId: 'c1' });
    const [all, one] = mockPrisma.user.findMany.mock.calls.map(([args]) => args as { where?: unknown; select: { cohortMemberships: { where: unknown } } });
    expect(all.where).toBeUndefined();
    expect(one.where).toEqual({ cohortMemberships: { some: { cohortId: 'c1', endedAt: null } } });
    expect(one.select.cohortMemberships.where).toEqual({ endedAt: null });
  });
});
