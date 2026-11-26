import type { Metadata } from 'next';
import { docsBreadcrumbJsonLd, faqPageJsonLd, jsonLdScriptProps } from '@/lib/json-ld';
import { FAQ } from '@/components/docs/faq-data';
import { DocsHeader, QA, TextLink } from '@/components/docs/docs-ui';

const PATH = '/docs/faq';

export const metadata: Metadata = {
  title: 'FAQ — Entrify Docs',
  description:
    'Answers about Entrify: publishing HTML pages from Claude, Claude Desktop, pricing, frameworks, updating a site, custom domains, upload limits, API tokens and CI.',
  alternates: { canonical: PATH },
};

export default function FaqPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <script {...jsonLdScriptProps([docsBreadcrumbJsonLd('FAQ', PATH), faqPageJsonLd(FAQ)])} />

      <DocsHeader eyebrow="Deploy with AI & CLI" title="Entrify FAQ">
        <p>
          Entrify deploys static sites, apps and single HTML pages to their own URL, from the dashboard, the CLI, Claude
          Code or Claude Desktop. These are the questions people ask most.
        </p>
      </DocsHeader>

      {FAQ.map((item) => (
        <QA key={item.question} question={item.question}>
          <p>{item.answer}</p>
        </QA>
      ))}

      <p className="text-sm text-muted-foreground">
        Not answered here? Start with <TextLink href="/docs/deploy-html">Publish an HTML page</TextLink> or{' '}
        <TextLink href="/docs/getting-started">Project Creation</TextLink>.
      </p>
    </div>
  );
}
