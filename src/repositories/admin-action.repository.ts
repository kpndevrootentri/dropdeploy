import type { AdminAction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface CreateAdminActionData {
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: 'USER' | 'PROJECT';
  targetId: string | null;
  targetLabel: string;
  meta?: Prisma.InputJsonValue;
}

export interface IAdminActionRepository {
  create(data: CreateAdminActionData): Promise<AdminAction>;
  /** Newest first. `before` is the id of the last entry of the previous page. */
  findRecent(limit: number, before?: string): Promise<AdminAction[]>;
}

export class AdminActionRepository implements IAdminActionRepository {
  async create(data: CreateAdminActionData): Promise<AdminAction> {
    return prisma.adminAction.create({ data });
  }

  async findRecent(limit: number, before?: string): Promise<AdminAction[]> {
    return prisma.adminAction.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    });
  }
}

export const adminActionRepository = new AdminActionRepository();
