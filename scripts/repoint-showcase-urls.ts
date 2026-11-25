/**
 * Moves Explore "Live URL"s from an old base domain to the current BASE_DOMAIN.
 *
 * Run once after BASE_DOMAIN changes (a domain move). The publish panel saves the
 * project's platform URL as plain text, so showcases published before the move
 * keep linking to `<slug>.<old domain>` after it stops resolving. Only hosts under
 * the old domain change; custom URLs are left alone. Safe to re-run.
 *
 * Usage (on the server, with the production .env in place):
 *   npx tsx scripts/repoint-showcase-urls.ts app.en3.wtf
 */

export {}; // A module, so its main() does not clash with other scripts' in the type-check.

// Like dotenv: read .env if present, never overriding variables already set.
try {
  process.loadEnvFile();
} catch {
  // No .env; rely on the environment.
}

async function main(): Promise<void> {
  const oldDomain = process.argv[2]?.toLowerCase();
  if (!oldDomain) {
    console.error('Usage: npx tsx scripts/repoint-showcase-urls.ts <old-base-domain>');
    process.exit(1);
  }

  // Imported only after .env is loaded: these modules read config.
  const { prisma } = await import('@/lib/prisma');
  const { getConfig } = await import('@/lib/config');

  const newDomain = getConfig().BASE_DOMAIN;
  const rows = await prisma.projectShowcase.findMany({
    where: { liveUrl: { contains: oldDomain, mode: 'insensitive' } },
    select: { id: true, liveUrl: true },
  });

  let moved = 0;
  for (const row of rows) {
    const saved = row.liveUrl!;
    if (!URL.canParse(saved)) continue;
    const url = new URL(saved);
    if (!url.hostname.endsWith(`.${oldDomain}`)) continue; // e.g. the old domain only in a path
    url.hostname = url.hostname.slice(0, -oldDomain.length) + newDomain;
    // URL adds "/" to a bare origin; keep the form that was saved.
    const liveUrl = saved.endsWith('/') ? url.toString() : url.toString().replace(/\/$/, '');
    await prisma.projectShowcase.update({ where: { id: row.id }, data: { liveUrl } });
    console.log(`  ${saved} -> ${liveUrl}`);
    moved++;
  }

  console.log(`${moved} showcase URL(s) moved from ${oldDomain} to ${newDomain}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
