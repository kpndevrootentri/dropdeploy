import { PrismaClient } from '@prisma/client';
import { getDbConfig } from './config';
import { buildDatabaseUrl } from './database-url';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const databaseUrl = process.env.DATABASE_URL;

/**
 * Singleton Prisma client for server-side use.
 * Prevents multiple instances in development (hot reload).
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrl ? buildDatabaseUrl(databaseUrl, getDbConfig()) : undefined,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
