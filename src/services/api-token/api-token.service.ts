import { createHash, randomBytes } from 'crypto';
import type { ApiTokenScope } from '@prisma/client';
import {
  apiTokenRepository,
  type ApiTokenOwner,
  type ApiTokenRecord,
  type IApiTokenRepository,
} from '@/repositories/api-token.repository';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const log = createLogger('api-token');

const DAY_MS = 24 * 60 * 60 * 1000;
export const API_TOKEN_PREFIX = 'ent_';
export const MAX_ACTIVE_API_TOKENS = 20;
/** lastUsedAt is a hint for the settings page, not an audit trail, so one write per token per 5 minutes is plenty. */
export const LAST_USED_INTERVAL_MS = 5 * 60 * 1000;

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class ApiTokenService {
  constructor(private readonly tokens: IApiTokenRepository) {}

  /** Returns the plaintext token once; only its hash is stored, so it cannot be shown again. */
  async create(
    userId: string,
    input: { name: string; scope: ApiTokenScope; expiresInDays: number | null },
  ): Promise<{ token: string; record: ApiTokenRecord }> {
    const now = new Date();
    // ponytail: count-then-create is not atomic; two simultaneous creates at 19 can reach 21. Fine for a soft cap.
    if ((await this.tokens.countActive(userId, now)) >= MAX_ACTIVE_API_TOKENS) {
      throw new ValidationError(`You can have at most ${MAX_ACTIVE_API_TOKENS} active API tokens. Revoke one first.`);
    }
    const token = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const record = await this.tokens.create({
      userId,
      name: input.name,
      tokenHash: hashApiToken(token),
      prefix: token.slice(0, 12),
      scope: input.scope,
      expiresAt: input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * DAY_MS),
    });
    log.info('API token created', { userId, tokenId: record.id, prefix: record.prefix, scope: record.scope });
    return { token, record };
  }

  list(userId: string): Promise<ApiTokenRecord[]> {
    return this.tokens.listByUser(userId);
  }

  async revoke(userId: string, id: string): Promise<void> {
    if (!(await this.tokens.revoke(userId, id, new Date()))) throw new NotFoundError('API token');
    log.info('API token revoked', { userId, tokenId: id });
  }

  /** The token's owner and record, or null when the token is unknown, revoked, expired or its owner is suspended. */
  async verify(plaintext: string): Promise<{ user: ApiTokenOwner; token: ApiTokenRecord } | null> {
    const found = await this.tokens.findByHash(hashApiToken(plaintext));
    const now = new Date();
    if (!found || found.revokedAt || (found.expiresAt && found.expiresAt <= now) || found.user.suspendedAt) {
      return null;
    }
    const { user, ...token } = found;
    if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() >= LAST_USED_INTERVAL_MS) {
      this.tokens.touch(token.id, now).catch((error: unknown) => {
        log.warn('Could not record API token use', {
          tokenId: token.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return { user, token };
  }
}

export const apiTokenService = new ApiTokenService(apiTokenRepository);
