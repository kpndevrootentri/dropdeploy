import { CohortService, INVALID_JOIN_MESSAGE } from '@/services/cohort/cohort.service';
import { ProjectAccessService } from '@/services/project-access/project-access.service';
import { DEFAULT_PLATFORM_SETTINGS } from '@/services/platform-settings/platform-settings.service';
import type { ICohortRepository } from '@/repositories/cohort.repository';
import type { IProjectAccessRepository } from '@/repositories/project-access.repository';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';

const DAY = 24 * 60 * 60 * 1000;

const cohort = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'FSD Jan 2027',
  slug: 'fsd-jan-2027',
  program: 'Full Stack',
  startsAt: new Date(Date.now() - DAY),
  endsAt: new Date(Date.now() + 30 * DAY),
  joinCode: 'x'.repeat(24),
  joinOpen: true,
  archivedAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

// Every row keeps id and email: error messages interpolate the email.
const MENTOR_ACCOUNTS: Record<string, { id: string; email: string; mustResetPassword: boolean; suspendedAt: Date | null }> = {
  'mentor@entri.me': { id: 'm1', email: 'mentor@entri.me', mustResetPassword: false, suspendedAt: null },
  'invited@entri.me': { id: 'm2', email: 'invited@entri.me', mustResetPassword: true, suspendedAt: null },
  'suspended@entri.me': { id: 'm3', email: 'suspended@entri.me', mustResetPassword: false, suspendedAt: new Date() },
};

function setup(opts: {
  enabled?: boolean; cohort?: ReturnType<typeof cohort> | null; member?: unknown; mentor?: boolean;
  added?: boolean; removed?: boolean; memberships?: unknown[];
} = {}) {
  const repo = {
    create: jest.fn(async (data: Record<string, unknown>) => ({ ...cohort(), ...data })),
    update: jest.fn(async (_id: string, data: Record<string, unknown>) => ({ ...cohort(), ...data })),
    findById: jest.fn(async () => (opts.cohort === undefined ? cohort() : opts.cohort)),
    findByJoinCode: jest.fn(async () => (opts.cohort === undefined ? cohort() : opts.cohort)),
    slugExists: jest.fn(async () => false),
    findAll: jest.fn(),
    listMembers: jest.fn(async () => []),
    findMember: jest.fn(async () => opts.member ?? null),
    upsertMember: jest.fn(async () => ({})),
    endMember: jest.fn(async () => undefined),
    isActiveMentor: jest.fn(async () => opts.mentor ?? false),
    listActiveMemberships: jest.fn(async () => opts.memberships ?? []),
    listProjects: jest.fn(async () => []),
    addProject: jest.fn(async () => opts.added ?? true),
    removeProject: jest.fn(async () => opts.removed ?? true),
  };
  const users = {
    findById: jest.fn(async (id: string) => ({ id, email: `${id}@entri.me` })),
    findByEmail: jest.fn(async (email: string) => MENTOR_ACCOUNTS[email] ?? null),
  };
  const projects = { findById: jest.fn(async (id: string) => ({ id, userId: 's1', name: 'portfolio', cohortId: id === 'p-other' ? 'c2' : 'c1' })) };
  const deployments = {
    findById: jest.fn(async (id: string) => ({
      id, projectId: id === 'd-other' ? 'p-other' : 'p1', status: 'FAILED', buildLog: 'boom',
      createdAt: new Date(), completedAt: new Date(), commitHash: 'abc', imageTag: 'secret-tag',
    })),
    findByProjectId: jest.fn(async () => []),
  };
  const adminActions = { create: jest.fn(async () => ({})) };
  const settings = { get: async () => ({ ...DEFAULT_PLATFORM_SETTINGS, cohortsEnabled: opts.enabled ?? true }) };
  const service = new CohortService(
    repo as unknown as ICohortRepository,
    users as unknown as IUserRepository,
    projects as unknown as IProjectRepository,
    deployments as never,
    adminActions as never,
    settings,
  );
  return { service, repo, adminActions, deployments };
}

const student = { userId: 's1', role: 'USER' };
const admin = { userId: 'admin', role: 'CONTRIBUTOR' };

