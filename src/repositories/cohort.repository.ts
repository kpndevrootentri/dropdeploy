import type { Cohort, CohortMember, CohortRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type CohortWithCounts = Cohort & { _count: { members: number; projects: number } };

export type CohortMemberRow = CohortMember & {
  user: { id: string; email: string; name: string | null };
  /** This person's projects in this batch, made in it or added later. */
  projectCount: number;
};

export type MembershipWithCohort = CohortMember & { cohort: Cohort };

export interface CohortProjectRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  isPrivate: boolean;
  user: { id: string; email: string; name: string | null };
  deployments: Array<{ id: string; status: string; subdomain: string | null; containerPort: number | null; createdAt: Date }>;
}

export interface ICohortRepository {
  create(data: Prisma.CohortCreateInput): Promise<Cohort>;
  update(id: string, data: Prisma.CohortUpdateInput): Promise<Cohort>;
  findById(id: string): Promise<Cohort | null>;
  findByJoinCode(joinCode: string): Promise<Cohort | null>;
  slugExists(slug: string): Promise<boolean>;
  /** Newest first, with member and project counts. */
  findAll(): Promise<CohortWithCounts[]>;
  /** Everyone who was ever in the batch, current members first. */
  listMembers(cohortId: string): Promise<CohortMemberRow[]>;
  findMember(cohortId: string, userId: string): Promise<CohortMember | null>;
  /** Adds the person, or brings back a membership that had ended, with the given role. */
  upsertMember(cohortId: string, userId: string, role: CohortRole): Promise<CohortMember>;
  endMember(cohortId: string, userId: string, at: Date): Promise<void>;
  isActiveMentor(cohortId: string, userId: string): Promise<boolean>;
  /** The user's memberships that have not ended, in batches that are not archived. */
  listActiveMemberships(userId: string): Promise<MembershipWithCohort[]>;
  /** The batch's projects with their owner and latest deployment. */
  listProjects(cohortId: string): Promise<CohortProjectRow[]>;
  /** Puts the user's own project in the batch, only if it is in no batch. False if nothing changed. */
  addProject(projectId: string, userId: string, cohortId: string): Promise<boolean>;
  /** Takes the project out of this batch. False if it was not in it. */
  removeProject(cohortId: string, projectId: string): Promise<boolean>;
}

/** Membership that still counts: not ended, and the batch is not archived. */
const ACTIVE = { endedAt: null, cohort: { archivedAt: null } } satisfies Prisma.CohortMemberWhereInput;

export class CohortRepository implements ICohortRepository {
  async create(data: Prisma.CohortCreateInput): Promise<Cohort> {
    return prisma.cohort.create({ data });
  }

  async update(id: string, data: Prisma.CohortUpdateInput): Promise<Cohort> {
    return prisma.cohort.update({ where: { id }, data });
  }

  async findById(id: string): Promise<Cohort | null> {
    return prisma.cohort.findUnique({ where: { id } });
  }

  async findByJoinCode(joinCode: string): Promise<Cohort | null> {
    return prisma.cohort.findUnique({ where: { joinCode } });
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await prisma.cohort.count({ where: { slug } })) > 0;
  }

  async findAll(): Promise<CohortWithCounts[]> {
    return prisma.cohort.findMany({
      orderBy: { startsAt: 'desc' },
      include: { _count: { select: { members: { where: { endedAt: null } }, projects: true } } },
    });
  }

  async listMembers(cohortId: string): Promise<CohortMemberRow[]> {
    const [members, counts] = await Promise.all([
      prisma.cohortMember.findMany({
        where: { cohortId },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: [{ endedAt: { sort: 'asc', nulls: 'first' } }, { role: 'desc' }, { joinedAt: 'asc' }],
      }),
      prisma.project.groupBy({ by: ['userId'], where: { cohortId }, _count: { _all: true } }),
    ]);
    const byUser = new Map(counts.map((c) => [c.userId, c._count._all]));
    return members.map((m) => ({ ...m, projectCount: byUser.get(m.userId) ?? 0 }));
  }

  async findMember(cohortId: string, userId: string): Promise<CohortMember | null> {
    return prisma.cohortMember.findUnique({ where: { cohortId_userId: { cohortId, userId } } });
  }

  async upsertMember(cohortId: string, userId: string, role: CohortRole): Promise<CohortMember> {
    return prisma.cohortMember.upsert({
      where: { cohortId_userId: { cohortId, userId } },
      create: { cohortId, userId, role },
      update: { role, endedAt: null },
    });
  }

  async endMember(cohortId: string, userId: string, at: Date): Promise<void> {
    await prisma.cohortMember.updateMany({ where: { cohortId, userId, endedAt: null }, data: { endedAt: at } });
  }

  async isActiveMentor(cohortId: string, userId: string): Promise<boolean> {
    return (await prisma.cohortMember.count({ where: { cohortId, userId, role: 'MENTOR', ...ACTIVE } })) > 0;
  }

  async listActiveMemberships(userId: string): Promise<MembershipWithCohort[]> {
    return prisma.cohortMember.findMany({
      where: { userId, ...ACTIVE },
      include: { cohort: true },
      orderBy: { joinedAt: 'desc' },
    });
  }

  async listProjects(cohortId: string): Promise<CohortProjectRow[]> {
    return prisma.project.findMany({
      where: { cohortId },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        isPrivate: true,
        user: { select: { id: true, email: true, name: true } },
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, subdomain: true, containerPort: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Each is one conditional UPDATE, so double clicks and a student racing an admin can't both win.
  async addProject(projectId: string, userId: string, cohortId: string): Promise<boolean> {
    const { count } = await prisma.project.updateMany({ where: { id: projectId, userId, cohortId: null }, data: { cohortId } });
    return count > 0;
  }

  async removeProject(cohortId: string, projectId: string): Promise<boolean> {
    const { count } = await prisma.project.updateMany({ where: { id: projectId, cohortId }, data: { cohortId: null } });
    return count > 0;
  }
}

export const cohortRepository = new CohortRepository();
