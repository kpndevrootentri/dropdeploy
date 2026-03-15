import * as fs from 'fs';
import * as path from 'path';
import type { Project } from '@prisma/client';
import { dockerService, type DockerService } from '@/services/docker';
import { encryptionService, type IEncryptionService } from '@/services/encryption';
import { androidBuildConfigRepository, type IAndroidBuildConfigRepository } from '@/repositories/android-build-config.repository';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';

const log = createLogger('android-build');

export class AndroidBuildService {
  constructor(
    private readonly docker: DockerService,
    private readonly encryptionService: IEncryptionService,
    private readonly androidConfigRepo: IAndroidBuildConfigRepository,
  ) {}

  /**
   * Builds the Android APK for a project and extracts it to the artifacts directory.
   * Returns the local path to the extracted APK.
   */
  async prepareAndBuild(
    project: Project,
    workDir: string,
    deploymentId: string,
    onLog?: (line: string) => void,
  ): Promise<string> {
    const config = await this.androidConfigRepo.findByProjectId(project.id);

    const gradleTask = config?.gradleTask ?? 'assembleDebug';
    const apkOutputPath = config?.apkOutputPath ?? 'app/build/outputs/apk/debug/app-debug.apk';
    const buildType = config?.buildType ?? 'debug';

    log.info('Starting Android build', { projectId: project.id, deploymentId, gradleTask, buildType });

    const buildArgs: Record<string, string> = {
      GRADLE_TASK: gradleTask,
      APK_OUTPUT_PATH: apkOutputPath,
    };

    // For release builds with a keystore, decrypt and write to temp file
    let tempKeystorePath: string | null = null;
    if (buildType === 'release' && config?.keystoreBase64 && config.keystoreIv && config.keystoreAuthTag) {
      try {
        const keystoreBase64 = this.encryptionService.decrypt({
          encryptedValue: config.keystoreBase64,
          iv: config.keystoreIv,
          authTag: config.keystoreAuthTag,
        });
        const keystoreBuffer = Buffer.from(keystoreBase64, 'base64');
        tempKeystorePath = path.join(workDir, '.keystore.tmp.jks');
        await fs.promises.writeFile(tempKeystorePath, keystoreBuffer);

        if (config.keystoreAlias) buildArgs['KEYSTORE_ALIAS'] = config.keystoreAlias;
        if (config.keystorePassword && config.keystorePasswordIv && config.keystorePasswordAuthTag) {
          buildArgs['KEYSTORE_PASSWORD'] = this.encryptionService.decrypt({
            encryptedValue: config.keystorePassword,
            iv: config.keystorePasswordIv,
            authTag: config.keystorePasswordAuthTag,
          });
        }
        if (config.keyPassword && config.keyPasswordIv && config.keyPasswordAuthTag) {
          buildArgs['KEY_PASSWORD'] = this.encryptionService.decrypt({
            encryptedValue: config.keyPassword,
            iv: config.keyPasswordIv,
            authTag: config.keyPasswordAuthTag,
          });
        }
      } catch (err) {
        log.error('Failed to decrypt keystore', { error: String(err) });
        throw new Error('Failed to decrypt keystore for release build');
      }
    }

    const imageName = `dropdeploy/${project.slug}:latest`;

    try {
      await this.docker.buildImage(project, workDir, buildArgs, Object.values(buildArgs), onLog, 'linux/amd64');

      const { ARTIFACTS_DIR } = getConfig();
      const destDir = path.join(ARTIFACTS_DIR, project.id, deploymentId);
      const destPath = path.join(destDir, 'app.apk');

      await this.docker.extractArtifactFromImage(imageName, '/artifact/app.apk', destPath);

      log.info('APK extracted successfully', { destPath });
      return destPath;
    } finally {
      if (tempKeystorePath) {
        await fs.promises.unlink(tempKeystorePath).catch(() => {});
      }
    }
  }
}

export const androidBuildService = new AndroidBuildService(
  dockerService,
  encryptionService,
  androidBuildConfigRepository,
);
