import nodemailer, { type Transporter } from 'nodemailer';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';

const log = createLogger('email');

let transport: Transporter | undefined;

/** Whether GMAIL_USER and GMAIL_APP_PASSWORD are both set. */
export function isEmailConfigured(): boolean {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = getConfig();
  return !!GMAIL_USER && !!GMAIL_APP_PASSWORD;
}

/**
 * Sends a plain-text email from GMAIL_USER. Never throws: returns false when
 * email is not configured or the send fails, so callers can fall back to
 * showing the link instead.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = getConfig();
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    log.warn('Email is not configured (GMAIL_USER, GMAIL_APP_PASSWORD); nothing sent', { subject });
    return false;
  }
  transport ??= nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    // Admin requests wait for the send; the defaults would hang them for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({ from: `Entrify <${GMAIL_USER}>`, to, subject, text });
    return true;
  } catch (err) {
    log.error('Could not send email', { to, subject, error: String(err) });
    return false;
  }
}
