/**
 * Seed script: creates or upserts a CONTRIBUTOR account.
 *
 * Usage:
 *   CONTRIBUTOR_EMAIL=admin@example.com CONTRIBUTOR_PASSWORD=secret123 npx tsx scripts/seed-contributor.ts
 */
import bcrypt from 'bcryptjs';

// Like dotenv: read .env if present, never overriding variables already set.
try {
  process.loadEnvFile();
} catch {
  // No .env; rely on the environment.
}

const email = process.env.CONTRIBUTOR_EMAIL;
const password = process.env.CONTRIBUTOR_PASSWORD;

if (!email || !password) {
  console.error('Error: CONTRIBUTOR_EMAIL and CONTRIBUTOR_PASSWORD env vars are required.');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Error: CONTRIBUTOR_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

async function main(): Promise<void> {
  // Imported only after .env is loaded: the app's client reads DATABASE_URL and the DB_* limits when created.
  const { prisma } = await import('@/lib/prisma');
  try {
    const passwordHash = await bcrypt.hash(password!, 10);
    const user = await prisma.user.upsert({
      where: { email: email!.toLowerCase() },
      // An operator-chosen password must be changed at first login, for new and existing accounts alike.
      update: { passwordHash, role: 'CONTRIBUTOR', mustResetPassword: true },
      create: { email: email!.toLowerCase(), passwordHash, role: 'CONTRIBUTOR', mustResetPassword: true },
    });
    console.log(`✓ Contributor account ready: ${user.email} (id: ${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
