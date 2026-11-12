/**
 * Rebuilds every repository project from its latest commit, the same as the
 * admin panel's "Redeploy all", without logging in: it reads the database and
 * queue settings from the production .env.
 *
 * Without --yes it only lists what would be rebuilt and what is skipped, and why.
 * Deploys go through the normal queue, so the worker builds a few at a time.
 *
 * Usage (on the server, in the app directory):
 *   npx tsx scripts/redeploy-all.ts          # preview
 *   npx tsx scripts/redeploy-all.ts --yes    # queue the rebuilds
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
  const { adminService } = await import('@/services/admin');
  const confirmed = process.argv.includes('--yes');

  const plan = await adminService.redeployAll({}, true);
  for (const p of plan.skipped) console.log(`  skip  ${p.name}: ${p.reason}`);
  for (const p of plan.eligible) console.log(`  build ${p.name} (${p.ownerEmail})`);
  console.log(`${plan.eligible.length} to rebuild, ${plan.skipped.length} skipped, ${plan.concurrency} at a time`);
  if (!confirmed) {
    console.log('Preview only. Re-run with --yes to queue the rebuilds.');
    return;
  }

  // Only the projects just listed, so nothing that became eligible in between is rebuilt.
  const run = await adminService.redeployAll({ projectIds: plan.eligible.map((p) => p.id) }, false);
  const failed = (run.results ?? []).filter((r) => r.outcome === 'failed');
  for (const r of failed) console.error(`  FAIL  ${r.name}: ${r.error}`);
  console.log(`${(run.results ?? []).length - failed.length} queued. Follow the builds with: pm2 logs dropdeploy-worker`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  // The queue keeps a Redis connection open; every job is already written by now.
  .finally(() => process.exit());
