import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/services/auth';
import { getTokenFromCookie, getAdminRestoreToken, clearAuthCookie, clearAdminRestoreCookie } from '@/lib/auth-cookie';

/**
 * POST /api/auth/logout – revokes this session's token (and its site-view token), then clears the cookies.
 * While viewing as a user, the admin's own session waits in the restore cookie; it is revoked too.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  await Promise.all([getTokenFromCookie(req), getAdminRestoreToken(req)].map((token) => authService.revokeSession(token)));
  const res = NextResponse.json({ success: true });
  clearAuthCookie(res);
  clearAdminRestoreCookie(res);
  return res;
}
