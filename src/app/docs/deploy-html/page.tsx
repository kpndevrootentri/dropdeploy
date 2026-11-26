import type { Metadata } from 'next';
import { docsBreadcrumbJsonLd, howToJsonLd, jsonLdScriptProps } from '@/lib/json-ld';
import { Code, DocsHeader, DocsNext, Pre, QA, Steps, TextLink, stepsForJsonLd, type DocStep } from '@/components/docs/docs-ui';

const PATH = '/docs/deploy-html';
const TITLE = 'How do I publish an HTML page?';

export const metadata: Metadata = {
  title: 'Publish an HTML page — Entrify Docs',
  description:
    'Publish an HTML file, folder or .zip on Entrify and get a live URL in seconds: drag it onto the dashboard, run entrify upload, or ask Claude Desktop or Claude Code.',
  alternates: { canonical: PATH },
};

const STEPS: DocStep[] = [
  {
    name: 'Sign in to Entrify',
    text: 'Log in and open your dashboard.',
  },
  {
    name: 'Drag the page onto the dashboard',
    text: 'Drop an .html file, a folder with index.html at its top, or a .zip with index.html at its root anywhere on the dashboard. Or click Browse files to choose an .html or .zip file.',
  },
  {
    name: 'Name the site and click Publish',
    text: 'Use 3 to 50 letters, numbers, spaces, hyphens or underscores. The name becomes the site address, such as my-portfolio.entrify.site.',
  },
  {
    name: 'Share the URL',
    text: 'The site is live as soon as the upload finishes. Copy its URL from the project page.',
  },
];

export default function DeployHtmlPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <script {...jsonLdScriptProps([docsBreadcrumbJsonLd('Publish an HTML page', PATH), howToJsonLd(TITLE, stepsForJsonLd(STEPS))])} />

      <DocsHeader eyebrow="Deploy with AI & CLI" title={TITLE}>
        <p>
          Drag the <Code>.html</Code> file onto your Entrify dashboard and it is live at its own URL in seconds.
          You can also run <Code>entrify upload page.html</Code>, or ask Claude Desktop or Claude Code to deploy it.
        </p>
      </DocsHeader>

      <Steps steps={STEPS} />

      <QA question="How do I publish from the terminal?">
        <p>
          Install the CLI once, log in, and upload a file, a folder or a <Code>.zip</Code>. The name defaults to the file
          or folder name. See the <TextLink href="/docs/cli">CLI reference</TextLink> for every flag.
        </p>
        <Pre>{`npm install -g entrify-deploy
entrify auth login
entrify upload page.html
entrify upload ./site --name "My Site"
entrify upload ./site --dry-run        # list the files, upload nothing`}</Pre>
      </QA>

      <QA question="How do I publish from Claude Desktop?">
        <p>
          Add the Entrify extension, paste an API token, then ask Claude to <em>deploy this page to Entrify</em>.
          Claude sends the page and replies with the URL. Setup takes about a minute:
          see <TextLink href="/docs/claude-desktop">Claude Desktop</TextLink>.
        </p>
      </QA>

      <QA question="How do I publish from Claude Code?">
        <p>
          Install the plugin with <Code>/plugin install entrify --marketplace kpndevrootentri/entrify-cli</Code>, then
          say <em>deploy this page to Entrify</em>. Claude runs <Code>entrify upload</Code> for you.
          See <TextLink href="/docs/claude-code">Claude Code</TextLink>.
        </p>
      </QA>

      <QA question="What are the limits?">
        <ul className="list-disc pl-5 space-y-1">
          <li>Up to 50 MB and 500 files per upload; a <Code>.zip</Code> can unpack to at most 100 MB.</li>
          <li>A folder or <Code>.zip</Code> needs <Code>index.html</Code> at its top level; a single <Code>.html</Code> file can have any name.</li>
          <li>
            Only web file types are published: <Code>.html .htm .css .js .mjs .cjs .json .svg .ico .png .jpg .jpeg .gif
            .webp .avif .woff .woff2 .ttf .eot .xml .txt .map .webmanifest</Code>. Other files in a folder or{' '}
            <Code>.zip</Code> are skipped, so links to them will not work; Claude Desktop refuses them instead.
          </li>
          <li>
            The CLI skips dotfiles (such as <Code>.env</Code>), <Code>node_modules</Code> and symlinks, and refuses a
            folder with <Code>package.json</Code> at its top: that is source code, so build it and upload the output
            folder (such as <Code>dist/</Code>) instead.
          </li>
          <li>A new site uses one project from your quota (5 by default).</li>
        </ul>
      </QA>

      <QA question="How do I update a site without changing its URL?">
        <p>
          Upload a new version to the same site. On the dashboard, drop the new file and choose <em>Replace</em> with the
          site&apos;s name. In the terminal, pass the site&apos;s slug:
        </p>
        <Pre>{'entrify upload ./site --project-id my-site'}</Pre>
        <p>
          Earlier uploads are kept, so you can roll back from the project page. A site that already has a name is never
          overwritten unless you choose it: the CLI stops with <Code>NAME_TAKEN</Code>, and Claude asks you whether to
          update that site or use another name.
        </p>
      </QA>

      <DocsNext href="/docs/claude-desktop" label="Claude Desktop" />
    </div>
  );
}
