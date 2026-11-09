import type { PlatformSetting } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** The settings are a single row; this is its fixed id. */
const SETTINGS_ID = 1;

export type PlatformSettingUpdate = Partial<Omit<PlatformSetting, 'id' | 'updatedAt'>>;

export interface IPlatformSettingRepository {
  /** Null until an admin first saves; callers fall back to the defaults. */
  get(): Promise<PlatformSetting | null>;
  upsert(data: PlatformSettingUpdate): Promise<PlatformSetting>;
}

export class PlatformSettingRepository implements IPlatformSettingRepository {
  async get(): Promise<PlatformSetting | null> {
    return prisma.platformSetting.findUnique({ where: { id: SETTINGS_ID } });
  }

  async upsert(data: PlatformSettingUpdate): Promise<PlatformSetting> {
    return prisma.platformSetting.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
  }
}

export const platformSettingRepository = new PlatformSettingRepository();
