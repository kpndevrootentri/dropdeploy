const send = jest.fn();
jest.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn(() => ({ send })),
  SendEmailCommand: jest.fn((input: unknown) => ({ input })),
}));
const config: Record<string, string | undefined> = {};
jest.mock('@/lib/config', () => ({ getConfig: () => config }));

import { sendEmail } from '@/lib/email';

beforeEach(() => {
  send.mockReset();
  config.SES_REGION = 'ap-south-1';
});

describe('sendEmail (Amazon SES)', () => {
  it('sends a plain-text email from noreply@entrify.site', async () => {
    send.mockResolvedValue({ MessageId: 'm1' });
    await expect(sendEmail('a@x.com', 'Hi', 'Body')).resolves.toBe(true);
    expect(send.mock.calls[0][0].input).toEqual({
      FromEmailAddress: 'Entrify <noreply@entrify.site>',
      Destination: { ToAddresses: ['a@x.com'] },
      Content: { Simple: { Subject: { Data: 'Hi', Charset: 'UTF-8' }, Body: { Text: { Data: 'Body', Charset: 'UTF-8' } } } },
    });
  });

  it('returns false instead of throwing when SES refuses, and sends nothing without SES_REGION', async () => {
    send.mockRejectedValue(new Error('MessageRejected: Email address is not verified'));
    await expect(sendEmail('a@x.com', 'Hi', 'Body')).resolves.toBe(false);

    send.mockReset();
    config.SES_REGION = '';
    await expect(sendEmail('a@x.com', 'Hi', 'Body')).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
