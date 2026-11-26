import { SITE_URL } from '@/lib/json-ld';

export interface FaqItem {
  question: string;
  /** Plain text: it is also the FAQPage JSON-LD answer. */
  answer: string;
}

/** Rendered on /docs/faq; the landing page shows the first LANDING_FAQ_COUNT. Every answer must stay true to the code. */
export const FAQ: readonly FaqItem[] = [
  {
    question: 'How do I publish an HTML page that Claude made?',
    answer:
      'Ask Claude to deploy it. In Claude Desktop, add the Entrify extension and say "deploy this page to Entrify". In Claude Code, install the Entrify plugin and say the same. Claude replies with the live URL. You can also save the page and run entrify upload page.html, or drag the file onto your Entrify dashboard.',
  },
  {
    question: 'Can Claude Desktop deploy to Entrify?',
    answer: `Yes. Download the Entrify extension from ${SITE_URL}/downloads/entrify.mcpb, open it to install it in Claude Desktop, and paste an Entrify API token. Claude then has two tools: deploy_to_entrify publishes a page and returns its URL, and list_my_sites lists the sites you already have. Claude asks before it replaces an existing site.`,
  },
  {
    question: 'Is Entrify free?',
    answer:
      'Yes. Entrify has no paid plans and no billing. An account can have 5 projects and 1 custom domain by default, and an admin can raise those limits.',
  },
  {
    question: 'Which frameworks does Entrify support?',
    answer:
      'Static HTML, Node.js, Next.js, React, Vue and Svelte (built with Vite), Django, FastAPI, Flask, Go, Rust, Java with Spring Boot, and WordPress. Entrify detects the framework from your repository and builds it for you.',
  },
  {
    question: 'How do I update a site without changing its URL?',
    answer:
      'Deploy a new version to the same site; its URL stays the same. For an uploaded site, run entrify upload ./site --project-id <slug>, drop the new file on the dashboard and choose the site, or let Claude update it after it asks you. For a git project, push your changes and deploy again.',
  },
  {
    question: 'Can I use my own domain?',
    answer:
      'Yes. Open the project, add the domain under Custom domains, prove you own it with a TXT record, then point a CNAME record (for a subdomain) or an A record (for a root domain) at Entrify. HTTPS is set up and renewed automatically. Each account can add 1 custom domain by default.',
  },
  {
    question: 'Which file types does an upload publish?',
    answer:
      'Web files only: .html, .htm, .css, .js, .mjs, .cjs, .json, .svg, .ico, .png, .jpg, .jpeg, .gif, .webp, .avif, .woff, .woff2, .ttf, .eot, .xml, .txt, .map and .webmanifest. Other files in a folder or .zip are skipped and not published, so links to them will not work.',
  },
  {
    question: 'What is the upload size limit?',
    answer:
      'An upload can be up to 50 MB and 500 files, and a .zip can unpack to at most 100 MB. A folder or .zip needs index.html at its top level; a single .html file can have any name.',
  },
  {
    question: 'Why was my folder refused because it has a package.json?',
    answer:
      'A folder with package.json at its top is a project\'s source code, not a built site, so entrify upload refuses it rather than publish your config files. Build it and upload the output folder (such as dist/, out/ or build/), or push the code to GitHub or GitLab and deploy the repository with entrify deploy.',
  },
  {
    question: 'How do I get an API token?',
    answer: `Sign in and open Settings, API tokens (${SITE_URL}/settings#api-tokens). Choose Deploy only or Full access and an expiry, then create the token. Copy it right away: it starts with ent_ and is shown only once.`,
  },
  {
    question: 'Do API tokens expire?',
    answer:
      'You choose: after 30, 90 or 365 days, or never. The default is 90 days. You can revoke a token at any time in Settings, and it stops working immediately. Changing your password revokes all of them. A login made with entrify auth login lasts 7 days.',
  },
  {
    question: 'How do I deploy from CI?',
    answer:
      'Create an API token, save it as the ENTRIFY_TOKEN secret in your CI, install the CLI with npm install -g entrify-deploy, and run entrify deploy --project-id <slug> --json. The exit code is 0 on success, 1 when the deploy fails, 2 when input is missing and 3 when the token is missing or invalid.',
  },
  {
    question: 'Does Entrify deploy the changes on my computer?',
    answer:
      'A git project is built from its git remote, so only pushed commits are deployed: push first, then deploy. Uploads are different: the dashboard, entrify upload and Claude publish the files you give them, with no git needed.',
  },
];

export const LANDING_FAQ_COUNT = 8;
