import type { Prisma, User, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** An invite link's stored half: the token's hash and when it stops working. */
export interface NewInvite {
  tokenHash: string;
  expiresAt: Date;
}

/** Starting quotas for a new account; the schema defaults apply when omitted. */
export interface NewUserQuotas {
  projectQuota: number;
  domainQuota: number;
}

export type NewUserData = {
  email: string;
  passwordHash: string;
  role?: UserRole;
  mustResetPassword?: boolean;
  invite?: NewInvite;
} & Partial<NewUserQuotas>;

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  /** With `invite`, the user and their invite are written together or not at all. */
  create(data: NewUserData): Promise<User>;
  /**
   * Creates USER accounts that must reset their password, each with its
   * invite, in one transaction; skips emails already registered. Returns the
   * accounts created.
   */
  createMany(
    invited: (NewInvite & { email: string })[],
    passwordHash: string,
    quotas?: NewUserQuotas,
  ): Promise<{ id: string; email: string }[]>;
  /** `tx`, when given, runs the write inside that transaction (see AdminService's last-admin lock). */
  updateRole(id: string, role: UserRole, tx?: Prisma.TransactionClient): Promise<User>;
  updateQuota(id: string, quota: number): Promise<User>;
  /** Custom domains the user may claim across all their projects. */
  updateDomainQuota(id: string, quota: number): Promise<User>;
  setPassword(id: string, passwordHash: string, mustResetPassword?: boolean): Promise<User>;
  /** Suspends or reinstates the user; both revoke every outstanding session. */
  setSuspended(id: string, suspended: boolean, tx?: Prisma.TransactionClient): Promise<User>;
  /** Signs the user out of every browser and CLI. */
  revokeSessions(id: string): Promise<void>;
  delete(id: string, tx?: Prisma.TransactionClient): Promise<void>;
  /** Whether the dashboard product tour has been offered and answered. */
  isTourSeen(id: string): Promise<boolean>;
  /** Declined, skipped and completed all count; replays keep the first timestamp. */
  markTourSeen(id: string): Promise<void>;
  /** Whether the welcome modal has been shown and closed. */
  isWelcomeSeen(id: string): Promise<boolean>;
  markWelcomeSeen(id: string): Promise<void>;
}

export class UserRepository implements IUserRepository {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findAll(): Promise<User[]> {
    return prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async create(data: NewUserData): Promise<User> {
    // A nested create runs in one transaction.
    return prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        ...(data.role ? { role: data.role } : {}),
        ...(data.mustResetPassword !== undefined ? { mustResetPassword: data.mustResetPassword } : {}),
        ...(data.projectQuota !== undefined ? { projectQuota: data.projectQuota } : {}),
        ...(data.domainQuota !== undefined ? { domainQuota: data.domainQuota } : {}),
        ...(data.invite ? { inviteTokens: { create: data.invite } } : {}),
      },
    });
  }

  async createMany(
    invited: (NewInvite & { email: string })[],
    passwordHash: string,
    quotas?: NewUserQuotas,
  ): Promise<{ id: string; email: string }[]> {
    const invites = new Map(invited.map((i) => [i.email.toLowerCase(), i]));
    return prisma.$transaction(async (tx) => {
      const users = await tx.user.createManyAndReturn({
        data: [...invites.keys()].map((email) => ({ email, passwordHash, mustResetPassword: true, ...quotas })),
        skipDuplicates: true,
        select: { id: true, email: true },
      });
      await tx.inviteToken.createMany({
        data: users.map((u) => ({ userId: u.id, tokenHash: invites.get(u.email)!.tokenHash, expiresAt: invites.get(u.email)!.expiresAt })),
      });
      return users;
    });
  }

  /** Also revokes the user's sessions, so a demotion takes effect at once. */
  async updateRole(id: string, role: UserRole, tx: Prisma.TransactionClient = prisma): Promise<User> {
    return tx.user.update({ where: { id }, data: { role, tokenVersion: { increment: 1 } } });
  }

  async updateQuota(id: string, quota: number): Promise<User> {
    return prisma.user.update({ where: { id }, data: { projectQuota: quota } });
  }

  async updateDomainQuota(id: string, quota: number): Promise<User> {
    return prisma.user.update({ where: { id }, data: { domainQuota: quota } });
  }

  /**
   * Also revokes every outstanding session, CLI token and unused invite link —
   * a stolen token or a mis-sent link must not outlive the password change
   * meant to lock its holder out. Accepting an invite marks it used first, so
   * that one is kept as a record.
   */
  async setPassword(id: string, passwordHash: string, mustResetPassword = false): Promise<User> {
    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { passwordHash, mustResetPassword, tokenVersion: { increment: 1 } },
      }),
      prisma.inviteToken.deleteMany({ where: { userId: id, usedAt: null } }),
    ]);
    return user;
  }

  async setSuspended(id: string, suspended: boolean, tx: Prisma.TransactionClient = prisma): Promise<User> {
    return tx.user.update({
      where: { id },
      data: { suspendedAt: suspended ? new Date() : null, tokenVersion: { increment: 1 } },
    });
  }

  async revokeSessions(id: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
  }

  async delete(id: string, tx: Prisma.TransactionClient = prisma): Promise<void> {
    await tx.user.delete({ where: { id } });
  }

  async isTourSeen(id: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id }, select: { tourSeenAt: true } });
    return user?.tourSeenAt != null;
  }

  /** One conditional update: keeps the first timestamp, and two calls cannot race. */
  async markTourSeen(id: string): Promise<void> {
    await prisma.user.updateMany({ where: { id, tourSeenAt: null }, data: { tourSeenAt: new Date() } });
  }

  async isWelcomeSeen(id: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id }, select: { welcomeSeenAt: true } });
    return user?.welcomeSeenAt != null;
  }

  /** Same conditional update as markTourSeen. */
  async markWelcomeSeen(id: string): Promise<void> {
    await prisma.user.updateMany({ where: { id, welcomeSeenAt: null }, data: { welcomeSeenAt: new Date() } });
  }
}

export const userRepository = new UserRepository();
