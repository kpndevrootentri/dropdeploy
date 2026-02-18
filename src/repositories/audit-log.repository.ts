import type { AuditLog } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface CreateAuditLogData {
  action: string;
  targetKey: string;
  userId: string;
  projectId: string;
}

export interface IAuditLogRepository {
  create(data: CreateAuditLogData): Promise<AuditLog>;
  findByProjectId(projectId: string, limit?: number): Promise<AuditLog[]>;
}

export class AuditLogRepository implements IAuditLogRepository {
  async create(data: CreateAuditLogData): Promise<AuditLog> {
    return prisma.auditLog.create({ data });
  }

  async findByProjectId(projectId: string, limit = 50): Promise<AuditLog[]> {
    return prisma.auditLog.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const auditLogRepository = new AuditLogRepository();
