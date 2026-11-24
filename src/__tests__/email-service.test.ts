const config = { SES_REGION: 'ap-south-1', NEXT_PUBLIC_APP_URL: 'https://entrify.site' };
jest.mock('@/lib/config', () => ({ getConfig: () => config }));

import { EmailService } from '@/services/email/email.service';
import { DEFAULT_PLATFORM_SETTINGS, type PlatformSettings } from '@/services/platform-settings/platform-settings.service';
import type { IEmailLogRepository, NewEmailLog } from '@/repositories/email-log.repository';
import type { SesAccount } from '@/lib/email';

const NOW = new Date('2026-11-24T10:00:00Z');
type Row = NewEmailLog & { at: Date };

/** An in-memory log; `earlier` rows are sends from before the test, at the given times. */
function setup(opts: { refuse?: boolean; quotas?: Partial<PlatformSettings>; earlier?: Row[]; failLogWrites?: boolean } = {}) {
  const rows: Row[] = [...(opts.earlier ?? [])];
  const logs: IEmailLogRepository = {
    create: async (entry) => {
      if (opts.failLogWrites) throw new Error('db down');
      rows.push({ ...entry, at: NOW });
    },
    count: async ({ status, since, kind }) => rows.filter((r) => r.status === status && r.at >= since && (!kind || r.kind === kind)).length,
    recentFailures: async () => [],
  };
  const deliver = jest.fn(async () => {
    if (opts.refuse) throw new Error('MessageRejected: Email address is not verified');
  });
  const readAccount = jest.fn(async (): Promise<SesAccount> => ({
    productionAccess: true, sendingEnabled: true, enforcementStatus: 'HEALTHY', max24HourSend: 50_000, sentLast24Hours: 3, maxSendRatePerSecond: 14,
  }));
  const settings = { get: async () => ({ ...DEFAULT_PLATFORM_SETTINGS, ...opts.quotas }) };
  const service = new EmailService(logs, settings, deliver, readAccount, () => NOW);
  return { service, rows, deliver, readAccount };
}

const sent = (count: number, at: Date, kind = 'invite'): Row[] =>
  Array.from({ length: count }, () => ({ kind, recipient: 'x@y.z', status: 'sent' as const, at }));

describe('EmailService.send', () => {
  it('sends through SES and logs it', async () => {
    const { service, rows } = setup();
    await expect(service.send('a@x.com', 'Hi', 'Body', 'invite')).resolves.toBe(true);
    expect(rows).toMatchObject([{ kind: 'invite', recipient: 'a@x.com', status: 'sent', error: null }]);
  });

  it('returns false and logs the error when SES refuses', async () => {
    const { service, rows } = setup({ refuse: true });
    await expect(service.send('a@x.com', 'Hi', 'Body', 'reset')).resolves.toBe(false);
    expect(rows).toMatchObject([{ status: 'failed', error: expect.stringContaining('MessageRejected') }]);
  });

  it('holds emails back once the daily or monthly quota is used up, counting only this UTC day or month', async () => {
    const yesterday = new Date('2026-11-23T23:00:00Z');
    const daily = setup({ quotas: { emailDailyLimit: 2 }, earlier: [...sent(2, NOW), ...sent(5, yesterday)] });
    await expect(daily.service.send('a@x.com', 'Hi', 'Body', 'invite')).resolves.toBe(false);
    expect(daily.deliver).not.toHaveBeenCalled();
    expect(daily.rows.at(-1)).toMatchObject({ status: 'failed', error: expect.stringContaining('Daily email quota') });

    const underDaily = setup({ quotas: { emailDailyLimit: 3 }, earlier: [...sent(2, NOW), ...sent(5, yesterday)] });
    await expect(underDaily.service.send('a@x.com', 'Hi', 'Body', 'invite')).resolves.toBe(true);

    const monthly = setup({ quotas: { emailMonthlyLimit: 3 }, earlier: sent(3, new Date('2026-11-01T00:00:00Z')) });
    await expect(monthly.service.send('a@x.com', 'Hi', 'Body', 'invite')).resolves.toBe(false);
    expect(monthly.deliver).not.toHaveBeenCalled();
  });

  it('still reports a sent email as sent when the log write fails', async () => {
    const { service, deliver } = setup({ failLogWrites: true });
    await expect(service.send('a@x.com', 'Hi', 'Body', 'invite')).resolves.toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});

describe('EmailService.canSendReset', () => {
  it('allows forgot-password emails until today’s limit, and always when it is 0', async () => {
    const earlier = sent(2, NOW, 'reset');
    await expect(setup({ quotas: { resetEmailsPerDay: 3 }, earlier }).service.canSendReset()).resolves.toBe(true);
    await expect(setup({ quotas: { resetEmailsPerDay: 2 }, earlier }).service.canSendReset()).resolves.toBe(false);
    await expect(setup({ quotas: { resetEmailsPerDay: 0 }, earlier }).service.canSendReset()).resolves.toBe(true);
  });
});

describe('EmailService.usage', () => {
  it('reports the live SES account, or why it could not be read', async () => {
    const ok = setup();
    await expect(ok.service.usage()).resolves.toMatchObject({ from: 'noreply@entrify.site', sesAccount: { max24HourSend: 50_000 }, sesAccountError: null });

    const denied = setup();
    denied.readAccount.mockRejectedValue(new Error('AccessDeniedException: not authorized to perform ses:GetAccount'));
    await expect(denied.service.usage()).resolves.toMatchObject({ sesAccount: null, sesAccountError: expect.stringContaining('ses:GetAccount') });
  });
});
