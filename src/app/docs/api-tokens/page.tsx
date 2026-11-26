import type { Metadata } from 'next';
import { docsBreadcrumbJsonLd, howToJsonLd, jsonLdScriptProps } from '@/lib/json-ld';
import { Code, DocsHeader, DocsNext, Note, Pre, QA, Steps, TextLink, stepsForJsonLd, type DocStep } from '@/components/docs/docs-ui';

const PATH = '/docs/api-tokens';
const TITLE = 'How do I create an Entrify API token?';

export const metadata: Metadata = {
  title: 'API tokens — Entrify Docs',
  description:
    'Create an Entrify API token in Settings to deploy from Claude Desktop, CI or scripts. Choose Deploy only or Full access and an expiry of 30, 90 or 365 days, or none.',
  alternates: { canonical: PATH },
};

const STEPS: DocStep[] = [
  {
    name: 'Open Settings > API tokens',
    text: 'Sign in to Entrify and open Settings. The API tokens card is at entrify.site/settings#api-tokens.',
  },
  {
    name: 'Name it and choose its access',
    text: 'Give the token a name you will recognise, such as "Claude Desktop" or "GitHub Actions". Choose Deploy only unless the token must manage environment variables or settings.',
  },
  {
    name: 'Choose when it expires',
    text: 'After 30, 90 or 365 days, or never. The default is 90 days.',
  },
  {
    name: 'Create it and copy it',
    text: 'The token starts with ent_. It is shown only once, so copy it now and store it somewhere safe.',
  },
];

const DEPLOY_ONLY = [
  'List your projects and see one project',
  'Upload a new site, or a new version of an uploaded site',
  'Start a deploy of an existing project',
  'Read deployments and build logs',
  'Roll back or cancel a deployment',
];

export default function ApiTokensPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <script {...jsonLdScriptProps([docsBreadcrumbJsonLd('API tokens', PATH), howToJsonLd(TITLE, stepsForJsonLd(STEPS))])} />

      <DocsHeader eyebrow="Deploy with AI & CLI" title={TITLE}>
        <p>
          Open <TextLink href="/settings#api-tokens">Settings &gt; API tokens</TextLink>, choose <em>Deploy only</em> and
          an expiry, confirm your password, and create the token. An API token lets the Claude Desktop extension, CI or a
          script deploy as you, without your password.
        </p>
      </DocsHeader>

      <Steps steps={STEPS} />

      <QA question="What is the difference between Deploy only and Full access?">
        <p>A <strong className="text-foreground">Deploy only</strong> token can do exactly this, and nothing else:</p>
        <ul className="list-disc pl-5 space-y-1">
          {DEPLOY_ONLY.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p>
          A <strong className="text-foreground">Full access</strong> token can also create projects from a git
          repository, manage environment variables, project settings, custom domains and deletes, which{' '}
          <Code>entrify deploy --create</Code> and <Code>entrify env</Code> need. It creates projects with your linked
          GitHub or GitLab account, so whoever holds it can deploy any repository you can read: keep it for CI you trust.
        </p>
        <p>
          No token can sign in to the dashboard, manage your account or other tokens, use admin pages, connect GitHub or
          GitLab, or open a project&apos;s terminal. Those need you signed in.
        </p>
      </QA>

      <QA question="How do I use a token?">
        <p>
          <strong className="text-foreground">Claude Desktop:</strong> paste it when you install the extension, or later by
          clicking Entrify in Claude Desktop&apos;s extension settings. See <TextLink href="/docs/claude-desktop">Claude Desktop</TextLink>.
        </p>
        <p>
          <strong className="text-foreground">CI and scripts:</strong> store it as a secret named <Code>ENTRIFY_TOKEN</Code>.
          The CLI reads it, and the API takes it as <Code>Authorization: Bearer ent_…</Code>.
        </p>
        <Pre>{`export ENTRIFY_TOKEN=ent_...
entrify deploy --project-id my-app --json`}</Pre>
      </QA>

      <QA question="Do tokens expire, and how do I revoke one?">
        <p>
          A token stops working on the expiry date you chose. To stop it sooner, click <em>Revoke</em> next to it in
          Settings; it stops working immediately. Changing or resetting your password revokes all of your tokens, and so
          does a suspension or an admin signing you out everywhere. Settings also shows when each token was last used, so
          you can spot ones you no longer need. You can have up to 20 active tokens.
        </p>
      </QA>

      <Note>
        <p>
          Treat a token like a password: never share it, paste it into a chat or commit it to a repository. If one leaks,
          revoke it and create a new one.
        </p>
      </Note>

      <DocsNext href="/docs/faq" label="FAQ" />
    </div>
  );
}
