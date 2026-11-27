import { CohortService, INVALID_JOIN_MESSAGE, isJoinOpen } from '@/services/cohort/cohort.service';
import { hashInviteToken } from '@/services/invite/invite.service';
import { ProjectAccessService } from '@/services/project-access/project-access.service';
import { DEFAULT_PLATFORM_SETTINGS } from '@/services/platform-settings/platform-settings.service';
import type { CohortAccount, ICohortRepository, NewStudents } from '@/repositories/cohort.repository';
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
  /** Batches by id, looked up before `cohort`; null means no such batch. */
  cohorts?: Record<string, ReturnType<typeof cohort> | null>;
  moved?: boolean;
  added?: boolean; removed?: boolean; memberships?: unknown[]; accounts?: CohortAccount[]; members?: unknown[];
  /** Emails someone else registers between the lookup and the write. */
  raced?: string[];
  /** Existing users whose membership someone else changes between the lookup and the write. */
  changed?: string[];
} = {}) {
  const repo = {
    create: jest.fn(async (data: Record<string, unknown>) => ({ ...cohort(), ...data })),
    update: jest.fn(async (_id: string, data: Record<string, unknown>) => ({ ...cohort(), ...data })),
    findById: jest.fn(async (id: string) => (opts.cohorts && id in opts.cohorts ? opts.cohorts[id] : opts.cohort === undefined ? cohort() : opts.cohort)),
    findByJoinCode: jest.fn(async () => (opts.cohort === undefined ? cohort() : opts.cohort)),
    slugExists: jest.fn(async () => false),
    findAll: jest.fn(),
    listMembers: jest.fn(async () => opts.members ?? []),
    findMember: jest.fn(async () => opts.member ?? null),
    upsertMember: jest.fn(async () => ({})),
    endMember: jest.fn(async () => undefined),
    isActiveMentor: jest.fn(async () => opts.mentor ?? false),
    listActiveMemberships: jest.fn(async () => opts.memberships ?? []),
    listProjects: jest.fn(async () => []),
    addProject: jest.fn(async () => opts.added ?? true),
    removeProject: jest.fn(async () => opts.removed ?? true),
    moveProject: jest.fn(async () => opts.moved ?? true),
    findAccounts: jest.fn(async () => opts.accounts ?? []),
    addStudents: jest.fn(async (_cohortId: string, s: NewStudents) => {
      const created = s.invites.filter((i) => !opts.raced?.includes(i.email)).map(({ email }) => ({ id: `id-${email}`, email }));
      const unchanged = s.existingUserIds.filter((id) => opts.changed?.includes(id));
      return { created, addedUserIds: [...s.existingUserIds.filter((id) => !unchanged.includes(id)), ...created.map((u) => u.id)] };
    }),
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

describe('moving a project to another batch', () => {
  const target = cohort({ id: 'c2', name: 'FSD Feb 2027' });
  const studentThere = { role: 'STUDENT', endedAt: null };
  const ok = { cohorts: { c2: target }, member: studentThere };

  it('moves it when the owner is a current student there, and records from and to', async () => {
    const { service, repo, adminActions } = setup(ok);
    await expect(service.moveProject('c1', 'p1', 'c2', 'admin')).resolves.toMatchObject({ id: 'c2' });
    expect(repo.findMember).toHaveBeenCalledWith('c2', 's1');
    expect(repo.moveProject).toHaveBeenCalledWith('p1', 'c1', 'c2');
    expect(adminActions.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'COHORT_PROJECT_MOVED', actorId: 'admin', targetId: 'c1',
      meta: { projectId: 'p1', project: 'portfolio', from: 'c1', to: 'c2', toName: 'FSD Feb 2027' },
    }));
  });

  it('works while batches are switched off, like removing', async () => {
    const { service, repo } = setup({ ...ok, enabled: false });
    await service.moveProject('c1', 'p1', 'c2', 'admin');
    expect(repo.moveProject).toHaveBeenCalled();
  });

  it.each([
    ['the target is this batch', ok, 'c1', 'p1', 'already in this batch'],
    ['this batch is unknown', { ...ok, cohorts: { ...ok.cohorts, c1: null } }, 'c2', 'p1', 'Batch not found'],
    ['the target is unknown', { ...ok, cohorts: { c9: null } }, 'c9', 'p1', 'Target batch not found'],
    ['the target is archived', { ...ok, cohorts: { c2: cohort({ id: 'c2', name: 'Old', archivedAt: new Date() }) } }, 'c2', 'p1', 'Old is archived'],
    ['the project is in another batch', ok, 'c2', 'p-other', 'Project not found'],
    ['the owner was never in the target', { ...ok, member: null }, 'c2', 'p1', 'Add the student to that batch first'],
    ["the owner's membership there ended", { ...ok, member: { role: 'STUDENT', endedAt: new Date() } }, 'c2', 'p1', 'Add the student to that batch first'],
    ['the owner is a mentor there, not a student', { ...ok, member: { role: 'MENTOR', endedAt: null } }, 'c2', 'p1', 'Add the student to that batch first'],
  ])('refuses when %s, and changes and records nothing', async (_why, opts, to, projectId, message) => {
    const { service, repo, adminActions } = setup(opts);
    await expect(service.moveProject('c1', projectId, to, 'admin')).rejects.toThrow(message);
    expect(repo.moveProject).not.toHaveBeenCalled();
    expect(adminActions.create).not.toHaveBeenCalled();
  });

  it('uses 409 for refusals an admin can fix and 404 for missing things', async () => {
    const { service } = setup({ ...ok, member: null });
    await expect(service.moveProject('c1', 'p1', 'c2', 'admin')).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.moveProject('c1', 'p1', 'c1', 'admin')).rejects.toMatchObject({ statusCode: 409 });
    await expect(setup({ cohorts: { c9: null } }).service.moveProject('c1', 'p1', 'c9', 'admin')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('records nothing when someone else moved or removed it first', async () => {
    const { service, adminActions } = setup({ ...ok, moved: false });
    await expect(service.moveProject('c1', 'p1', 'c2', 'admin')).rejects.toThrow('Project not found');
    expect(adminActions.create).not.toHaveBeenCalled();
  });

  it("lists as targets only the owner's other active student batches", async () => {
    // listActiveMemberships already drops ended memberships and archived batches.
    const memberships = [
      { cohortId: 'c1', role: 'STUDENT', cohort: cohort() },
      { cohortId: 'c2', role: 'STUDENT', cohort: target },
      { cohortId: 'c3', role: 'MENTOR', cohort: cohort({ id: 'c3' }) },
    ];
    const { service, repo } = setup({ memberships });
    await expect(service.moveTargets('c1', 'p1')).resolves.toEqual([target]);
    expect(repo.listActiveMemberships).toHaveBeenCalledWith('s1');
    await expect(service.moveTargets('c1', 'p-other')).rejects.toThrow('Project not found');
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

describe('the /explore batch filter', () => {
  const mentor = { userId: 'm1', role: 'USER' };
  const memberships = [
    { role: 'MENTOR', cohort: cohort({ id: 'c1', name: 'FSD Jan 2027' }) },
    { role: 'STUDENT', cohort: cohort({ id: 'c2', name: 'Data Feb 2027' }) },
  ];

  it('gives signed-out visitors no batches and drops their filter without a lookup', async () => {
    const { service, repo } = setup({ memberships });
    expect(await service.exploreFilter(null, 'c1')).toEqual({ cohorts: [], cohortId: undefined });
    expect(repo.findAll).not.toHaveBeenCalled();
    expect(repo.listActiveMemberships).not.toHaveBeenCalled();
  });

  it('gives a student no batches, not even their own, and drops their filter', async () => {
    const { service } = setup({ memberships: [memberships[1]] });
    expect(await service.exploreFilter(student, 'c2')).toEqual({ cohorts: [], cohortId: undefined });
  });

  it('gives admins every batch and keeps only a batch that exists', async () => {
    const { service, repo } = setup();
    repo.findAll.mockResolvedValue([cohort(), cohort({ id: 'c3', name: 'Old batch', archivedAt: new Date() })]);
    expect(await service.exploreFilter(admin, 'c3')).toEqual({
      cohorts: [{ id: 'c1', name: 'FSD Jan 2027' }, { id: 'c3', name: 'Old batch' }],
      cohortId: 'c3',
    });
    expect((await service.exploreFilter(admin, 'missing')).cohortId).toBeUndefined();
  });

  it('gives a mentor only the batches they mentor now, never one they study in', async () => {
    const { service } = setup({ memberships });
    expect(await service.exploreFilter(mentor, 'c1')).toEqual({ cohorts: [{ id: 'c1', name: 'FSD Jan 2027' }], cohortId: 'c1' });
    expect((await service.exploreFilter(mentor, 'c2')).cohortId).toBeUndefined();
    expect((await service.exploreFilter(mentor, 'missing')).cohortId).toBeUndefined();
  });

  it('gives mentors nothing while batches are off', async () => {
    const { service } = setup({ enabled: false, memberships });
    expect(await service.exploreFilter(mentor, 'c1')).toEqual({ cohorts: [], cohortId: undefined });
  });
});

describe('what mentors can read', () => {
  it('shows the batch to its mentors and to admins, and a 404 to anyone else', async () => {
    await expect(setup({ mentor: true }).service.listProjects('c1', { userId: 'm1', role: 'USER' })).resolves.toEqual([]);
    await expect(setup().service.listProjects('c1', admin)).resolves.toEqual([]);
    await expect(setup().service.listProjects('c1', student)).rejects.toThrow('Batch not found');
  });

  it("gives mentors why a student's deployment failed, and a 404 to anyone else", async () => {
    const failed = { id: 'p1', deployments: [{ id: 'd1', status: 'FAILED', buildStep: 'BUILDING_IMAGE', failureReason: 'npm error Missing script: "build"' }] };
    const mentor = setup({ mentor: true });
    mentor.repo.listProjects.mockResolvedValueOnce([failed] as never);
    expect((await mentor.service.listProjects('c1', { userId: 'm1', role: 'USER' }))[0].deployments[0])
      .toMatchObject({ buildStep: 'BUILDING_IMAGE', failureReason: 'npm error Missing script: "build"' });
    const other = setup();
    other.repo.listProjects.mockResolvedValueOnce([failed] as never);
    await expect(other.service.listProjects('c1', student)).rejects.toThrow('Batch not found');
    expect(other.repo.listProjects).not.toHaveBeenCalled();
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

describe('adding students by email', () => {
  const account = (email: string, over: Partial<CohortAccount> = {}): CohortAccount =>
    ({ id: `id-${email}`, email, suspendedAt: null, membership: null, ...over });
  const accounts = [
    account('old@entri.me'),
    account('left@entri.me', { membership: { role: 'STUDENT', endedAt: new Date() } }),
    account('here@entri.me', { membership: { role: 'STUDENT', endedAt: null } }),
    account('mentor@entri.me', { membership: { role: 'MENTOR', endedAt: null } }),
    account('banned@entri.me', { suspendedAt: new Date() }),
  ];
  const mentor = { userId: 'm1', role: 'USER' };

  it('lets an admin invite new emails, add existing accounts and bring back ended memberships', async () => {
    const { service, repo } = setup({ accounts });
    const result = await service.addStudents('c1', [
      ' New@Entri.me ', 'new@entri.me', 'old@entri.me', 'left@entri.me', 'here@entri.me', 'mentor@entri.me',
      'banned@entri.me', 'not-an-email', '',
    ], admin);

    expect(repo.findAccounts).toHaveBeenCalledWith('c1', expect.arrayContaining(['new@entri.me', 'old@entri.me']));
    const [, written] = repo.addStudents.mock.calls[0];
    expect(written.existingUserIds).toEqual(['id-old@entri.me', 'id-left@entri.me']);
    expect(written.invites.map((i) => i.email)).toEqual(['new@entri.me']);
    expect(written.invites[0].tokenHash).toBe(hashInviteToken(result.invited[0].inviteToken));
    expect(written.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(result).toEqual({
      invited: [{ email: 'new@entri.me', inviteToken: expect.any(String) }],
      added: ['old@entri.me', 'left@entri.me'],
      skipped: [
        { email: 'not-an-email', reason: 'not an email address' },
        { email: 'here@entri.me', reason: 'already in this batch' },
        { email: 'mentor@entri.me', reason: 'a mentor in this batch' },
        { email: 'banned@entri.me', reason: 'suspended' },
      ],
    });
  });

  it('lets a mentor invite new emails, but never add an existing account', async () => {
    const { service, repo } = setup({ mentor: true, accounts });
    const result = await service.addStudents('c1', ['new@entri.me', 'old@entri.me', 'banned@entri.me', 'here@entri.me'], mentor);
    expect(repo.addStudents.mock.calls[0][1].existingUserIds).toEqual([]);
    expect(result.invited.map((i) => i.email)).toEqual(['new@entri.me']);
    expect(result.skipped).toEqual([
      // Suspended accounts read the same, so mentors learn nothing more.
      { email: 'old@entri.me', reason: 'already has an account: send them the join link' },
      { email: 'banned@entri.me', reason: 'already has an account: send them the join link' },
      { email: 'here@entri.me', reason: 'already in this batch' },
    ]);
  });

  it('tells a mentor to ask an admin when the join link does not work', async () => {
    const { service } = setup({ mentor: true, accounts, cohort: cohort({ joinOpen: false }) });
    const { skipped } = await service.addStudents('c1', ['old@entri.me'], mentor);
    expect(skipped).toEqual([{ email: 'old@entri.me', reason: 'already has an account: ask an admin to add them' }]);
  });

  it.each<[string, Parameters<typeof setup>[0] & {}, { userId: string; role: string }]>([
    ['a mentor of another batch', { mentor: false }, mentor],
    ['a plain user', {}, student],
    ['a mentor while batches are off', { mentor: true, enabled: false }, mentor],
  ])('answers %s with Batch not found and writes nothing', async (_who, opts, viewer) => {
    const { service, repo } = setup(opts);
    await expect(service.addStudents('c1', ['new@entri.me'], viewer)).rejects.toThrow('Batch not found');
    expect(repo.addStudents).not.toHaveBeenCalled();
  });

  it('refuses an archived batch and writes nothing', async () => {
    const { service, repo, adminActions } = setup({ cohort: cohort({ archivedAt: new Date() }) });
    await expect(service.addStudents('c1', ['new@entri.me'], admin)).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.addStudents).not.toHaveBeenCalled();
    expect(adminActions.create).not.toHaveBeenCalled();
  });

  it('reports an email registered by someone else meanwhile as skipped', async () => {
    const { service } = setup({ raced: ['b@entri.me'] });
    const result = await service.addStudents('c1', ['a@entri.me', 'b@entri.me'], admin);
    expect(result.invited.map((i) => i.email)).toEqual(['a@entri.me']);
    expect(result.skipped).toEqual([{ email: 'b@entri.me', reason: 'was just registered, add again' }]);
  });

  it('gives a mentor the account reason for a race, since adding again can never work for them', async () => {
    const { service } = setup({ mentor: true, raced: ['b@entri.me'] });
    const { skipped } = await service.addStudents('c1', ['b@entri.me'], mentor);
    expect(skipped).toEqual([{ email: 'b@entri.me', reason: 'already has an account: send them the join link' }]);
  });

  it('lists as added only the accounts the write actually changed', async () => {
    const { service, adminActions } = setup({ accounts, changed: ['id-old@entri.me'] });
    const result = await service.addStudents('c1', ['old@entri.me', 'left@entri.me'], admin);
    expect(result.added).toEqual(['left@entri.me']);
    expect(result.skipped).toEqual([{ email: 'old@entri.me', reason: 'changed meanwhile: reload and check the batch' }]);
    expect(adminActions.create).toHaveBeenCalledWith(expect.objectContaining({ meta: { invited: [], added: ['left@entri.me'], skipped: 1 } }));
  });

  it('hashes a password only when someone is invited, because bcrypt is slow', async () => {
    const { service, repo } = setup({ accounts });
    await service.addStudents('c1', ['old@entri.me'], admin);
    expect(repo.addStudents.mock.calls[0][1].passwordHash).toBe('');
  });

  it('records the emails with the adder as actor, never an invite token', async () => {
    const { service, adminActions } = setup({ mentor: true });
    const { invited } = await service.addStudents('c1', ['a@entri.me'], mentor);
    const entry = (adminActions.create.mock.calls[0] as unknown[])[0];
    expect(entry).toMatchObject({
      actorId: 'm1', action: 'COHORT_STUDENTS_ADDED', targetId: 'c1', meta: { invited: ['a@entri.me'], added: [], skipped: 0 },
    });
    expect(JSON.stringify(entry)).not.toContain(invited[0].inviteToken);
  });

  it('writes nothing when every email is skipped', async () => {
    const { service, repo, adminActions } = setup({ accounts });
    expect(await service.addStudents('c1', ['here@entri.me', 'nope'], admin)).toMatchObject({ invited: [], added: [] });
    expect(repo.addStudents).not.toHaveBeenCalled();
    expect(adminActions.create).not.toHaveBeenCalled();
  });
});

describe("a mentor's batch page", () => {
  const member = (userId: string, over: Record<string, unknown> = {}) => ({
    userId, role: 'STUDENT', joinedAt: new Date('2027-01-05'), endedAt: null, projectCount: 2,
    user: { id: userId, email: `${userId}@entri.me`, name: null, mustResetPassword: false }, ...over,
  });
  const members = [
    member('s1'),
    member('s2', { user: { id: 's2', email: 's2@entri.me', name: 'Asha', mustResetPassword: true } }),
    member('gone', { endedAt: new Date() }),
    member('m1', { role: 'MENTOR' }),
  ];

  it('lists only current students, with whether each has set a password, and the join link while it works', async () => {
    const view = await setup({ mentor: true, members }).service.mentorView('c1', { userId: 'm1', role: 'USER' });
    expect(view.joinLink).toBe(`/join/${'x'.repeat(24)}`);
    expect(view.cohort).toEqual({
      id: 'c1', name: 'FSD Jan 2027', program: 'Full Stack', startsAt: expect.any(Date), endsAt: expect.any(Date), archivedAt: null,
    });
    expect(view.students).toEqual([
      { userId: 's1', email: 's1@entri.me', name: null, joinedAt: new Date('2027-01-05'), passwordSet: true, projectCount: 2 },
      { userId: 's2', email: 's2@entri.me', name: 'Asha', joinedAt: new Date('2027-01-05'), passwordSet: false, projectCount: 2 },
    ]);
  });

  it('hides the join link once joining is closed, and refuses anyone but mentors and admins', async () => {
    const closed = await setup({ cohort: cohort({ joinOpen: false }) }).service.mentorView('c1', admin);
    expect(closed.joinLink).toBeNull();
    const archivedAt = new Date();
    const archived = await setup({ cohort: cohort({ archivedAt }) }).service.mentorView('c1', admin);
    expect(archived).toMatchObject({ cohort: { archivedAt }, joinLink: null });
    await expect(setup().service.mentorView('c1', student)).rejects.toThrow('Batch not found');
  });

  it('shows admins whether each member has set a password', async () => {
    const { members: rows } = await setup({ members }).service.get('c1');
    expect(rows.map((m) => m.passwordSet)).toEqual([true, false, true, true]);
  });
});

describe('isJoinOpen', () => {
  it('is true only while joining is open, the batch is not archived and it has not ended', () => {
    expect(isJoinOpen(cohort())).toBe(true);
    expect(isJoinOpen(cohort({ joinOpen: false }))).toBe(false);
    expect(isJoinOpen(cohort({ archivedAt: new Date() }))).toBe(false);
    expect(isJoinOpen(cohort({ endsAt: new Date(Date.now() - DAY) }))).toBe(false);
  });
});
