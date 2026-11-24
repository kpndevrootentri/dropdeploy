import type { EmailLog } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type EmailStatus = 'sent' | 'failed';

export interface NewEmailLog {
  kind: string;
  recipient: string;
  status: EmailStatus;
  error?: string | null;
}

export interface IEmailLogRepository {
  create(entry: NewEmailLog): Promise<void>;
  /** Attempts with this status since a time, optionally of one kind. */
  count(filter: { status: EmailStatus; since: Date; kind?: string }): Promise<number>;
  /** The newest failed attempts, newest first. */
  recentFailures(take: number): Promise<EmailLog[]>;
}

export class EmailLogRepository implements IEmailLogRepository {
  async create(entry: NewEmailLog): Promise<void> {
    await prisma.emailLog.create({ data: entry });
  }

  async count({ since, ...where }: { status: EmailStatus; since: Date; kind?: string }): Promise<number> {
    return prisma.emailLog.count({ where: { ...where, createdAt: { gte: since } } });
  }

  async recentFailures(take: number): Promise<EmailLog[]> {
    return prisma.emailLog.findMany({ where: { status: 'failed' }, orderBy: { createdAt: 'desc' }, take });
  }
}

export const emailLogRepository = new EmailLogRepository();
