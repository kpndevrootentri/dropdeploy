import * as fs from 'fs';
import * as path from 'path';
import { deploymentRepository, type IDeploymentRepository } from '@/repositories/deployment.repository';
import { extractZipToDir, writeSingleHtmlToDir } from './upload.service';
import { getConfig } from '@/lib/config';
import { getDeployedProjectUrl } from '@/lib/project-url';
import { NotFoundError, ValidationError } from '@/lib/errors';
import type { Deployment, Project } from '@prisma/client';
import type { UploadFileType } from '@/lib/upload-utils';

/** Uploaded files kept per project, counting the live one. Older ones can no longer be rolled back to. */
export const KEPT_UPLOADS = 5;

export interface DeployUploadResult {
  deployment: Deployment;
  url: string;
}

export interface IUploadDeployService {
  deploy(buffer: Buffer, fileType: UploadFileType, project: Project, rollbackOfId?: string): Promise<DeployUploadResult>;
  rollback(project: Project, targetDeploymentId: string): Promise<DeployUploadResult>;
}

export class UploadDeployService implements IUploadDeployService {
  constructor(private readonly deployRepo: IDeploymentRepository) {}

  async deploy(
    buffer: Buffer,
    fileType: UploadFileType,
    project: Project,
    rollbackOfId?: string,
  ): Promise<DeployUploadResult> {
    const { STATIC_SERVE_DIR } = getConfig();
    const destDir = path.join(STATIC_SERVE_DIR, project.slug);

    const deployment = await this.deployRepo.create({ projectId: project.id, status: 'BUILDING', rollbackOfId });

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

    await this.keepUpload(project, deployment.id, fileType, buffer);

    return { deployment: updatedDeployment, url: getDeployedProjectUrl(subdomain) };
  }

  /** Publishes an earlier successful upload again, from its kept file. */
  async rollback(project: Project, targetDeploymentId: string): Promise<DeployUploadResult> {
    const target = await this.deployRepo.findById(targetDeploymentId);
    if (!target || target.projectId !== project.id) throw new NotFoundError('Deployment');
    if (target.status !== 'DEPLOYED') {
      throw new ValidationError('Only a previous successful upload can be rolled back to');
    }
    if (target.subdomain) throw new ValidationError('That deployment is already live');

    for (const fileType of ['zip', 'html'] as const) {
      const buffer = await fs.promises.readFile(keptFilePath(project.slug, target.id, fileType)).catch(() => null);
      if (buffer) return this.deploy(buffer, fileType, project, target.id);
    }
    throw new ValidationError(`That upload is no longer kept — only the last ${KEPT_UPLOADS} are`);
  }

  /**
   * Saves this upload for rollback and removes files of deployments older than
   * the last KEPT_UPLOADS. Best effort: the site is already live, so a failure
   * here only costs the rollback to this one version.
   */
  private async keepUpload(project: Project, deploymentId: string, fileType: UploadFileType, buffer: Buffer): Promise<void> {
    try {
      const file = keptFilePath(project.slug, deploymentId, fileType);
      const dir = path.dirname(file);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(file, buffer);

      const recent = new Set(
        (await this.deployRepo.findByProjectId(project.id, KEPT_UPLOADS)).map((d) => d.id),
      );
      const stale = (await fs.promises.readdir(dir)).filter((name) => !recent.has(path.parse(name).name));
      await Promise.all(stale.map((name) => fs.promises.rm(path.join(dir, name), { force: true })));
    } catch (err) {
      console.error(`[upload] could not keep upload ${deploymentId} for rollback:`, err);
    }
  }
}

/** `<UPLOADS_DIR>/<slug>/<deploymentId>.<zip|html>`. Keyed by slug so project deletion removes it. */
function keptFilePath(slug: string, deploymentId: string, fileType: UploadFileType): string {
  return path.join(getConfig().UPLOADS_DIR, slug, `${deploymentId}.${fileType}`);
}

export const uploadDeployService = new UploadDeployService(deploymentRepository);
