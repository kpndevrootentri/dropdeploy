import type { NotificationHook } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type NewNotificationHook = Pick<NotificationHook, 'projectId' | 'host' | 'configEnc' | 'configIv' | 'configTag' | 'events'>;

export interface INotificationHookRepository {
  /** Oldest first. */
  listByProject(projectId: string): Promise<NotificationHook[]>;
  findById(id: string): Promise<NotificationHook | null>;
  /** Null when the project already has `limit` hooks. */
  create(data: NewNotificationHook, limit: number): Promise<NotificationHook | null>;
  /** False when the project has no hook with that id. */
  delete(id: string, projectId: string): Promise<boolean>;
  /** A no-op if the hook was deleted while it was being delivered. */
  setLastStatus(id: string, status: string, at: Date): Promise<void>;
}

export class NotificationHookRepository implements INotificationHookRepository {
  async listByProject(projectId: string): Promise<NotificationHook[]> {
    return prisma.notificationHook.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  }

  async findById(id: string): Promise<NotificationHook | null> {
    return prisma.notificationHook.findUnique({ where: { id } });
  }

  async create(data: NewNotificationHook, limit: number): Promise<NotificationHook | null> {
    return prisma.$transaction(async (tx) => {
      // Held until the transaction ends, so parallel creates cannot all pass the count.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.projectId}))`;
      if ((await tx.notificationHook.count({ where: { projectId: data.projectId } })) >= limit) return null;
      return tx.notificationHook.create({ data });
    });
  }

  async delete(id: string, projectId: string): Promise<boolean> {
    const { count } = await prisma.notificationHook.deleteMany({ where: { id, projectId } });
    return count > 0;
  }

  async setLastStatus(id: string, status: string, at: Date): Promise<void> {
    await prisma.notificationHook.updateMany({ where: { id }, data: { lastStatus: status, lastAttemptAt: at } });
  }
}

export const notificationHookRepository = new NotificationHookRepository();
