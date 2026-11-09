import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { z } from 'zod';
import { invitePath } from '@/services/invite';

const inviteUserSchema = z.object({
  email: z.string().email(),
});

/**
 * GET /api/admin/users – list all users (contributor only).
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const users = await adminService.listAllUsers();
    return NextResponse.json({ success: true, data: users });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/admin/users – invite a user (contributor only). Returns their
 * one-time invite link path; it is not stored and cannot be fetched again.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const body = await req.json();
    const { email } = inviteUserSchema.parse(body);
    const { user, inviteToken } = await adminService.inviteUser(email);
    return NextResponse.json({ success: true, data: { user, invitePath: invitePath(inviteToken) } }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
