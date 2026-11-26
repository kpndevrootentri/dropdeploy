import type { ApiToken, ApiTokenScope, User } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** A token as the owner may see it: everything but the hash. */
export type ApiTokenRecord = Omit<ApiToken, 'tokenHash'>;

/** The owner fields a request made with the token needs. */
export type ApiTokenOwner = Pick<User, 'id' | 'email' | 'role' | 'mustResetPassword' | 'suspendedAt'>;

const RECORD_SELECT = {
  id: true,
  userId: true,
  name: true,
  prefix: true,
  scope: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

export interface IApiTokenRepository {
  create(data: {
    userId: string;
    name: string;
    tokenHash: string;
    prefix: string;
    scope: ApiTokenScope;
    expiresAt: Date | null;
  }): Promise<ApiTokenRecord>;
  /** Tokens that are neither revoked nor expired at `now`. */
  countActive(userId: string, now: Date): Promise<number>;
  /** All of the user's tokens, revoked and expired included, newest first. */
  listByUser(userId: string): Promise<ApiTokenRecord[]>;
  /** Sets revokedAt unless already set. False when the user has no token with this id. */
  revoke(userId: string, id: string, now: Date): Promise<boolean>;
  findByHash(tokenHash: string): Promise<(ApiTokenRecord & { user: ApiTokenOwner }) | null>;
  touch(id: string, now: Date): Promise<void>;
}

export class ApiTokenRepository implements IApiTokenRepository {
  async create(data: {
    userId: string;
    name: string;
    tokenHash: string;
    prefix: string;
    scope: ApiTokenScope;
    expiresAt: Date | null;
  }): Promise<ApiTokenRecord> {
    return prisma.apiToken.create({ data, select: RECORD_SELECT });
  }

  async countActive(userId: string, now: Date): Promise<number> {
    return prisma.apiToken.count({
      where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
  }

  async listByUser(userId: string): Promise<ApiTokenRecord[]> {
    return prisma.apiToken.findMany({ where: { userId }, select: RECORD_SELECT, orderBy: { createdAt: 'desc' } });
  }

  async revoke(userId: string, id: string, now: Date): Promise<boolean> {
    await prisma.apiToken.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: now } });
    return (await prisma.apiToken.count({ where: { id, userId } })) > 0;
  }

  async findByHash(tokenHash: string): Promise<(ApiTokenRecord & { user: ApiTokenOwner }) | null> {
    return prisma.apiToken.findUnique({
      where: { tokenHash },
      select: {
        ...RECORD_SELECT,
        user: { select: { id: true, email: true, role: true, mustResetPassword: true, suspendedAt: true } },
      },
    });
  }

  async touch(id: string, now: Date): Promise<void> {
    await prisma.apiToken.update({ where: { id }, data: { lastUsedAt: now } });
  }
}

export const apiTokenRepository = new ApiTokenRepository();
