import type { PlatformSetting } from '@prisma/client';
import {
  platformSettingRepository,
  type IPlatformSettingRepository,
} from '@/repositories/platform-setting.repository';
import { getConfig } from '@/lib/config';
import type { UpdatePlatformSettingsDto } from '@/validators/platform-settings.validator';

export type PlatformSettings = Omit<PlatformSetting, 'id' | 'updatedAt'>;

/** Mirrors the schema defaults; used until an admin first saves the settings. */
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  defaultProjectQuota: 5,
  defaultDomainQuota: 1,
  signupOpen: true,
  bannerMessage: null,
  proxyHitRetentionDays: 90,
};

function toSettings(row: PlatformSetting | null): PlatformSettings {
  if (!row) return DEFAULT_PLATFORM_SETTINGS;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, updatedAt, ...settings } = row;
  return settings;
}

export class PlatformSettingsService {
  constructor(
    private readonly repo: IPlatformSettingRepository,
    private readonly cfg: () => { ALLOW_PUBLIC_REGISTRATION: boolean } = getConfig,
  ) {}

  async get(): Promise<PlatformSettings> {
    return toSettings(await this.repo.get());
  }

  async update(dto: UpdatePlatformSettingsDto): Promise<PlatformSettings> {
    return toSettings(await this.repo.upsert(dto));
  }

  /**
   * Self-registration needs both switches. ALLOW_PUBLIC_REGISTRATION stays the
   * ceiling (emails are never verified, so opening sign-up is a security
   * decision for whoever controls the server); the admin setting can only
   * close it again, never open it.
   */
  async isSignupOpen(): Promise<boolean> {
    return this.cfg().ALLOW_PUBLIC_REGISTRATION && (await this.get()).signupOpen;
  }
}

export const platformSettingsService = new PlatformSettingsService(platformSettingRepository);
