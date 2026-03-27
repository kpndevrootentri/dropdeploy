import type { GitProvider, SourceType } from '@prisma/client';
import {
  gitProviderRepository,
  type IGitProviderRepository,
} from '@/repositories/git-provider.repository';
import { encryptionService, type IEncryptionService } from '@/services/encryption';
import { createLogger } from '@/lib/logger';
import { NotFoundError } from '@/lib/errors';
import { getConfig } from '@/lib/config';
import { fetchGitHubRepos, type RepoItem } from '@/lib/providers/github';
import { fetchGitLabRepos, refreshGitLabToken, gitlabCallbackUrl } from '@/lib/providers/gitlab';

export type { RepoItem } from '@/lib/providers/github';

const log = createLogger('git-provider-service');

/** Safe public representation — never exposes tokens. */
export interface GitProviderInfo {
  id: string;
  provider: SourceType;
  username: string;
  avatarUrl: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectGitProviderDto {
  provider: SourceType;
  providerUserId: string;
  username: string;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  /** seconds until expiry returned by GitLab; null/undefined for GitHub */
  expiresInSeconds?: number | null;
}

export interface IGitProviderService {
  connect(userId: string, dto: ConnectGitProviderDto): Promise<GitProviderInfo>;
  disconnect(userId: string, provider: SourceType): Promise<void>;
  listByUser(userId: string): Promise<GitProviderInfo[]>;
  /** Returns decrypted access token, auto-refreshing GitLab tokens if near expiry. */
  getTokenForDeployment(userId: string, provider: SourceType): Promise<string | null>;
  listRepos(userId: string, provider: SourceType, query: string, page: number): Promise<RepoItem[]>;
}

export class GitProviderService implements IGitProviderService {
  constructor(
    private readonly repo: IGitProviderRepository,
    private readonly encryption: IEncryptionService,
  ) {}

  async connect(userId: string, dto: ConnectGitProviderDto): Promise<GitProviderInfo> {
    const encToken = this.encryption.encrypt(dto.accessToken);
    let encRefresh = null;
    let tokenExpiresAt: Date | null = null;

    if (dto.refreshToken) {
      encRefresh = this.encryption.encrypt(dto.refreshToken);
    }
    if (dto.expiresInSeconds) {
      tokenExpiresAt = new Date(Date.now() + dto.expiresInSeconds * 1000);
    }

    const record = await this.repo.upsert(userId, {
      provider: dto.provider,
      providerUserId: dto.providerUserId,
      username: dto.username,
      avatarUrl: dto.avatarUrl ?? null,
      encryptedToken: encToken.encryptedValue,
      iv: encToken.iv,
      authTag: encToken.authTag,
      encryptedRefreshToken: encRefresh?.encryptedValue ?? null,
      refreshIv: encRefresh?.iv ?? null,
      refreshAuthTag: encRefresh?.authTag ?? null,
      tokenExpiresAt,
    });

    log.info('Git provider connected', { userId, provider: dto.provider, username: dto.username });

    return this.toInfo(record);
  }

  async disconnect(userId: string, provider: SourceType): Promise<void> {
    const existing = await this.repo.findByUserAndProvider(userId, provider);
    if (!existing) {
      throw new NotFoundError(`${provider} connection`);
    }
    await this.repo.delete(userId, provider);
    log.info('Git provider disconnected', { userId, provider });
  }

  async listByUser(userId: string): Promise<GitProviderInfo[]> {
    const records = await this.repo.findByUserId(userId);
    return records.map((r) => this.toInfo(r));
  }

  async getTokenForDeployment(userId: string, provider: SourceType): Promise<string | null> {
    const record = await this.repo.findByUserAndProvider(userId, provider);
    if (!record) return null;

    // GitLab tokens expire — proactively refresh if within 5 minutes of expiry
    if (provider === 'GITLAB' && record.tokenExpiresAt) {
      const fiveMinMs = 5 * 60 * 1000;
      if (record.tokenExpiresAt.getTime() - Date.now() <= fiveMinMs) {
        const refreshed = await this.refreshGitLabToken(record);
        if (!refreshed) return null; // token revoked; record deleted
        return refreshed;
      }
    }

    return this.encryption.decrypt({
      encryptedValue: record.encryptedToken,
      iv: record.iv,
      authTag: record.authTag,
    });
  }

  async listRepos(userId: string, provider: SourceType, query: string, page: number): Promise<RepoItem[]> {
    const token = await this.getTokenForDeployment(userId, provider);
    if (!token) throw new NotFoundError(`${provider} connection`);

    if (provider === 'GITHUB') {
      return fetchGitHubRepos(token, query, page);
    }
    return fetchGitLabRepos(token, query, page);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async refreshGitLabToken(record: GitProvider): Promise<string | null> {
    if (!record.encryptedRefreshToken || !record.refreshIv || !record.refreshAuthTag) {
      await this.repo.delete(record.userId, record.provider);
      return null;
    }

    const currentRefreshToken = this.encryption.decrypt({
      encryptedValue: record.encryptedRefreshToken,
      iv: record.refreshIv,
      authTag: record.refreshAuthTag,
    });

    const { GITLAB_CLIENT_ID, GITLAB_CLIENT_SECRET, APP_URL } = getConfig();
    if (!GITLAB_CLIENT_ID || !GITLAB_CLIENT_SECRET || !APP_URL) {
      log.error('GitLab OAuth not configured — cannot refresh token');
      return null;
    }

    try {
      const data = await refreshGitLabToken(
        GITLAB_CLIENT_ID,
        GITLAB_CLIENT_SECRET,
        currentRefreshToken,
        gitlabCallbackUrl(APP_URL),
      );

      if (!data.access_token || !data.refresh_token) {
        log.warn('GitLab token refresh failed — disconnecting provider', { userId: record.userId });
        await this.repo.delete(record.userId, record.provider);
        return null;
      }

      const encToken = this.encryption.encrypt(data.access_token);
      const encRefresh = this.encryption.encrypt(data.refresh_token);
      const tokenExpiresAt = typeof data.expires_in === 'number'
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;

      await this.repo.updateToken(record.id, {
        encryptedToken: encToken.encryptedValue,
        iv: encToken.iv,
        authTag: encToken.authTag,
        encryptedRefreshToken: encRefresh.encryptedValue,
        refreshIv: encRefresh.iv,
        refreshAuthTag: encRefresh.authTag,
        tokenExpiresAt,
      });

      return data.access_token;
    } catch (err) {
      log.error('GitLab token refresh error', { error: String(err) });
      await this.repo.delete(record.userId, record.provider);
      return null;
    }
  }

  private toInfo(record: GitProvider): GitProviderInfo {
    return {
      id: record.id,
      provider: record.provider,
      username: record.username,
      avatarUrl: record.avatarUrl,
      tokenExpiresAt: record.tokenExpiresAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

}

export const gitProviderService = new GitProviderService(
  gitProviderRepository,
  encryptionService,
);
