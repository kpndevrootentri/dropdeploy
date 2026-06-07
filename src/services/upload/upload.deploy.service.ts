import * as path from 'path';
import { deploymentRepository, type IDeploymentRepository } from '@/repositories/deployment.repository';
import { extractZipToDir, writeSingleHtmlToDir } from './upload.service';
import { getConfig } from '@/lib/config';
import { getDeployedProjectUrl } from '@/lib/project-url';
import type { Deployment, Project } from '@prisma/client';
import type { UploadFileType } from '@/lib/upload-utils';

export interface DeployUploadResult {
  deployment: Deployment;
  url: string;
}

export interface IUploadDeployService {
  deploy(buffer: Buffer, fileType: UploadFileType, project: Project): Promise<DeployUploadResult>;
}

export class UploadDeployService implements IUploadDeployService {
  constructor(private readonly deployRepo: IDeploymentRepository) {}

  async deploy(buffer: Buffer, fileType: UploadFileType, project: Project): Promise<DeployUploadResult> {
    const { STATIC_SERVE_DIR } = getConfig();
    const destDir = path.join(STATIC_SERVE_DIR, project.slug);

    const deployment = await this.deployRepo.create({ projectId: project.id, status: 'BUILDING' });

    try {
      if (fileType === 'zip') {
        await extractZipToDir(buffer, destDir);
      } else {
        await writeSingleHtmlToDir(buffer, destDir);
      }
    } catch (extractErr) {
      await this.deployRepo.update(deployment.id, {
        status: 'FAILED',
        completedAt: new Date(),
        buildLog: extractErr instanceof Error ? extractErr.message : 'Extraction failed',
      });
      throw extractErr;
    }

    const subdomain = project.slug;
    await this.deployRepo.clearSubdomainForOtherDeployments(project.id, subdomain, deployment.id);
    const updatedDeployment = await this.deployRepo.update(deployment.id, {
      status: 'DEPLOYED',
      servingMethod: 'STATIC_FILES',
      subdomain,
      startedAt: new Date(),
      completedAt: new Date(),
      buildLog: 'Uploaded and extracted successfully.',
    });

    return { deployment: updatedDeployment, url: getDeployedProjectUrl(subdomain) };
  }
}

export const uploadDeployService = new UploadDeployService(deploymentRepository);
