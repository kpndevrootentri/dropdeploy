import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { handleApiError } from '@/lib/api-error';
import { ValidationError } from '@/lib/errors';
import { androidBuildConfigRepository } from '@/repositories/android-build-config.repository';
import { encryptionService } from '@/services/encryption';

type RouteCtx = { params: Promise<{ id: string }> };

const androidConfigSchema = z.object({
  buildType: z.enum(['debug', 'release']).optional(),
  gradleTask: z.string().min(1).max(200).optional(),
  apkOutputPath: z.string().min(1).max(500).optional(),
  keystoreBase64: z.string().optional().nullable(),
  keystoreAlias: z.string().max(200).optional().nullable(),
  keystorePassword: z.string().optional().nullable(),
  keyPassword: z.string().optional().nullable(),
});

/**
 * GET /api/projects/:id/android-config
 * Returns current AndroidBuildConfig (without decrypted secrets).
 */
export async function GET(
  req: NextRequest,
  { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    await projectService.getById(id, session.userId);

    const config = await androidBuildConfigRepository.findByProjectId(id);
    if (!config) {
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: config.id,
        buildType: config.buildType,
        gradleTask: config.gradleTask,
        apkOutputPath: config.apkOutputPath,
        keystoreAlias: config.keystoreAlias,
        hasKeystore: !!config.keystoreBase64,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/projects/:id/android-config
 * Creates or updates AndroidBuildConfig. Encrypts keystore and passwords.
 */
export async function POST(
  req: NextRequest,
  { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    await projectService.getById(id, session.userId);

    const body = await req.json();
    const parsed = androidConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    }

    const { buildType, gradleTask, apkOutputPath, keystoreBase64, keystoreAlias, keystorePassword, keyPassword } = parsed.data;

    const updateData: Parameters<typeof androidBuildConfigRepository.upsert>[1] = {};
    if (buildType !== undefined) updateData.buildType = buildType;
    if (gradleTask !== undefined) updateData.gradleTask = gradleTask;
    if (apkOutputPath !== undefined) updateData.apkOutputPath = apkOutputPath;
    if (keystoreAlias !== undefined) updateData.keystoreAlias = keystoreAlias;

    if (keystoreBase64 != null) {
      const encrypted = encryptionService.encrypt(keystoreBase64);
      updateData.keystoreBase64 = encrypted.encryptedValue;
      updateData.keystoreIv = encrypted.iv;
      updateData.keystoreAuthTag = encrypted.authTag;
    } else if (keystoreBase64 === null) {
      updateData.keystoreBase64 = null;
      updateData.keystoreIv = null;
      updateData.keystoreAuthTag = null;
    }

    if (keystorePassword != null) {
      const encrypted = encryptionService.encrypt(keystorePassword);
      updateData.keystorePassword = encrypted.encryptedValue;
      updateData.keystorePasswordIv = encrypted.iv;
      updateData.keystorePasswordAuthTag = encrypted.authTag;
    } else if (keystorePassword === null) {
      updateData.keystorePassword = null;
      updateData.keystorePasswordIv = null;
      updateData.keystorePasswordAuthTag = null;
    }

    if (keyPassword != null) {
      const encrypted = encryptionService.encrypt(keyPassword);
      updateData.keyPassword = encrypted.encryptedValue;
      updateData.keyPasswordIv = encrypted.iv;
      updateData.keyPasswordAuthTag = encrypted.authTag;
    } else if (keyPassword === null) {
      updateData.keyPassword = null;
      updateData.keyPasswordIv = null;
      updateData.keyPasswordAuthTag = null;
    }

    const config = await androidBuildConfigRepository.upsert(id, updateData);

    return NextResponse.json({
      success: true,
      data: {
        id: config.id,
        buildType: config.buildType,
        gradleTask: config.gradleTask,
        apkOutputPath: config.apkOutputPath,
        keystoreAlias: config.keystoreAlias,
        hasKeystore: !!config.keystoreBase64,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      },
    }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
