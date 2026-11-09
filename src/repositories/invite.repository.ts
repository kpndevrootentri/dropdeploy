import { prisma } from '@/lib/prisma';

export interface IInviteRepository {
  create(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  /**
   * Marks an unused, unexpired invite as used and returns its user, or null.
   * One conditional update, so two simultaneous accepts cannot both succeed.
   */
  consume(tokenHash: string, now: Date): Promise<string | null>;
}

export class InviteRepository implements IInviteRepository {
  async create(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await prisma.inviteToken.create({ data });
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
