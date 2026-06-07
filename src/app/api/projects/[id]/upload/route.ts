import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { handleApiError } from '@/lib/api-error';
import { projectService } from '@/services/project';
import { uploadDeployService } from '@/services/upload/upload.deploy.service';
import { UPLOAD_MAX_FILE_BYTES, detectUploadFileType } from '@/lib/upload-utils';
import { ValidationError } from '@/lib/errors';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id: projectId } = await params;

    const project = await projectService.getById(projectId, session.userId);

    if (project.source !== 'UPLOAD') {
      throw new ValidationError('This project does not support file uploads — use the deploy endpoint instead');
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > UPLOAD_MAX_FILE_BYTES) {
      throw new ValidationError('File too large (max 50 MB)');
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) throw new ValidationError('Missing file');
    if (file.size > UPLOAD_MAX_FILE_BYTES) throw new ValidationError('File too large (max 50 MB)');

    const fileType = detectUploadFileType(file);
    if (!fileType) throw new ValidationError('Only .zip and .html files are supported');

    const buffer = Buffer.from(await file.arrayBuffer());
    const { deployment, url } = await uploadDeployService.deploy(buffer, fileType, project);

    return NextResponse.json({ success: true, data: { project, deployment, url } });
  } catch (error) {
    return handleApiError(error);
  }
}
