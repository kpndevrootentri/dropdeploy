import sitemap from '@/app/sitemap';
import { faqPageJsonLd, jsonLdScriptProps } from '@/lib/json-ld';
import { FAQ, LANDING_FAQ_COUNT } from '@/components/docs/faq-data';

jest.mock('@/lib/prisma', () => ({
  prisma: { projectShowcase: { findMany: jest.fn().mockResolvedValue([{ project: { slug: 'demo' }, updatedAt: new Date(0) }]) } },
}));

describe('sitemap', () => {
  it('lists every docs page, every framework page and the showcases', async () => {
    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);
    for (const path of [
      '/docs/deploy-html',
      '/docs/claude-desktop',
      '/docs/claude-code',
      '/docs/cli',
      '/docs/api-tokens',
      '/docs/faq',
      '/docs/getting-started',
      '/docs/frameworks/static',
      '/docs/frameworks/wordpress',
      '/explore/demo',
    ]) {
      expect(paths).toContain(path);
    }
    expect(paths).not.toContain('/docs'); // a redirect, not a page
  });
});

describe('jsonLdScriptProps', () => {
  it('escapes "<" so a value cannot close the script tag', () => {
    const { type, dangerouslySetInnerHTML } = jsonLdScriptProps({ name: '</script><script>alert(1)</script>' });
    expect(type).toBe('application/ld+json');
    expect(dangerouslySetInnerHTML.__html).not.toContain('<');
    expect(JSON.parse(dangerouslySetInnerHTML.__html)).toEqual({ name: '</script><script>alert(1)</script>' });
  });
});

describe('FAQ JSON-LD', () => {
  it('has one Question per FAQ item, with the same text the page shows', () => {
    for (const items of [FAQ, FAQ.slice(0, LANDING_FAQ_COUNT)]) {
      const { mainEntity } = faqPageJsonLd(items) as { mainEntity: { '@type': string; name: string; acceptedAnswer: { text: string } }[] };
      expect(mainEntity).toHaveLength(items.length);
      mainEntity.forEach((q, i) => {
        expect(q['@type']).toBe('Question');
        expect(q.name).toBe(items[i].question);
        expect(q.acceptedAnswer.text).toBe(items[i].answer);
      });
    }
  });

  it('has unique questions', () => {
    expect(new Set(FAQ.map((f) => f.question)).size).toBe(FAQ.length);
  });
});
