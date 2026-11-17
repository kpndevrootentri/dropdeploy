/**
 * Invites USER accounts from the command line, the same as Admin → Users → Bulk import:
 * each person gets their own one-time link to choose a password, with the admin-set default
 * quotas, and the audit log records ADMIN_EMAIL as the admin who invited them.
 * Existing accounts are skipped, never changed.
 *
 * Usage (in the app directory):
 *   ADMIN_EMAIL=you@entri.me npx tsx scripts/create-users.ts a@entri.me b@entri.me ...
 */

export {}; // A module, so its main() does not clash with other scripts' in the type-check.

// Like dotenv: read .env if present, never overriding variables already set.
try {
  process.loadEnvFile();
} catch {
  // No .env; rely on the environment.
}

async function main(): Promise<void> {
  const emails = process.argv.slice(2);
  const adminEmail = process.env.ADMIN_EMAIL;
  if (emails.length === 0 || !adminEmail) {
    console.error('Usage: ADMIN_EMAIL=<admin email> npx tsx scripts/create-users.ts <email> [email ...]');
    process.exitCode = 1;
    return;
  }

  // Imported only after .env is loaded: these modules read config.
  const { adminService } = await import('@/services/admin');
  const { invitePath } = await import('@/services/invite');
  const { userRepository } = await import('@/repositories/user.repository');

  const admin = await userRepository.findByEmail(adminEmail);
  if (admin?.role !== 'CONTRIBUTOR') throw new Error(`${adminEmail} is not an admin account`);

  const { created, skipped, invalid } = await adminService.bulkInviteUsers(emails, admin.id);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  for (const { email, inviteToken } of created) console.log(`✓ ${email}  ${appUrl}${invitePath(inviteToken)}`);
  for (const email of skipped) console.log(`- ${email} already exists, skipped`);
  for (const email of invalid) console.error(`✗ ${email} is not a valid email`);
  if (created.length > 0) console.log('Send each person their own link. Links expire; re-invite from the admin panel.');
  if (invalid.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exitCode = 1;
  })
  // The app's modules can keep database and Redis connections open; every write is done by now.
  .finally(() => process.exit());
