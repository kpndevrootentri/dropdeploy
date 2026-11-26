import type { Metadata } from 'next';
import '@/app/globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { SITE_URL, jsonLdScriptProps } from '@/lib/json-ld';

export const metadata: Metadata = {
  // Without it Next builds the og:image URL on localhost, which link previews can't fetch
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Entrify — Deploy websites, apps and HTML pages in seconds',
    template: '%s · Entrify',
  },
  description:
    'Deploy static sites, Node.js, Next.js and Django apps, or one HTML page, from GitHub, the CLI, Claude Code or Claude Desktop, and get a live URL in seconds.',
  applicationName: 'Entrify',
  // No title or description here: Next fills them from each page's own, and the image from opengraph-image.png.
  openGraph: { type: 'website', siteName: 'Entrify' },
  twitter: { card: 'summary_large_image' },
};

const SITE_JSON_LD = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Entrify',
    url: SITE_URL,
    logo: `${SITE_URL}/apple-icon.png`,
    sameAs: ['https://github.com/kpndevrootentri/entrify-cli', 'https://www.npmjs.com/package/entrify-deploy'],
  },
  { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Entrify', url: SITE_URL },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script {...jsonLdScriptProps(SITE_JSON_LD)} />
        <ThemeProvider>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
