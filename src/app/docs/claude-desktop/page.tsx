import type { Metadata } from 'next';
import { Download, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { docsBreadcrumbJsonLd, howToJsonLd, jsonLdScriptProps } from '@/lib/json-ld';
import { Code, DocsHeader, DocsNext, Note, Pre, QA, Steps, TextLink, stepsForJsonLd, type DocStep } from '@/components/docs/docs-ui';

const PATH = '/docs/claude-desktop';
const TITLE = 'How do I deploy from Claude Desktop?';

export const metadata: Metadata = {
  title: 'Deploy from Claude Desktop — Entrify Docs',
  description:
    'Install the Entrify extension in Claude Desktop, paste an API token, and ask Claude to "deploy this page to Entrify". Claude publishes the page and replies with its live URL.',
  alternates: { canonical: PATH },
};

const STEPS: DocStep[] = [
  {
    name: 'Download the Entrify extension',
    text: 'Download entrify.mcpb. Claude Desktop runs it with its own Node.js, so there is nothing else to install and no terminal to open.',
    action: (
      <Button size="sm" className="gap-2" asChild>
        <a href="/downloads/entrify.mcpb" download>
          <Download className="h-4 w-4" aria-hidden="true" />
          Download entrify.mcpb
        </a>
      </Button>
    ),
  },
  {
    name: 'Install it in Claude Desktop',
    text: 'Double-click the file and click Install. If no install window opens, go to Claude Desktop\'s extension settings (Settings > Extensions, or on newer versions Settings > Desktop app, then Manage next to Extensions), open Advanced settings, click Install Extension… and choose the file.',
  },
  {
    name: 'Create a Deploy only API token',
    text: 'Sign in to Entrify, open Settings > API tokens, choose Deploy only, confirm your password and create a token. Copy it: it starts with ent_ and is shown only once.',
    action: (
      <Button size="sm" variant="outline" className="gap-2" asChild>
        {/* A plain <a>, not next/link: a full load keeps #api-tokens through the login redirect. */}
        <a href="/settings#api-tokens">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          Create an API token
        </a>
      </Button>
    ),
  },
  {
    name: 'Paste the token',
    text: 'Claude Desktop asks for the token when you install the extension. To change it later, click Entrify in the same extension settings.',
  },
  {
    name: 'Ask Claude to deploy',
    text: 'Say "make a one-page site for my bakery and deploy it to Entrify", or "deploy this page to Entrify" after Claude has made one. Claude replies with the live URL.',
  },
];

export default function ClaudeDesktopPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <script {...jsonLdScriptProps([docsBreadcrumbJsonLd('Claude Desktop', PATH), howToJsonLd(TITLE, stepsForJsonLd(STEPS))])} />

      <DocsHeader eyebrow="Deploy with AI & CLI" title={TITLE}>
        <p>
          Install the Entrify extension in Claude Desktop, paste an Entrify API token, and ask Claude to
          &ldquo;deploy this page to Entrify&rdquo;. Claude publishes the page and replies with its live URL.
        </p>
      </DocsHeader>

      <Steps steps={STEPS} />

      <QA question="What can Claude do with the extension?">
        <p>The extension gives Claude two tools:</p>
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th scope="col" className="text-left px-4 py-2.5 font-medium text-foreground">Tool</th>
                <th scope="col" className="text-left px-4 py-2.5 font-medium text-foreground">What it does</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-foreground whitespace-nowrap align-top">deploy_to_entrify</td>
                <td className="px-4 py-3 leading-relaxed">
                  Publishes a page as a static site and returns its URL. Claude sends a site <Code>name</Code>, the
                  page in <Code>html</Code>, optional text <Code>files</Code> such as <Code>style.css</Code>, and a
                  {' '}<Code>project_id</Code> only when it updates a site you already have.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-foreground whitespace-nowrap align-top">list_my_sites</td>
                <td className="px-4 py-3 leading-relaxed">
                  Lists your sites with their URLs, and how many new sites you can still create. It changes nothing.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Images in the page should be <Code>https://</Code> URLs or <Code>data:</Code> URIs. For a folder of files on
          your computer, use <TextLink href="/docs/deploy-html">the dashboard or the CLI</TextLink>.
        </p>
      </QA>

      <QA question="Is it safe? Can Claude read my files or replace my sites?">
        <ul className="list-disc pl-5 space-y-1">
          <li>The extension cannot read files on your computer. It publishes only the page Claude writes into the tool call.</li>
          <li>
            It never replaces a site on its own. If the name is taken, the tool refuses and Claude asks whether to update
            that site or use another name.
          </li>
          <li>
            A <TextLink href="/docs/api-tokens">Deploy only token</TextLink> can upload and deploy sites, but
            cannot read environment variables, change settings or delete anything. Revoke it in Settings at any time.
          </li>
        </ul>
      </QA>

      <QA question="What if it doesn't work?">
        <dl className="space-y-3">
          <div>
            <dt className="font-medium text-foreground">&ldquo;Entrify needs an API token&rdquo; or &ldquo;not valid or has expired&rdquo;</dt>
            <dd>
              The token is missing, expired or revoked. <TextLink href="/settings#api-tokens">Create a new one</TextLink> and
              paste it into Entrify in Claude Desktop&apos;s extension settings.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">&ldquo;A site named &hellip; already exists&rdquo;</dt>
            <dd>
              You already have a site with that name. Tell Claude whether to update it or to pick another name.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">&ldquo;File &hellip; would not be published&rdquo;</dt>
            <dd>
              The tool takes only web text files (HTML, CSS, JS, JSON, SVG, XML, TXT) and publishes nothing if one file
              is another type. Ask Claude to put that content in the page, or to link images by <Code>https://</Code> URL
              or <Code>data:</Code> URI, then deploy again.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">The project limit is reached</dt>
            <dd>
              Every new site uses one project from your quota. Delete a site you no longer need, update an existing one,
              or ask an admin for a higher limit.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Claude has no Entrify tool</dt>
            <dd>Check that Entrify is turned on in Claude Desktop&apos;s extension settings, then start a new chat.</dd>
          </div>
        </dl>
      </QA>

      <section className="space-y-3">
        <details className="group rounded-xl border border-border bg-card px-5">
          <summary className="cursor-pointer py-4 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-md">
            Advanced: add the server to claude_desktop_config.json by hand
          </summary>
          <div className="pb-5 space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              Only for setups that cannot use the extension. Install the CLI with{' '}
              <Code>npm install -g entrify-deploy</Code>, find the full paths with <Code>which node</Code> and{' '}
              <Code>which entrify</Code>, then add this in Settings &gt; Developer &gt; Edit Config and restart Claude Desktop:
            </p>
            <Pre>{`{
  "mcpServers": {
    "entrify": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/opt/homebrew/bin/entrify", "mcp"],
      "env": { "ENTRIFY_TOKEN": "ent_..." }
    }
  }
}`}</Pre>
            <p>
              Paths under <Code>~/.nvm</Code> change when you update Node.js, which breaks this config. The extension
              does not have that problem.
            </p>
          </div>
        </details>
      </section>

      <Note>
        <p>
          Using Claude Code instead? See <TextLink href="/docs/claude-code">Claude Code</TextLink>.
        </p>
      </Note>

      <DocsNext href="/docs/claude-code" label="Claude Code" />
    </div>
  );
}
