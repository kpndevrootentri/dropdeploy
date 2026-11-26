// The one site origin for metadata, JSON-LD, the sitemap and robots. Inlined at build time, like every
// NEXT_PUBLIC_ value. `||`, not `??`: an empty value would make `new URL(SITE_URL)` in the root layout throw.
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://entrify.site').replace(/\/$/, '');

/** Spread onto a <script>. "<" is escaped so a value such as "</script>" can never close the tag. */
export function jsonLdScriptProps(data: object): {
  type: 'application/ld+json';
  dangerouslySetInnerHTML: { __html: string };
} {
  return {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: { __html: JSON.stringify(data).replace(/</g, '\\u003c') },
  };
}

/** `faqPageJsonLd([{ question: 'Is it free?', answer: 'Yes.' }])` → a FAQPage with one Question and its acceptedAnswer. */
export function faqPageJsonLd(items: readonly { question: string; answer: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

/**
 * Entrify › Docs › title, for a page under /docs.
 * `docsBreadcrumbJsonLd('CLI reference', '/docs/cli')` → a BreadcrumbList ending at `${SITE_URL}/docs/cli`.
 */
export function docsBreadcrumbJsonLd(title: string, path: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Entrify', item: SITE_URL },
      // /docs only redirects here.
      { '@type': 'ListItem', position: 2, name: 'Docs', item: `${SITE_URL}/docs/getting-started` },
      { '@type': 'ListItem', position: 3, name: title, item: `${SITE_URL}${path}` },
    ],
  };
}

/** `howToJsonLd('Publish a page', [{ name: 'Upload', text: '…' }])` → a HowTo with HowToStep position 1. */
export function howToJsonLd(name: string, steps: readonly { name: string; text: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    step: steps.map((step, i) => ({ '@type': 'HowToStep', position: i + 1, name: step.name, text: step.text })),
  };
}
