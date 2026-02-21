import type { EnvEnvironment } from '@prisma/client';
import { envVarRepository, type IEnvironmentVariableRepository } from '@/repositories/env-var.repository';
import { auditLogRepository, type IAuditLogRepository } from '@/repositories/audit-log.repository';
import { encryptionService, type IEncryptionService } from '@/services/encryption';
import { createLogger } from '@/lib/logger';
import { ConflictError, NotFoundError } from '@/lib/errors';
import type { CreateEnvVarDto, UpdateEnvVarDto, EnvVarResponse } from '@/types/env-var.types';

const log = createLogger('env-var-service');

export class EnvironmentVariableService {
  constructor(
    private readonly envVarRepo: IEnvironmentVariableRepository,
    private readonly encryption: IEncryptionService,
    private readonly auditLog: IAuditLogRepository,
  ) {}

  async create(projectId: string, dto: CreateEnvVarDto, userId?: string): Promise<EnvVarResponse> {
    const environment = dto.environment ?? 'ALL';

    const existing = await this.envVarRepo.findByProjectKeyEnv(
      projectId,
      dto.key,
      environment,
    );
    if (existing) {
      throw new ConflictError(
        `Environment variable "${dto.key}" already exists for ${environment}`,
      );
    }

    const encrypted = this.encryption.encrypt(dto.value);

    const envVar = await this.envVarRepo.create(projectId, {
      key: dto.key,
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      environment,
    });

    if (userId) {
      await this.logAction('ENV_CREATED', dto.key, userId, projectId);
    }

    return this.toResponse(envVar);
  }

  async listByProject(projectId: string): Promise<EnvVarResponse[]> {
    const envVars = await this.envVarRepo.findByProjectId(projectId);
    return envVars.map((v) => this.toResponse(v));
  }

  async update(id: string, projectId: string, dto: UpdateEnvVarDto, userId?: string): Promise<EnvVarResponse> {
    const envVar = await this.envVarRepo.findById(id);
    if (!envVar || envVar.projectId !== projectId) {
      throw new NotFoundError('Environment variable');
    }

    const encrypted = this.encryption.encrypt(dto.value);

    const updated = await this.envVarRepo.update(id, {
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });

    if (userId) {
      await this.logAction('ENV_UPDATED', envVar.key, userId, projectId);
    }

    return this.toResponse(updated);
  }

  async delete(id: string, projectId: string, userId?: string): Promise<void> {
    const envVar = await this.envVarRepo.findById(id);
    if (!envVar || envVar.projectId !== projectId) {
      throw new NotFoundError('Environment variable');
    }

    const key = envVar.key;
    await this.envVarRepo.delete(id);

    if (userId) {
      await this.logAction('ENV_DELETED', key, userId, projectId);
    }
  }

  async resolveForDeployment(
    projectId: string,
    environment: EnvEnvironment = 'PRODUCTION',
  ): Promise<Record<string, string>> {
    const envVars = await this.envVarRepo.findByProjectIdAndEnvironment(
      projectId,
      environment,
    );

    const resolved: Record<string, string> = {};

    // Process ALL first, then environment-specific overrides
    const allVars = envVars.filter((v) => v.environment === 'ALL');
    const envSpecific = envVars.filter((v) => v.environment !== 'ALL');

    for (const v of allVars) {
      resolved[v.key] = this.encryption.decrypt({
        encryptedValue: v.encryptedValue,
        iv: v.iv,
        authTag: v.authTag,
      });
    }

    for (const v of envSpecific) {
      resolved[v.key] = this.encryption.decrypt({
        encryptedValue: v.encryptedValue,
        iv: v.iv,
        authTag: v.authTag,
      });
    }

    return resolved;
  }

  private async logAction(
    action: string,
    targetKey: string,
    userId: string,
    projectId: string,
  ): Promise<void> {
    try {
      await this.auditLog.create({ action, targetKey, userId, projectId });
    } catch (err) {
      // Audit logging should never block the main operation
      log.error('Failed to write audit log', { action, error: String(err) });
    }
  }

  private toResponse(envVar: {
    id: string;
    key: string;
    environment: EnvEnvironment;
    createdAt: Date;
    updatedAt: Date;
  }): EnvVarResponse {
    return {
      id: envVar.id,
      key: envVar.key,
      environment: envVar.environment,
      createdAt: envVar.createdAt,
      updatedAt: envVar.updatedAt,
    };
  }
}

export const envVarService = new EnvironmentVariableService(
  envVarRepository,
  encryptionService,
  auditLogRepository,
);
