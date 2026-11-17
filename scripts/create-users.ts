/**
 * Creates USER accounts that must reset their password on first login.
 * Existing accounts are skipped, never changed.
 *
 * Usage:
 *   npx tsx scripts/create-users.ts a@entri.me b@entri.me ...
 *   USER_PASSWORD=other123 npx tsx scripts/create-users.ts a@entri.me
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

// Like dotenv: read .env if present, never overriding variables already set.
try {
  process.loadEnvFile();
} catch {
  // No .env; rely on the environment.
}

const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase());
const password = process.env.USER_PASSWORD ?? 'password';

if (emails.length === 0 || emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) {
  console.error('Usage: npx tsx scripts/create-users.ts <email> [email ...]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Error: USER_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 12);
  for (const email of emails) {
    if (await prisma.user.findUnique({ where: { email } })) {
      console.log(`- ${email} already exists, skipped`);
      continue;
    }
    await prisma.user.create({ data: { email, passwordHash, role: 'USER', mustResetPassword: true } });
    console.log(`✓ ${email} created`);
  }
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
