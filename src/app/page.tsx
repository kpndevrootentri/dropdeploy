import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/landing-page';
import { FAQ, LANDING_FAQ_COUNT } from '@/components/docs/faq-data';
import { SITE_URL, faqPageJsonLd, jsonLdScriptProps } from '@/lib/json-ld';

// Title, description and social cards come from the root layout's defaults.
export const metadata: Metadata = {
  keywords: ['deployment', 'hosting', 'static site', 'HTML', 'docker', 'GitHub', 'GitLab', 'CLI', 'Claude Code', 'Claude Desktop', 'MCP'],
  // Here rather than in the root layout, where every page would inherit it and point at the home page.
  alternates: { canonical: '/' },
};

const JSON_LD = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Entrify',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web, macOS, Windows, Linux',
    url: SITE_URL,
    description:
      'Entrify deploys static sites, apps and single HTML pages to their own URL, from the dashboard, the entrify CLI, Claude Code or Claude Desktop.',
    // Free: the app has no plans or billing, only per-account project and domain quotas.
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  },
  faqPageJsonLd(FAQ.slice(0, LANDING_FAQ_COUNT)),
];

export default function HomePage(): React.ReactElement {
  return (
    <>
      <script {...jsonLdScriptProps(JSON_LD)} />
      <LandingPage />
    </>
  );
}