describe('joining a batch', () => {
  it('adds a new student', async () => {
    const { service, repo } = setup();
    await service.join('code', 's1');
    expect(repo.upsertMember).toHaveBeenCalledWith('c1', 's1', 'STUDENT');
  });

  it.each([
    ['batches are switched off', { enabled: false }],
    ['the code is unknown', { cohort: null }],
    ['joining is closed', { cohort: cohort({ joinOpen: false }) }],
    ['the batch is archived', { cohort: cohort({ archivedAt: new Date() }) }],
    ['the batch has ended', { cohort: cohort({ endsAt: new Date(Date.now() - DAY) }) }],
  ])('refuses with one generic message when %s', async (_why, opts) => {
    const { service, repo } = setup(opts);
    await expect(service.join('code', 's1')).rejects.toThrow(INVALID_JOIN_MESSAGE);
    await expect(service.assertJoinable('code')).rejects.toThrow(INVALID_JOIN_MESSAGE);
    expect(repo.upsertMember).not.toHaveBeenCalled();
  });

  it('lets a student join again without changing anything', async () => {
    const { service, repo } = setup({ member: { role: 'STUDENT', endedAt: null } });
    await service.join('code', 's1');
    expect(repo.upsertMember).not.toHaveBeenCalled();
  });

  it('brings back a membership that had ended', async () => {
    const { service, repo } = setup({ member: { role: 'STUDENT', endedAt: new Date() } });
    await service.join('code', 's1');
    expect(repo.upsertMember).toHaveBeenCalledWith('c1', 's1', 'STUDENT');
  });

  it('does not turn a mentor into a student', async () => {
    const { service, repo } = setup({ member: { role: 'MENTOR', endedAt: null } });
    await expect(service.join('code', 'm1')).rejects.toThrow('mentor');
    expect(repo.upsertMember).not.toHaveBeenCalled();
  });
});

describe('managing batches', () => {
  it('creates a batch with a long random join code and a slug from its name', async () => {
    const { service, repo, adminActions } = setup();
    await service.create({ name: 'FSD Jan 2027', program: 'Full Stack', startsAt: new Date(), endsAt: new Date(Date.now() + DAY) }, 'admin');
    const data = repo.create.mock.calls[0][0];
    expect(data.joinCode).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(data.slug).toBe('fsd-jan-2027');
    expect(adminActions.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'COHORT_CREATED', targetType: 'COHORT' }));
  });

  it('gives a second batch with the same name a different slug', async () => {
    const { service, repo } = setup();
    repo.slugExists.mockResolvedValueOnce(true).mockResolvedValue(false);
    await service.create({ name: 'FSD Jan 2027', program: 'Full Stack', startsAt: new Date(), endsAt: new Date(Date.now() + DAY) }, 'admin');
    expect(repo.create.mock.calls[0][0].slug).toMatch(/^fsd-jan-2027-[0-9a-f]{6}$/);
  });

  it('archives once and un-archives on request', async () => {
    const archivedAt = new Date('2027-07-01');
    const { service, repo } = setup({ cohort: cohort({ archivedAt }) });
    await service.update('c1', { archived: true }, 'admin');
    expect(repo.update).toHaveBeenLastCalledWith('c1', { archivedAt });
    await service.update('c1', { archived: false }, 'admin');
    expect(repo.update).toHaveBeenLastCalledWith('c1', { archivedAt: null });
  });

  it('refuses an end date before the start date', async () => {
    const { service } = setup();
    await expect(service.update('c1', { endsAt: new Date(Date.now() - 2 * DAY) }, 'admin')).rejects.toThrow('end date');
  });

  it('adds a mentor by email, but never promotes a current student', async () => {
    const ok = setup();
    await ok.service.addMentor('c1', 'mentor@entri.me', 'admin');
    expect(ok.repo.upsertMember).toHaveBeenCalledWith('c1', 'm1', 'MENTOR');

    const studentNow = setup({ member: { role: 'STUDENT', endedAt: null } });
    await expect(studentNow.service.addMentor('c1', 'mentor@entri.me', 'admin')).rejects.toThrow('student in this batch');

    await expect(setup().service.addMentor('c1', 'nobody@entri.me', 'admin')).rejects.toThrow('User not found');
  });

  it.each([
    ['an invited account that never chose a password', 'invited@entri.me', 'invited@entri.me has not set their own password yet'],
    ['a suspended account', 'suspended@entri.me', 'suspended@entri.me is suspended'],
  ])('refuses %s as a mentor', async (_case, email, message) => {
    const { service, repo, adminActions } = setup();
    await expect(service.addMentor('c1', email, 'admin')).rejects.toThrow(message);
    expect(repo.upsertMember).not.toHaveBeenCalled();
    expect(adminActions.create).not.toHaveBeenCalled();
  });

  it('ends a membership instead of deleting it', async () => {
    const { service, repo } = setup({ member: { role: 'STUDENT', endedAt: null } });
    await service.endMembership('c1', 's1', 'admin');
    expect(repo.endMember).toHaveBeenCalledWith('c1', 's1', expect.any(Date));
    await expect(setup().service.endMembership('c1', 's1', 'admin')).rejects.toThrow('Membership not found');
  });
});

