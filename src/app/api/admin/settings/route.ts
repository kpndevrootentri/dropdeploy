import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { getConfig } from '@/lib/config';
import { platformSettingsService, type PlatformSettings } from '@/services/platform-settings/platform-settings.service';
import { updatePlatformSettingsSchema } from '@/validators/platform-settings.validator';
import { handleApiError } from '@/lib/api-error';

/** The env ceiling travels with the settings so the page can explain a disabled switch. */
function settingsResponse(settings: PlatformSettings): NextResponse<unknown> {
  return NextResponse.json({
    success: true,
    data: { ...settings, publicRegistrationAllowed: getConfig().ALLOW_PUBLIC_REGISTRATION },
  });
}

/**
 * GET /api/admin/settings – platform settings (contributor only).
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    return settingsResponse(await platformSettingsService.get());
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/admin/settings – update any subset of the settings (contributor only).
 */
export async function PATCH(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const dto = updatePlatformSettingsSchema.parse(await req.json());
    return settingsResponse(await platformSettingsService.update(dto));
  } catch (error) {
    return handleApiError(error);
  }
}
