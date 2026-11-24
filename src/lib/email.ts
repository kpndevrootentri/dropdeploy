import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';

const log = createLogger('email');

/** Every email comes from this address; entrify.site must be a verified identity in SES_REGION. */
export const EMAIL_FROM = 'noreply@entrify.site';

let client: SESv2Client | undefined;

/**
 * The SES client. Credentials come from the default AWS chain: on the server, the
 * EC2 instance's IAM role (needs ses:SendEmail), so no keys live in .env.
 */
function ses(): SESv2Client {
  client ??= new SESv2Client({
    region: getConfig().SES_REGION,
    // Admin requests wait for the send; without these a stuck connection hangs them.
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 20_000 },
  });
  return client;
}

/** Whether password links can be emailed: SES_REGION and NEXT_PUBLIC_APP_URL (to build the link) are set. */
export function isEmailConfigured(): boolean {
  const { SES_REGION, NEXT_PUBLIC_APP_URL } = getConfig();
  return !!SES_REGION && !!NEXT_PUBLIC_APP_URL;
}

/**
 * Sends a plain-text email from EMAIL_FROM through Amazon SES. Never throws:
 * returns false when email is not configured or SES refuses it, so callers can
 * fall back to showing the link instead.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!getConfig().SES_REGION) {
    log.warn('Email is not configured (SES_REGION); nothing sent', { subject });
    return false;
  }
  try {
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
    return true;
  } catch (err) {
    log.error('Could not send email', { to, subject, error: String(err) });
    return false;
  }
}
