import type { Metadata } from 'next';
import { docsBreadcrumbJsonLd, howToJsonLd, jsonLdScriptProps } from '@/lib/json-ld';
import { Code, DocsHeader, DocsNext, Pre, QA, Steps, TextLink, stepsForJsonLd, type DocStep } from '@/components/docs/docs-ui';

const PATH = '/docs/claude-code';
const TITLE = 'How do I deploy from Claude Code?';

export const metadata: Metadata = {
  title: 'Deploy from Claude Code — Entrify Docs',
  description:
    'Install the Entrify plugin in Claude Code and say "deploy this". Claude deploys your repository or HTML page to Entrify, and fixes and redeploys a failed build.',
  alternates: { canonical: PATH },
};

const STEPS: DocStep[] = [
  {
    name: 'Install the plugin',
    text: 'Run this in Claude Code. On Claude Code older than 2.1.275, run /plugin marketplace add kpndevrootentri/entrify-cli, then /plugin install entrify@entrify.',
    command: '/plugin install entrify --marketplace kpndevrootentri/entrify-cli',
  },
  {
    name: 'Ask Claude to deploy',
    text: 'Say "deploy this" in a repository, or "deploy this page to Entrify" for an HTML file. You can also type /entrify:deploy. Claude installs the entrify CLI if it is missing.',
  },
  {
    name: 'Log in once',
    text: 'If you are not logged in, Claude asks you to run this in the session. The ! runs it in this session and hides the password as you type; Claude never asks for it in the chat.',
    command: '! entrify auth login',
  },
  {
    name: 'Get the live URL',
    text: 'Claude deploys, checks that the site answers, and replies with its URL.',
  },
];

export default function ClaudeCodePage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <script {...jsonLdScriptProps([docsBreadcrumbJsonLd('Claude Code', PATH), howToJsonLd(TITLE, stepsForJsonLd(STEPS))])} />

      <DocsHeader eyebrow="Deploy with AI & CLI" title={TITLE}>
        <p>
          Install the Entrify plugin and say &ldquo;deploy this&rdquo;. Claude deploys your repository, or uploads an HTML
          page, with the <Code>entrify</Code> CLI and replies with the live URL.
        </p>
      </DocsHeader>

      <Steps steps={STEPS} />

      <QA question="How does Claude deploy a repository?">
        <p>
          Entrify builds from your git remote, so Claude first checks for uncommitted or unpushed changes and asks before
          it commits or pushes anything. It then runs <Code>entrify deploy --json</Code>. If no Entrify project matches
          the repository, it asks whether to create one.
        </p>
      </QA>

      <QA question="How does Claude publish an HTML page?">
        <p>
          It puts the page in one <Code>.html</Code> file, or in a folder with <Code>index.html</Code> at the top, and runs
          {' '}<Code>entrify upload</Code>. No git is needed. If you already have a site with that name, Claude asks whether
          to update it or use another name. For a folder it did not make, it shows you the file list first. See{' '}
          <TextLink href="/docs/deploy-html">Publish an HTML page</TextLink> for the limits.
        </p>
      </QA>

      <QA question="What does Claude do when a deploy fails?">
        <p>It reads the cause and the build log, then fixes what it can and deploys again, at most 3 times:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Code or config</strong> (a missing dependency, a build error, an app
            listening on 127.0.0.1): it fixes the repository, shows you the change and pushes with your OK.
          </li>
          <li>
            <strong className="text-foreground">Missing settings</strong>: it checks which environment variables are set
            and asks you for the missing values. It never prints secrets or commits them.
          </li>
          <li>
            <strong className="text-foreground">A server problem</strong> (such as no disk space): it stops and tells you
            it is not your code.
          </li>
        </ul>
        <p>After 3 failed attempts it stops and sums up what it tried. It asks before rolling back.</p>
      </QA>

      <QA question="Can I use it without the plugin system?">
        <p>Yes. Save the skill as a command, then type <Code>/deploy</Code>:</p>
        <Pre>{'curl -o ~/.claude/commands/deploy.md https://entrify.site/deploy.md'}</Pre>
      </QA>

      <DocsNext href="/docs/cli" label="CLI reference" />
    </div>
  );
}
