import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/services/auth';
import { loginSchema } from '@/validators/auth.validator';
import { handleApiError } from '@/lib/api-error';

/**
 * POST /api/auth/token
 * CLI-friendly login: returns JWT in the response body instead of a cookie.
 * Used by the dropdeploy-plugin CLI to obtain a token for Bearer auth.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const body = await req.json();
    const dto = loginSchema.parse(body);
    const result = await authService.login(dto);
    return NextResponse.json({
      success: true,
      data: {
        token: result.tokens.accessToken,
        userId: result.userId,
        email: dto.email,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