describe('a batch page', () => {
  it("returns the batch's projects", async () => {
    const { service, repo } = setup();
    repo.listProjects.mockResolvedValueOnce([{ id: 'p1' }] as never);
    expect((await service.get('c1')).projects).toEqual([{ id: 'p1' }]);
    expect(repo.listProjects).toHaveBeenCalledWith('c1');
  });
});

describe('adding a project to a batch', () => {
  const asStudent = [{ role: 'STUDENT', cohort: cohort() }];

  it('adds your own project to your batch and records it with you as the actor', async () => {
    const { service, repo, adminActions } = setup({ memberships: asStudent });
    await service.addProject('p1', 's1', 'c1');
    expect(repo.addProject).toHaveBeenCalledWith('p1', 's1', 'c1');
    expect(adminActions.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'COHORT_PROJECT_ADDED', actorId: 's1', actorEmail: 's1@entri.me', targetId: 'c1',
      meta: { projectId: 'p1', project: 'portfolio' },
    }));
  });

  it("refuses someone else's project", async () => {
    const { service, repo, adminActions } = setup({ memberships: asStudent });
    await expect(service.addProject('p1', 's2', 'c1')).rejects.toThrow('Project not found');
    expect(repo.addProject).not.toHaveBeenCalled();
    expect(adminActions.create).not.toHaveBeenCalled();
  });

  it.each<[string, Parameters<typeof setup>[0] & {}]>([
    ['no batch', { memberships: [] }],
    ['only a mentor', { memberships: [{ role: 'MENTOR', cohort: cohort() }] }],
    ['batches switched off', { enabled: false, memberships: asStudent }],
  ])('refuses when the owner has %s', async (_case, opts) => {
    const { service, repo, adminActions } = setup(opts);
    await expect(service.addProject('p1', 's1', 'c1')).rejects.toThrow('not a student in an active batch');
    expect(repo.addProject).not.toHaveBeenCalled();
    expect(adminActions.create).not.toHaveBeenCalled();
    if (opts.enabled === false) expect(repo.listActiveMemberships).not.toHaveBeenCalled();
  });

  const twoBatches = [{ role: 'STUDENT', cohort: cohort({ id: 'c2', name: 'Newer' }) }, { role: 'STUDENT', cohort: cohort() }];

  it('uses the batch joined most recently, as new projects do', async () => {
    const { service, repo } = setup({ memberships: twoBatches });
    expect((await service.addProject('p1', 's1', 'c2')).id).toBe('c2');
    expect(repo.addProject).toHaveBeenCalledWith('p1', 's1', 'c2');
  });

  it('refuses when the batch changed after the page loaded', async () => {
    const { service, repo, adminActions } = setup({ memberships: twoBatches });
    await expect(service.addProject('p1', 's1', 'c1')).rejects.toThrow('Your batch changed');
    expect(repo.addProject).not.toHaveBeenCalled();
    expect(adminActions.create).not.toHaveBeenCalled();
  });

  it('refuses a project that is already in a batch', async () => {
    const { service, adminActions } = setup({ memberships: asStudent, added: false });
    await expect(service.addProject('p1', 's1', 'c1')).rejects.toThrow('already in a batch');
    expect(adminActions.create).not.toHaveBeenCalled();
  });
});

describe('removing a project from a batch', () => {
  it('lets an admin remove it, and records it', async () => {
    const { service, repo, adminActions } = setup();
    await service.removeProject('c1', 'p1', 'admin');
    expect(repo.removeProject).toHaveBeenCalledWith('c1', 'p1');
    expect(adminActions.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'COHORT_PROJECT_REMOVED', actorId: 'admin', meta: { projectId: 'p1', project: 'portfolio' },
    }));
  });

  it('refuses a project outside the batch, or an unknown batch, and records nothing', async () => {
    const outside = setup({ removed: false });
    await expect(outside.service.removeProject('c1', 'p1', 'admin')).rejects.toThrow('Project not found');
    expect(outside.adminActions.create).not.toHaveBeenCalled();

    const unknown = setup({ cohort: null });
    await expect(unknown.service.removeProject('c9', 'p1', 'admin')).rejects.toThrow('Batch not found');
    expect(unknown.repo.removeProject).not.toHaveBeenCalled();
    expect(unknown.adminActions.create).not.toHaveBeenCalled();
  });
});

