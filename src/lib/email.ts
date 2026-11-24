import { GetAccountCommand, SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { getConfig } from '@/lib/config';

/** Every email comes from this address; entrify.site must be a verified identity in SES_REGION. */
export const EMAIL_FROM = 'noreply@entrify.site';

let client: SESv2Client | undefined;

/**
 * The SES client. Credentials come from the default AWS chain: on the server, the
 * EC2 instance's IAM role (ses:SendEmail, plus ses:GetAccount for the admin Email
 * page), so no keys live in .env.
 */
function ses(): SESv2Client {
  client ??= new SESv2Client({
    region: getConfig().SES_REGION,
    // Admin requests wait for the send; without these a stuck connection hangs them.
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 20_000 },
  });
  return client;
}

/** The settings still needed before password links can be emailed; empty when email is on. */
export function missingEmailSettings(): string[] {
  const { SES_REGION, NEXT_PUBLIC_APP_URL } = getConfig();
  // NEXT_PUBLIC_APP_URL because links in emails are built from it.
  return [...(SES_REGION ? [] : ['SES_REGION']), ...(NEXT_PUBLIC_APP_URL ? [] : ['NEXT_PUBLIC_APP_URL'])];
}

/** Whether password links can be emailed. */
export function isEmailConfigured(): boolean {
  return missingEmailSettings().length === 0;
}

/** Sends one plain-text email from EMAIL_FROM through SES. Throws when SES refuses it. */
export async function sendViaSes(to: string, subject: string, text: string): Promise<void> {
  await ses().send(
    new SendEmailCommand({
      FromEmailAddress: `Entrify <${EMAIL_FROM}>`,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: text, Charset: 'UTF-8' } },
        },
      },
    }),
  );
}

/** The SES account's own quota and state, which AWS sets; counts cover every sender on the account. */
export interface SesAccount {
  /** False while in the sandbox: only verified addresses, 200 a day. */
  productionAccess: boolean;
  sendingEnabled: boolean;
  /** HEALTHY, PROBATION or SHUTDOWN: SES's verdict on bounce and complaint rates. */
  enforcementStatus: string | null;
  /** Rolling 24 hours; 0 when AWS reports no limit. */
  max24HourSend: number;
  sentLast24Hours: number;
  maxSendRatePerSecond: number;
}

/** Reads the SES account (ses:GetAccount). Throws when SES or the IAM role refuses. */
export async function getSesAccount(): Promise<SesAccount> {
  const account = await ses().send(new GetAccountCommand({}));
  const quota = account.SendQuota;
  return {
    productionAccess: account.ProductionAccessEnabled ?? false,
    sendingEnabled: account.SendingEnabled ?? false,
    enforcementStatus: account.EnforcementStatus ?? null,
    // AWS reports -1 for no limit.
    max24HourSend: Math.max(0, quota?.Max24HourSend ?? 0),
    sentLast24Hours: quota?.SentLast24Hours ?? 0,
    maxSendRatePerSecond: quota?.MaxSendRate ?? 0,
  };
}
