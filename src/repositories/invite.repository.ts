import { prisma } from '@/lib/prisma';

export interface IInviteRepository {
  /** Deletes the user's unused invites and stores this one, atomically, so only the newest link works. */
  replaceUnused(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  /** Whether the invite exists, is unused and has not expired. A read only: {@link consume} is the single-use guard. */
  isLive(tokenHash: string, now: Date): Promise<boolean>;
  /**
   * Marks an unused, unexpired invite as used and returns its user, or null.
   * One conditional update, so two simultaneous accepts cannot both succeed.
   */
  consume(tokenHash: string, now: Date): Promise<string | null>;
}

export class InviteRepository implements IInviteRepository {
  async replaceUnused(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await prisma.$transaction([
      prisma.inviteToken.deleteMany({ where: { userId: data.userId, usedAt: null } }),
      prisma.inviteToken.create({ data }),
    ]);
  }

  async isLive(tokenHash: string, now: Date): Promise<boolean> {
    const invite = await prisma.inviteToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    return invite !== null;
  }

  async consume(tokenHash: string, now: Date): Promise<string | null> {
    const { count } = await prisma.inviteToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count === 0) return null;
    const invite = await prisma.inviteToken.findUnique({ where: { tokenHash }, select: { userId: true } });
    return invite?.userId ?? null;
  }
}

export const inviteRepository = new InviteRepository();
