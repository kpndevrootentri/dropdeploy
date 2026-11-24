const send = jest.fn();
jest.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn(() => ({ send })),
  SendEmailCommand: jest.fn((input: unknown) => ({ input })),
  GetAccountCommand: jest.fn((input: unknown) => ({ input })),
}));
const config: Record<string, string | undefined> = {};
jest.mock('@/lib/config', () => ({ getConfig: () => config }));

import { getSesAccount, missingEmailSettings, sendViaSes } from '@/lib/email';

beforeEach(() => {
  send.mockReset();
  Object.assign(config, { SES_REGION: 'ap-south-1', NEXT_PUBLIC_APP_URL: 'https://entrify.site' });
});

describe('Amazon SES helpers', () => {
  it('sends a plain-text email from noreply@entrify.site, and throws when SES refuses', async () => {
    send.mockResolvedValueOnce({ MessageId: 'm1' });
    await sendViaSes('a@x.com', 'Hi', 'Body');
    expect(send.mock.calls[0][0].input).toEqual({
      FromEmailAddress: 'Entrify <noreply@entrify.site>',
      Destination: { ToAddresses: ['a@x.com'] },
      Content: { Simple: { Subject: { Data: 'Hi', Charset: 'UTF-8' }, Body: { Text: { Data: 'Body', Charset: 'UTF-8' } } } },
    });
    send.mockRejectedValueOnce(new Error('MessageRejected'));
    await expect(sendViaSes('a@x.com', 'Hi', 'Body')).rejects.toThrow('MessageRejected');
  });

  it('reads the account quota, treating -1 as no limit', async () => {
    send.mockResolvedValueOnce({
      ProductionAccessEnabled: false,
      SendingEnabled: true,
      EnforcementStatus: 'HEALTHY',
      SendQuota: { Max24HourSend: -1, MaxSendRate: 14, SentLast24Hours: 12 },
    });
    await expect(getSesAccount()).resolves.toEqual({
      productionAccess: false,
      sendingEnabled: true,
      enforcementStatus: 'HEALTHY',
      max24HourSend: 0,
      sentLast24Hours: 12,
      maxSendRatePerSecond: 14,
    });
  });

  it('names what is missing before anything can be emailed, treating empty as unset', () => {
    expect(missingEmailSettings()).toEqual([]);
    Object.assign(config, { SES_REGION: '', NEXT_PUBLIC_APP_URL: undefined });
    expect(missingEmailSettings()).toEqual(['SES_REGION', 'NEXT_PUBLIC_APP_URL']);
  });
});
