import type { AndroidBuildConfig } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface CreateAndroidConfigDto {
  buildType?: string;
  gradleTask?: string;
  apkOutputPath?: string;
  keystoreBase64?: string | null;
  keystoreIv?: string | null;
  keystoreAuthTag?: string | null;
  keystoreAlias?: string | null;
  keystorePassword?: string | null;
  keystorePasswordIv?: string | null;
  keystorePasswordAuthTag?: string | null;
  keyPassword?: string | null;
  keyPasswordIv?: string | null;
  keyPasswordAuthTag?: string | null;
}

export interface IAndroidBuildConfigRepository {
  findByProjectId(projectId: string): Promise<AndroidBuildConfig | null>;
  upsert(projectId: string, data: CreateAndroidConfigDto): Promise<AndroidBuildConfig>;
  delete(projectId: string): Promise<void>;
}

export class AndroidBuildConfigRepository implements IAndroidBuildConfigRepository {
  async findByProjectId(projectId: string): Promise<AndroidBuildConfig | null> {
    return prisma.androidBuildConfig.findUnique({ where: { projectId } });
  }

  async upsert(projectId: string, data: CreateAndroidConfigDto): Promise<AndroidBuildConfig> {
    return prisma.androidBuildConfig.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    });
  }

  async delete(projectId: string): Promise<void> {
    await prisma.androidBuildConfig.delete({ where: { projectId } }).catch(() => {});
  }
}

export const androidBuildConfigRepository = new AndroidBuildConfigRepository();
