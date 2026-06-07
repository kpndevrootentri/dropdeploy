import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { handleApiError } from '@/lib/api-error';
import { projectService } from '@/services/project';
import { uploadDeployService } from '@/services/upload/upload.deploy.service';
import { uploadProjectSchema } from '@/validators/project.validator';
import { UPLOAD_MAX_FILE_BYTES, detectUploadFileType } from '@/lib/upload-utils';
import { ValidationError } from '@/lib/errors';

export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);

    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > UPLOAD_MAX_FILE_BYTES) {
      throw new ValidationError('File too large (max 50 MB)');
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const nameRaw = formData.get('name');

    if (!(file instanceof File)) throw new ValidationError('Missing file');
    if (file.size > UPLOAD_MAX_FILE_BYTES) throw new ValidationError('File too large (max 50 MB)');

    const fileType = detectUploadFileType(file);
    if (!fileType) throw new ValidationError('Only .zip and .html files are supported');

    const { name } = uploadProjectSchema.parse({ name: nameRaw });
    const buffer = Buffer.from(await file.arrayBuffer());

    const project = await projectService.create(session.userId, {
      name,
      source: 'UPLOAD',
      type: 'STATIC',
      branch: 'upload',
      useStaticHosting: true,
    });

    try {
      const { deployment, url } = await uploadDeployService.deploy(buffer, fileType, project);
      return NextResponse.json({ success: true, data: { project, deployment, url } });
    } catch (deployErr) {
      await projectService.deleteById(project.id);
      throw deployErr;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