describe('the switch', () => {
  it('stops stamping new projects and stops mentor access when off, without touching the database', async () => {
    const { service, repo } = setup({ enabled: false, mentor: true });
    expect(await service.cohortForNewProject('s1')).toBeNull();
    expect(await service.canMentorView('c1', 'm1')).toBe(false);
    expect(await service.myMemberships('s1')).toEqual([]);
    expect(repo.listActiveMemberships).not.toHaveBeenCalled();
    expect(repo.isActiveMentor).not.toHaveBeenCalled();
  });

  it('stamps the newest active student batch when on, skipping batches they mentor', async () => {
    const memberships = [{ role: 'MENTOR', cohort: cohort({ id: 'c9' }) }, { role: 'STUDENT', cohort: cohort() }];
    expect(await setup({ memberships }).service.cohortForNewProject('s1')).toBe('c1');
    expect(await setup({ memberships: [memberships[0]] }).service.cohortForNewProject('s1')).toBeNull();
  });
});

describe('what mentors can read', () => {
  it('shows the batch to its mentors and to admins, and a 404 to anyone else', async () => {
    await expect(setup({ mentor: true }).service.listProjects('c1', { userId: 'm1', role: 'USER' })).resolves.toEqual([]);
    await expect(setup().service.listProjects('c1', admin)).resolves.toEqual([]);
    await expect(setup().service.listProjects('c1', student)).rejects.toThrow('Batch not found');
  });

  it("refuses a project or deployment from outside the batch", async () => {
    const { service } = setup({ mentor: true });
    const mentor = { userId: 'm1', role: 'USER' };
    await expect(service.listDeployments('c1', 'p-other', mentor)).rejects.toThrow('Project not found');
    await expect(service.getBuildLog('c1', 'p1', 'd-other', mentor)).rejects.toThrow('Deployment not found');
  });

  it('returns only the build log fields, nothing else from the deployment', async () => {
    const log = await setup({ mentor: true }).service.getBuildLog('c1', 'p1', 'd1', { userId: 'm1', role: 'USER' });
    expect(Object.keys(log).sort()).toEqual(['buildLog', 'completedAt', 'createdAt', 'id', 'status']);
  });
});

describe('private sites and mentors', () => {
  const make = (mentor: boolean, listed = false) => {
    const canMentorView = jest.fn(async () => mentor);
    const access = new ProjectAccessService(
      { isAuthorized: jest.fn(async () => listed) } as unknown as IProjectAccessRepository,
      {} as IUserRepository,
      {} as IProjectRepository,
      { canMentorView },
    );
    return { access, canMentorView };
  };
  const viewer = { userId: 'm1', email: 'mentor@entri.me', role: 'USER' };

  it("lets an active mentor of the project's batch view it", async () => {
    expect(await make(true).access.canView({ id: 'p1', userId: 's1', cohortId: 'c1' }, viewer)).toBe(true);
  });

  it('denies a project with no batch, or a non-mentor', async () => {
    const noBatch = make(true);
    expect(await noBatch.access.canView({ id: 'p1', userId: 's1', cohortId: null }, viewer)).toBe(false);
    expect(noBatch.canMentorView).not.toHaveBeenCalled();
    expect(await make(false).access.canView({ id: 'p1', userId: 's1', cohortId: 'c1' }, viewer)).toBe(false);
  });

  it('does not look up batches for the owner or someone on the access list', async () => {
    const owner = make(true);
    expect(await owner.access.canView({ id: 'p1', userId: 'm1', cohortId: 'c1' }, viewer)).toBe(true);
    const listed = make(false, true);
    expect(await listed.access.canView({ id: 'p1', userId: 's1', cohortId: 'c1' }, viewer)).toBe(true);
    expect(owner.canMentorView).not.toHaveBeenCalled();
    expect(listed.canMentorView).not.toHaveBeenCalled();
  });
});
