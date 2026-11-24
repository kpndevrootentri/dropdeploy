import { emailLogRepository, type IEmailLogRepository } from '@/repositories/email-log.repository';
import {
  DEFAULT_PLATFORM_SETTINGS,
  platformSettingsService,
  type PlatformSettings,
} from '@/services/platform-settings/platform-settings.service';
import { getConfig } from '@/lib/config';
import { EMAIL_FROM, getSesAccount, isEmailConfigured, missingEmailSettings, sendViaSes, type SesAccount } from '@/lib/email';
import { createLogger } from '@/lib/logger';

const log = createLogger('email');

export type EmailKind = 'invite' | 'reset' | 'test';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  kind: EmailKind;
}

export interface TestEmailResult {
  sent: boolean;
  error: string | null;
}

/** A failed attempt as the admin Email page receives it: JSON turns the date into a string. */
export interface EmailFailure {
  id: string;
  kind: string;
  recipient: string;
  error: string | null;
  createdAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Over a month, so the monthly count stays right; older attempts are deleted. */
const LOG_RETENTION_DAYS = 90;
const RECENT_FAILURES_SHOWN = 20;

/** Midnight UTC today and on the 1st of this month: quotas are counted per UTC day and month. */
function periodStarts(now: Date): { day: Date; month: Date } {
  return {
    day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

/** What the admin Email page shows. Counts are emails Entrify sent, per UTC day and month; limits of 0 mean none. */
export interface EmailUsage {
  from: string;
  region: string | null;
  /** Read live from SES; null with the reason when it cannot be read, or null alone while email is off. */
  sesAccount: SesAccount | null;
  sesAccountError: string | null;
  /** Settings still needed before anything is emailed; empty when email is on. */
  missing: string[];
  sent: { today: number; thisMonth: number; dailyLimit: number; monthlyLimit: number };
  resets: { today: number; dailyLimit: number };
  failedToday: number;
  recentFailures: EmailFailure[];
}

export class EmailService {
  private lastPruned = 0;

  constructor(
    private readonly logs: IEmailLogRepository,
    private readonly settings: { get(): Promise<PlatformSettings> },
    private readonly deliver: (to: string, subject: string, text: string) => Promise<void> = sendViaSes,
    private readonly readSesAccount: () => Promise<SesAccount> = getSesAccount,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Sends a plain-text email through SES unless today's or this month's quota is
   * used up, and logs the attempt. Never throws: returns false when it was not
   * sent, so callers can show the link instead.
   */
  async send(email: OutgoingEmail): Promise<boolean> {
    if (!isEmailConfigured()) {
      log.warn('Email is not configured; nothing sent', { missing: missingEmailSettings(), subject: email.subject });
      return false;
    }
    const quotaReached = await this.quotaReached();
    if (quotaReached) {
      log.warn('Email quota reached; nothing sent', { quotaReached, subject: email.subject });
      // Logged as a failure so the admin Email page shows why the email did not arrive.
      await this.record({ kind: email.kind, recipient: email.to, status: 'failed', error: `${quotaReached} (Admin → Email)` });
      return false;
    }
    return (await this.attempt(email)) === null;
  }

  /** A test email to `to`, whatever the quotas. Returns SES's error when it refuses. */
  async sendTest(to: string): Promise<TestEmailResult> {
    if (!isEmailConfigured()) return { sent: false, error: `Not set: ${missingEmailSettings().join(', ')}` };
    const text = `This is a test email from Entrify, sent through Amazon SES (${getConfig().SES_REGION}). Email is working.\n`;
    const error = await this.attempt({ to, subject: 'Entrify test email', text, kind: 'test' });
    return { sent: error === null, error };
  }

  /** Whether another forgot-password email fits in today's limit (0 means no limit). */
  async canSendReset(): Promise<boolean> {
    const { resetEmailsPerDay } = await this.limits();
    if (resetEmailsPerDay === 0) return true;
    const sent = await this.logs.count({ status: 'sent', kind: 'reset', since: periodStarts(this.now()).day });
    return sent < resetEmailsPerDay;
  }

  async usage(): Promise<EmailUsage> {
    const settings = await this.settings.get();
    const { day, month } = periodStarts(this.now());
    const { SES_REGION } = getConfig();
    const [today, thisMonth, resetsToday, failedToday, recentFailures, ses] = await Promise.all([
      this.logs.count({ status: 'sent', since: day }),
      this.logs.count({ status: 'sent', since: month }),
      this.logs.count({ status: 'sent', kind: 'reset', since: day }),
      this.logs.count({ status: 'failed', since: day }),
      this.logs.recentFailures(RECENT_FAILURES_SHOWN),
      SES_REGION
        ? this.readSesAccount().then(
            (account) => ({ account, error: null }),
            (err) => ({ account: null, error: String(err) }),
          )
        : { account: null, error: null },
    ]);
    return {
      from: EMAIL_FROM,
      region: SES_REGION || null,
      sesAccount: ses.account,
      sesAccountError: ses.error,
      missing: missingEmailSettings(),
      sent: { today, thisMonth, dailyLimit: settings.emailDailyLimit, monthlyLimit: settings.emailMonthlyLimit },
      resets: { today: resetsToday, dailyLimit: settings.resetEmailsPerDay },
      failedToday,
      recentFailures: recentFailures.map(({ id, kind, recipient, error, createdAt }) => ({
        id,
        kind,
        recipient,
        error,
        createdAt: createdAt.toISOString(),
      })),
    };
  }

  /** Sends through SES and logs the attempt. Returns the error, or null when it was sent. */
  private async attempt({ to, subject, text, kind }: OutgoingEmail): Promise<string | null> {
    let error: string | null = null;
    try {
      await this.deliver(to, subject, text);
    } catch (err) {
      error = String(err);
      log.error('Could not send email', { to, subject, error });
    }
    await this.record({ kind, recipient: to, status: error === null ? 'sent' : 'failed', error });
    return error;
  }

  /**
   * A failed log write is only logged: the email itself was already sent or refused.
   * Also deletes old attempts, at most once a day per process, so email_logs stays small.
   */
  private async record(entry: Parameters<IEmailLogRepository['create']>[0]): Promise<void> {
    await this.logs.create(entry).catch((err) => log.error('Could not record an email attempt', { error: String(err) }));
    const now = this.now().getTime();
    if (now - this.lastPruned < DAY_MS) return;
    this.lastPruned = now;
    await this.logs
      .deleteOlderThan(new Date(now - LOG_RETENTION_DAYS * DAY_MS))
      .catch((err) => log.error('Could not delete old email attempts', { error: String(err) }));
  }

  /** The settings, or the defaults when they cannot be read: sending matters more than the quotas. */
  private limits(): Promise<PlatformSettings> {
    return this.settings.get().catch((err) => {
      log.error('Could not read the email quotas; using the defaults', { error: String(err) });
      return DEFAULT_PLATFORM_SETTINGS;
    });
  }

  /** Which quota is used up, or null when another email fits. */
  private async quotaReached(): Promise<string | null> {
    const { emailDailyLimit, emailMonthlyLimit } = await this.limits();
    const { day, month } = periodStarts(this.now());
    try {
      // ponytail: check-then-send, so simultaneous sends can pass a quota by a few.
      if (emailDailyLimit > 0 && (await this.logs.count({ status: 'sent', since: day })) >= emailDailyLimit) {
        return 'Daily email quota reached';
      }
      if (emailMonthlyLimit > 0 && (await this.logs.count({ status: 'sent', since: month })) >= emailMonthlyLimit) {
        return 'Monthly email quota reached';
      }
      return null;
    } catch (err) {
      log.error('Could not count sent emails; sending anyway', { error: String(err) });
      return null;
    }
  }
}

export const emailService = new EmailService(emailLogRepository, platformSettingsService);
