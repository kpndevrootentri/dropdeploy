import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { z } from 'zod';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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
 * POST /api/admin/users – create (invite) a user (contributor only).
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const body = await req.json();
    const { email, password } = createUserSchema.parse(body);
    const user = await adminService.createUser(email, password);
    return NextResponse.json({ success: true, data: user }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
