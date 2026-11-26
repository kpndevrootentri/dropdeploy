import type { Metadata } from 'next';
import { docsBreadcrumbJsonLd, howToJsonLd, jsonLdScriptProps } from '@/lib/json-ld';
import { Code, DocsHeader, DocsNext, Pre, QA, Steps, TextLink, stepsForJsonLd, type DocStep } from '@/components/docs/docs-ui';

const PATH = '/docs/cli';
const TITLE = 'How do I deploy from the terminal?';

export const metadata: Metadata = {
  title: 'CLI reference — Entrify Docs',
  description:
    'Install the entrify CLI with npm install -g entrify-deploy, log in, and run entrify deploy or entrify upload. Every command, flag, --json output, exit code and environment variable.',
  alternates: { canonical: PATH },
};

const STEPS: DocStep[] = [
  {
    name: 'Install the CLI',
    text: 'It needs Node.js 18 or later and installs the entrify command.',
    command: 'npm install -g entrify-deploy',
  },
  {
    name: 'Log in',
    text: 'Enter your email and password. The password is always typed in, never passed as a flag. A login lasts 7 days; in CI, set ENTRIFY_TOKEN to an API token instead.',
    command: 'entrify auth login',
  },
  {
    name: 'Deploy a repository',
    text: 'Run it in the repository. Entrify builds what is pushed to the git remote; --create makes a project for a new repository.',
    command: 'entrify deploy',
  },
  {
    name: 'Or publish an HTML page',
    text: 'Upload an .html file, a folder with index.html at its top, or a .zip. No git is needed.',
    command: 'entrify upload ./site',
  },
];

const COMMANDS: { command: string; flags: string; does: string }[] = [
  { command: 'deploy', flags: '--project-id <id|slug>, --create, --dir <path>', does: 'Deploy the current repository (the default command). Matches the project by its git remote.' },
  { command: 'upload <file|folder|zip>', flags: '--name <name>, --project-id <id|slug>, --dry-run', does: 'Publish files as a static site. --project-id uploads a new version of a site; --dry-run lists the files and checks the name without uploading.' },
  { command: 'status', flags: '--project-id', does: 'The latest deployment and the live URL.' },
  { command: 'logs', flags: '--deployment <id>, --lines <n|all>, --follow', does: 'The build log of the latest deployment (last 200 lines by default).' },
  { command: 'env list | set KEY=VALUE … | push [file] | unset KEY …', flags: '--project-id', does: 'Environment variables. Values are stored encrypted and never printed. Changes apply on the next deploy.' },
  { command: 'rollback', flags: '--to <deployment-id>', does: 'Go back to the previous successful deployment.' },
  { command: 'cancel', flags: '--project-id', does: 'Cancel the deployment that is queued or building.' },
  { command: 'projects', flags: '', does: 'List your projects and their status.' },
  { command: 'auth login', flags: '--email <email>, --api-url <url>', does: 'Log in. The password is always prompted.' },
  { command: 'auth status', flags: '', does: 'Show the account you are logged in as.' },
  { command: 'auth token', flags: '', does: 'Print the saved login token (expires after 7 days).' },
  { command: 'auth logout', flags: '', does: 'Clear the saved login.' },
  { command: 'mcp', flags: '', does: 'Run the MCP server that Claude Desktop starts. Use the extension instead of running it yourself.' },
  { command: 'help, --version', flags: '', does: 'Print the command reference or the installed version.' },
];

const EXIT_CODES: [string, string][] = [
  ['0', 'Success'],
  ['1', 'The operation failed, for example the build failed'],
  ['2', 'Needs input: a flag, a project or a file'],
  ['3', 'Not logged in, or the login or token expired'],
];

export default function CliPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <script {...jsonLdScriptProps([docsBreadcrumbJsonLd('CLI reference', PATH), howToJsonLd(TITLE, stepsForJsonLd(STEPS))])} />

      <DocsHeader eyebrow="Deploy with AI & CLI" title={TITLE}>
        <p>
          Install the CLI with <Code>npm install -g entrify-deploy</Code>, log in with <Code>entrify auth login</Code>,
          and run <Code>entrify deploy</Code> in a repository or <Code>entrify upload</Code> for an HTML page.
        </p>
      </DocsHeader>

      <Steps steps={STEPS} />

      <QA question="What commands are there?">
        <p>
          Project commands act on the project matched from the current repository; pass <Code>--project-id</Code> to
          choose another. Every command also takes <Code>--json</Code>.
        </p>
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th scope="col" className="text-left px-4 py-2.5 font-medium text-foreground">Command</th>
                <th scope="col" className="text-left px-4 py-2.5 font-medium text-foreground">Flags</th>
                <th scope="col" className="text-left px-4 py-2.5 font-medium text-foreground">What it does</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {COMMANDS.map((row) => (
                <tr key={row.command}>
                  <td className="px-4 py-3 font-mono text-xs text-foreground align-top min-w-40">entrify {row.command}</td>
                  <td className="px-4 py-3 font-mono text-xs align-top min-w-40">{row.flags}</td>
                  <td className="px-4 py-3 text-xs leading-relaxed align-top min-w-56">{row.does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QA>

      <QA question="How do I use it in scripts, CI or AI agents?">
        <p>
          Add <Code>--json</Code> to any command for exactly one JSON object on stdout:{' '}
          <Code>{'{ "ok": true, ... }'}</Code> or <Code>{'{ "ok": false, "error": { "code", "message" } }'}</Code>. A failed
          deploy also includes <Code>cause</Code>, <Code>fix</Code> and the last 40 lines of the log. Commands never
          prompt without a terminal or with <Code>--json</Code>.
        </p>
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Exit codes</caption>
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th scope="col" className="text-left px-4 py-2.5 font-medium text-foreground">Exit code</th>
                <th scope="col" className="text-left px-4 py-2.5 font-medium text-foreground">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {EXIT_CODES.map(([code, meaning]) => (
                <tr key={code}>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{code}</td>
                  <td className="px-4 py-3 text-xs">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QA>

      <QA question="Which environment variables does it read?">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <Code>ENTRIFY_TOKEN</Code>: skips <Code>auth login</Code>. Use an{' '}
            <TextLink href="/docs/api-tokens">API token</TextLink> (<Code>ent_…</Code>); the output of{' '}
            <Code>entrify auth token</Code> also works but expires after 7 days. <Code>env</Code> commands need a Full
            access token.
          </li>
          <li><Code>ENTRIFY_URL</Code>: the Entrify URL, <Code>https://entrify.site</Code> by default.</li>
          <li>The older <Code>DROPDEPLOY_TOKEN</Code> and <Code>DROPDEPLOY_URL</Code> names still work.</li>
        </ul>
        <Pre>{`export ENTRIFY_TOKEN=ent_...
entrify deploy --project-id my-app --json`}</Pre>
      </QA>

      <QA question="Where is the source?">
        <p>
          The CLI is open source (MIT) at{' '}
          <a href="https://github.com/kpndevrootentri/entrify-cli" className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer">
            github.com/kpndevrootentri/entrify-cli
          </a>{' '}
          and published on npm as{' '}
          <a href="https://www.npmjs.com/package/entrify-deploy" className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer">
            entrify-deploy
          </a>
          . It was called <Code>dropdeploy-cli</Code>; the <Code>dropdeploy</Code> command still works.
        </p>
      </QA>

      <DocsNext href="/docs/api-tokens" label="API tokens" />
    </div>
  );
}
