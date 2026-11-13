/**
 * Re-registers every auto-deploy GitHub webhook against the current APP_URL.
 *
 * Run once after APP_URL changes (a domain move). GitHub does not follow
 * redirects on webhook deliveries, so hooks still aimed at the old host stop
 * deploying as soon as that host stops answering. Each project gets a fresh
 * hook and secret through the owner's GitHub token, exactly as re-enabling
 * auto-deploy in the dashboard would. Safe to re-run.
 *
 * Usage (on the server, with the production .env in place):
 *   npx tsx scripts/repoint-github-webhooks.ts
 */

export {}; // A module, so its main() does not clash with other scripts' in the type-check.

// Like dotenv: read .env if present, never overriding variables already set.
try {
  process.loadEnvFile();
} catch {
  // No .env; rely on the environment.
}

async function main(): Promise<void> {
  // Imported only after .env is loaded: these modules read config.
  const { prisma } = await import('@/lib/prisma');
  const { getConfig } = await import('@/lib/config');
  const { webhookService } = await import('@/services/webhook');

  const target = `${getConfig().APP_URL}/api/webhooks/github`;
  const projects = await prisma.project.findMany({
    where: { autoDeploy: true },
    select: { id: true, slug: true, userId: true },
    orderBy: { slug: 'asc' },
  });
  console.log(`Re-pointing ${projects.length} webhook(s) to ${target}`);

  let failed = 0;
  for (const project of projects) {
    try {
      await webhookService.enableAutoDeploy(project.id, project.userId);
      console.log(`  ok    ${project.slug}`);
    } catch (err) {
      // Usually the owner disconnected GitHub or lost admin on the repo; they
      // can re-enable auto-deploy themselves once that is fixed.
      failed++;
      console.error(`  FAIL  ${project.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`${projects.length - failed}/${projects.length} re-pointed`);
  await prisma.$disconnect();
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
