type WebhookSecretFields = 'webhookSecretEnc' | 'webhookSecretIv' | 'webhookSecretTag';

/**
 * Removes the stored webhook secret from a project before it is sent to a
 * browser. It is encrypted, but the ciphertext is still a credential at rest:
 * anyone who also obtains ENV_ENCRYPTION_KEY can forge push webhooks with it,
 * and the dashboard never needs it.
 */
export function toPublicProject<T extends Partial<Record<WebhookSecretFields, unknown>>>(
  project: T,
): Omit<T, WebhookSecretFields> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { webhookSecretEnc, webhookSecretIv, webhookSecretTag, ...rest } = project;
  return rest;
}
