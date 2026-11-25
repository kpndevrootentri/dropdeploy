import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { inviteRepository, type IInviteRepository } from '@/repositories/invite.repository';
import { userRepository, type IUserRepository } from '@/repositories/user.repository';
import { ValidationError } from '@/lib/errors';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { sleep } from '@/lib/utils';
import { SALT_ROUNDS } from '@/services/auth/auth.service';
import { emailService, type EmailService } from '@/services/email';

const log = createLogger('invite');

const DAY_MS = 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * DAY_MS;
/** Short, because anyone can ask for a reset link for any address. */
export const RESET_TTL_MS = 60 * 60 * 1000;

// Keeps invite sends under 10 a second, below SES's per-second send rate (14/s on a new account).
const SEND_GAP_MS = 100;

/** One message for every bad token — unknown, expired or used — so the link reveals nothing. */
export const INVALID_INVITE_MESSAGE = 'This link is invalid, has expired or was already used';

/** An invite (new user, 7 days) or a password reset (1 hour); both open the same page. */
export type PasswordLinkKind = 'invite' | 'reset';

const EMAILS: Record<PasswordLinkKind, { subject: string; body: (url: string) => string }> = {
  invite: {
    subject: 'You are invited to Entrify',
    body: (url) =>
      `You have been invited to Entrify.\n\nChoose your password here. The link works once and expires in ${INVITE_TTL_MS / DAY_MS} days:\n${url}\n`,
  },
  reset: {
    subject: 'Reset your Entrify password',
    body: (url) =>
      `We got a request to reset the password for your Entrify account.\n\n` +
      `Choose a new password here. The link works once and expires in ${RESET_TTL_MS / 60_000} minutes:\n${url}\n\n` +
      `If you did not ask for this, ignore this email. Your password stays the same.\n`,
  },
};

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A fresh token: the raw value is shown to the admin once; only its hash and expiry are stored. */
export function newInviteToken(ttlMs = INVITE_TTL_MS): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token), expiresAt: new Date(Date.now() + ttlMs) };
}

/** A hash of random bytes nobody ever sees: the account cannot sign in until its invite is accepted. */
export async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString('hex'), SALT_ROUNDS);
}

/** The page a user opens to choose their password, from an invite or a reset link. */
export function invitePath(token: string): string {
  return `/invite/${token}`;
}

export class InviteService {
  constructor(
    private readonly invites: IInviteRepository,
    private readonly users: IUserRepository,
    private readonly email: Pick<EmailService, 'send' | 'canSendReset'> = emailService,
  ) {}

  /**
   * A new link for an existing user; any earlier unused link stops working.
   * Returns the raw token. Only its hash is stored, so it cannot be shown again.
   */
  async issue(userId: string, ttlMs = INVITE_TTL_MS): Promise<string> {
    const { token, tokenHash, expiresAt } = newInviteToken(ttlMs);
    await this.invites.replaceUnused({ userId, tokenHash, expiresAt });
    return token;
  }

  /**
   * Emails a password link. Never throws: returns whether it was sent. The URL
   * comes from NEXT_PUBLIC_APP_URL, never from the request, so a forged Host
   * header cannot point the link at another site.
   */
  async sendLink(email: string, token: string, kind: PasswordLinkKind): Promise<boolean> {
    const base = getConfig().NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
    if (!base) {
      log.warn('NEXT_PUBLIC_APP_URL is not set, so no link can be built; nothing sent');
      return false;
    }
    const { subject, body } = EMAILS[kind];
    return this.email.send({ to: email, subject, text: body(`${base}${invitePath(token)}`), kind });
  }

  /**
   * Emails each new account its invite link, one at a time. Callers run it in after():
   * hundreds of SES sends would outlast the request.
   */
  async sendInvites(invited: { email: string; inviteToken: string }[]): Promise<void> {
    // ponytail: not queued; links not yet sent when the process restarts are never emailed (admins still have them, or can issue new ones).
    for (const { email, inviteToken } of invited) {
      await this.sendLink(email, inviteToken, 'invite');
      await sleep(SEND_GAP_MS);
    }
  }

  /**
   * Forgot password: emails a 1-hour reset link when the address belongs to an
   * account that is not suspended, and quietly does nothing otherwise.
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email.trim());
    if (!user || user.suspendedAt) return;
    // A daily cap across all addresses (Admin → Email): a flood from many IPs must not use up the
    // quota invites need, and SES may pause an account that gets too many complaints.
    // Checked after the lookup, so only real sends count.
    if (!(await this.email.canSendReset())) {
      log.warn('Daily forgot-password email limit reached; nothing sent');
      return;
    }
    // Added, not replacing: anyone can ask for this, so it must not cancel a pending invite or
    // an admin's link. Stored only once sent, so a failed send stores nothing.
    const { token, tokenHash, expiresAt } = newInviteToken(RESET_TTL_MS);
    if (await this.sendLink(user.email, token, 'reset')) {
      await this.invites.add({ userId: user.id, tokenHash, expiresAt });
    }
  }

  /**
   * Sets the user's password from an invite or reset link, once. setPassword also clears
   * mustResetPassword and signs out any other session.
   */
  async accept(token: string, password: string): Promise<void> {
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const tokenHash = hashInviteToken(token);
    // A cheap lookup before the costly hash, so a junk token costs one query, not a bcrypt round.
    if (!(await this.invites.isLive(tokenHash, new Date()))) throw new ValidationError(INVALID_INVITE_MESSAGE);
    // Hash before consuming: once the token is spent, only the password write is left to fail.
    // ponytail: consume + setPassword are not one transaction; if the write fails the link is spent and the admin must send a new one.
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // consume, not isLive, enforces single use: of two simultaneous accepts only one gets a user back.
    const userId = await this.invites.consume(tokenHash, new Date());
    if (!userId) throw new ValidationError(INVALID_INVITE_MESSAGE);
    await this.users.setPassword(userId, passwordHash, false);
  }
}

export const inviteService = new InviteService(inviteRepository, userRepository);
