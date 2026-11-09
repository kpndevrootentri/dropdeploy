import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { inviteRepository, type IInviteRepository } from '@/repositories/invite.repository';
import { userRepository, type IUserRepository } from '@/repositories/user.repository';
import { ValidationError } from '@/lib/errors';
import { SALT_ROUNDS } from '@/services/auth/auth.service';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** One message for every bad token — unknown, expired or used — so the link reveals nothing. */
export const INVALID_INVITE_MESSAGE = 'This invite link is invalid, has expired or was already used';

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The page a new user opens to choose their password. */
export function invitePath(token: string): string {
  return `/invite/${token}`;
}

export class InviteService {
  constructor(
    private readonly invites: IInviteRepository,
    private readonly users: IUserRepository,
  ) {}

  /** Returns the raw token. Only its hash is stored, so it cannot be shown again. */
  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.invites.create({
      userId,
      tokenHash: hashInviteToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    return token;
  }

  /**
   * Sets the invited user's password, once. setPassword also clears
   * mustResetPassword and signs out any other session.
   */
  async accept(token: string, password: string): Promise<void> {
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    // Hash first: once the token is consumed, only the password write is left to fail.
    // ponytail: consume + setPassword are not one transaction; if the write fails the link is spent and the admin must send a new one.
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = await this.invites.consume(hashInviteToken(token), new Date());
    if (!userId) throw new ValidationError(INVALID_INVITE_MESSAGE);
    await this.users.setPassword(userId, passwordHash, false);
  }
}

export const inviteService = new InviteService(inviteRepository, userRepository);
