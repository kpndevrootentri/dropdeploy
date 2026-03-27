import type { GitProvider, SourceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface UpsertGitProviderData {
  provider: SourceType;
  providerUserId: string;
  username: string;
  avatarUrl?: string | null;
  encryptedToken: string;
  iv: string;
  authTag: string;
  encryptedRefreshToken?: string | null;
  refreshIv?: string | null;
  refreshAuthTag?: string | null;
  tokenExpiresAt?: Date | null;
}

export interface UpdateTokenData {
  encryptedToken: string;
  iv: string;
  authTag: string;
  encryptedRefreshToken?: string | null;
  refreshIv?: string | null;
  refreshAuthTag?: string | null;
  tokenExpiresAt?: Date | null;
}

export interface IGitProviderRepository {
  findByUserId(userId: string): Promise<GitProvider[]>;
  findByUserAndProvider(userId: string, provider: SourceType): Promise<GitProvider | null>;
  upsert(userId: string, data: UpsertGitProviderData): Promise<GitProvider>;
  updateToken(id: string, data: UpdateTokenData): Promise<GitProvider>;
  delete(userId: string, provider: SourceType): Promise<void>;
}

export class GitProviderRepository implements IGitProviderRepository {
  async findByUserId(userId: string): Promise<GitProvider[]> {
    return prisma.gitProvider.findMany({
      where: { userId },
      orderBy: { provider: 'asc' },
    });
  }

  async findByUserAndProvider(userId: string, provider: SourceType): Promise<GitProvider | null> {
    return prisma.gitProvider.findUnique({
      where: { userId_provider: { userId, provider } },
    });
  }

  async upsert(userId: string, data: UpsertGitProviderData): Promise<GitProvider> {
    return prisma.gitProvider.upsert({
      where: { userId_provider: { userId, provider: data.provider } },
      create: { userId, ...data },
      update: {
        providerUserId: data.providerUserId,
        username: data.username,
        avatarUrl: data.avatarUrl,
        encryptedToken: data.encryptedToken,
        iv: data.iv,
        authTag: data.authTag,
        encryptedRefreshToken: data.encryptedRefreshToken,
        refreshIv: data.refreshIv,
        refreshAuthTag: data.refreshAuthTag,
        tokenExpiresAt: data.tokenExpiresAt,
      },
    });
  }

  async updateToken(id: string, data: UpdateTokenData): Promise<GitProvider> {
    return prisma.gitProvider.update({ where: { id }, data });
  }

  async delete(userId: string, provider: SourceType): Promise<void> {
    await prisma.gitProvider.deleteMany({ where: { userId, provider } });
  }
}

export const gitProviderRepository = new GitProviderRepository();
