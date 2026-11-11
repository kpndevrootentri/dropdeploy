import type { PlatformSetting, User } from '@prisma/client';
import { PlatformSettingsService, DEFAULT_PLATFORM_SETTINGS } from '@/services/platform-settings/platform-settings.service';
import { updatePlatformSettingsSchema } from '@/validators/platform-settings.validator';
import { AuthService } from '@/services/auth/auth.service';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IPlatformSettingRepository } from '@/repositories/platform-setting.repository';

const settingsRepo = (row: Partial<PlatformSetting> | null): IPlatformSettingRepository => ({
  get: async () => (row ? ({ id: 1, updatedAt: new Date(), ...DEFAULT_PLATFORM_SETTINGS, ...row } as PlatformSetting) : null),
  upsert: jest.fn(),
});

describe('PlatformSettingsService.isSignupOpen', () => {
  const open = (env: boolean, row: Partial<PlatformSetting> | null) =>
    new PlatformSettingsService(settingsRepo(row), () => ({ ALLOW_PUBLIC_REGISTRATION: env })).isSignupOpen();

  it('is closed when an admin closes it, even with the env flag on', async () => {
    await expect(open(true, { signupOpen: false })).resolves.toBe(false);
  });

  it('can never be opened by the admin setting while the env flag is off', async () => {
    await expect(open(false, { signupOpen: true })).resolves.toBe(false);
    await expect(open(false, null)).resolves.toBe(false);
  });

  it('is open only when both allow it', async () => {
    await expect(open(true, null)).resolves.toBe(true);
  });
});

describe('updatePlatformSettingsSchema', () => {
  it('refuses a proxy-hit retention under 7 days', () => {
    expect(updatePlatformSettingsSchema.safeParse({ proxyHitRetentionDays: 6 }).success).toBe(false);
    expect(updatePlatformSettingsSchema.safeParse({ proxyHitRetentionDays: 7 }).success).toBe(true);
  });

  it('turns an empty banner into no banner', () => {
    expect(updatePlatformSettingsSchema.parse({ bannerMessage: '   ' })).toEqual({ bannerMessage: null });
  });
});

describe('AuthService.register', () => {
  it('gives new accounts the default quotas from the platform settings', async () => {
    const create = jest.fn(async (data: Partial<User>) => ({ id: 'u1', role: 'USER', tokenVersion: 0, mustResetPassword: false, ...data }) as User);
    const repo = { findByEmail: async () => null, create } as unknown as IUserRepository;
    const settings = { get: async () => ({ ...DEFAULT_PLATFORM_SETTINGS, defaultProjectQuota: 2, defaultDomainQuota: 0 }) };
    const auth = new AuthService(repo, { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '1h' }, settings);

    await auth.register({ email: 'new@entri.me', password: 'long-enough' });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ projectQuota: 2, domainQuota: 0 }));
  });
});
