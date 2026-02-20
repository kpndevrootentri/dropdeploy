/**
 * Seed script: creates or upserts a CONTRIBUTOR account.
 *
 * Usage:
 *   CONTRIBUTOR_EMAIL=admin@example.com CONTRIBUTOR_PASSWORD=secret123 npx ts-node scripts/seed-contributor.ts
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

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

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(password!, 10);
  const user = await prisma.user.upsert({
    where: { email: email!.toLowerCase() },
    update: { passwordHash, role: 'CONTRIBUTOR' },
    create: { email: email!.toLowerCase(), passwordHash, role: 'CONTRIBUTOR', mustResetPassword: true },
  });
  console.log(`✓ Contributor account ready: ${user.email} (id: ${user.id})`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
