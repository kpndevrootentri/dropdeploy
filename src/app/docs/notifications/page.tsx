import type { Metadata } from 'next';
import { docsBreadcrumbJsonLd, howToJsonLd, jsonLdScriptProps } from '@/lib/json-ld';
import { Code, DocsHeader, DocsNext, Note, Pre, QA, Steps, stepsForJsonLd, type DocStep } from '@/components/docs/docs-ui';

const PATH = '/docs/notifications';
const TITLE = 'How do I get Slack, Discord or webhook notifications for deployments?';

export const metadata: Metadata = {
  title: 'Deployment notifications — Entrify Docs',
  description:
    'Add a Slack or Discord webhook, or any HTTPS URL, in a project\'s Settings to hear when a deployment succeeds or fails. Requests are signed with HMAC-SHA256.',
  alternates: { canonical: PATH },
};

const STEPS: DocStep[] = [
  {
    name: 'Create a webhook URL',
    text: 'In Slack, add an Incoming Webhook to a channel. In Discord, open the channel settings, then Integrations > Webhooks. Or use any HTTPS URL of your own.',
  },
  {
    name: 'Add it to the project',
    text: 'Open the project, then Settings > Notifications. Paste the URL, choose Deploy succeeded, Deploy failed or both, and click Add notification.',
  },
  {
    name: 'Copy the signing secret',
    text: 'It is shown once. Your own server uses it to check that a request came from Entrify; Slack and Discord do not need it.',
  },
  {
    name: 'Check the test message',
    text: 'Entrify sends a ping event straight away. The row then shows the status the URL answered with.',
  },
];

const PAYLOAD = `{
  "event": "deployment.failed",
  "createdAt": "2026-11-27T10:00:00.000Z",
  "project": { "id": "clx…", "name": "My App", "slug": "my-app", "url": "https://my-app.entrify.site" },
  "deployment": {
    "id": "cly…",
    "status": "FAILED",
    "commitHash": "4f2c9e1…",
    "failureReason": "npm error Missing script: \\"build\\"",
    "completedAt": "2026-11-27T10:00:00.000Z",
    "dashboardUrl": "https://entrify.site/projects/clx…"
  }
}`;

const VERIFY = `import { createHmac, timingSafeEqual } from 'node:crypto';

// rawBody: the request body exactly as received, before JSON.parse.
function isFromEntrify(rawBody, headers, secret) {
  const timestamp = headers['x-entrify-timestamp'];
  const expected = 'sha256=' + createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex');
  const given = Buffer.from(headers['x-entrify-signature'] ?? '');
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  return fresh && given.length === expected.length && timingSafeEqual(given, Buffer.from(expected));
}`;

export default function NotificationsPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <script {...jsonLdScriptProps([docsBreadcrumbJsonLd('Notifications', PATH), howToJsonLd(TITLE, stepsForJsonLd(STEPS))])} />

      <DocsHeader eyebrow="Getting Started" title={TITLE}>
        <p>
          Open your project, go to <em>Settings &gt; Notifications</em> and paste a Slack or Discord webhook URL, or any
          HTTPS URL. Entrify posts to it when a deployment succeeds or fails. A project can have up to 3.
        </p>
      </DocsHeader>

      <Steps steps={STEPS} />

      <QA question="What does Entrify send?">
        <p>
          Slack and Discord get a one-line message. Any other URL gets a JSON <Code>POST</Code>. The event is{' '}
          <Code>deployment.succeeded</Code>, <Code>deployment.failed</Code> or <Code>ping</Code> (sent once, when you add
          the URL). A ping has no <Code>deployment</Code>. Build logs are never sent.
        </p>
        <Pre>{PAYLOAD}</Pre>
      </QA>

      <QA question="Which headers come with each request?">
        <ul className="list-disc pl-5 space-y-1">
          <li><Code>X-Entrify-Event</Code>: the event name.</li>
          <li><Code>X-Entrify-Delivery</Code>: an id that stays the same when a delivery is retried.</li>
          <li><Code>X-Entrify-Timestamp</Code>: when it was sent, in Unix seconds.</li>
          <li>
            <Code>X-Entrify-Signature</Code>: <Code>sha256=</Code> and the hex HMAC-SHA256 of{' '}
            <Code>{'<timestamp>.<body>'}</Code>, keyed with the signing secret.
          </li>
        </ul>
      </QA>

      <QA question="How do I check the signature?">
        <p>In Node.js, compare in constant time and refuse old timestamps:</p>
        <Pre>{VERIFY}</Pre>
      </QA>

      <QA question="What if my server is down?">
        <p>
          Entrify waits up to 10 seconds for an answer. A timeout, a network error, a 429 or a 5xx is retried after 30
          seconds, 1, 2 and 4 minutes, then dropped. Any other status is not retried, and redirects are not followed.
          A retry can reach you after you already handled the first try, so skip deliveries whose{' '}
          <Code>X-Entrify-Delivery</Code> you have seen. Settings shows the status of the last try for each URL.
        </p>
      </QA>

      <Note>
        <p>
          The URL must use HTTPS on port 443 and a public hostname; IP addresses and private networks are refused. To
          change a URL or its events, delete it and add it again. Hooks are removed when a project changes owner.
        </p>
      </Note>

      <DocsNext href="/docs/local-dev" label="Local Development" />
    </div>
  );
}
