import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

const resetSchema = z.union([
  z.object({ newPassword: z.string().min(8) }),
  z.object({ generate: z.literal(true) }),
]);

/**
 * PATCH /api/admin/users/[userId]/reset-password – set a new password for a user (contributor only).
 * Send `{ newPassword }`, or `{ generate: true }` to have the server pick one;
 * a generated password is returned once in `data.generatedPassword`.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { userId } = await params;
    const body = resetSchema.parse(await req.json());
    const result = await adminService.resetUserPassword(userId, 'newPassword' in body ? body.newPassword : undefined);
    return NextResponse.json({ success: true, data: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
