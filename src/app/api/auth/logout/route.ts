import { NextResponse } from 'next/server';
import { clearAuthCookie, clearAdminRestoreCookie } from '@/lib/auth-cookie';

/**
 * POST /api/auth/logout – clears auth cookie.
 */
export async function POST(): Promise<NextResponse<unknown>> {
  const res = NextResponse.json({ success: true });
  clearAuthCookie(res);
  clearAdminRestoreCookie(res);
  return res;
}
