import type { EnvironmentVariable, EnvEnvironment } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface CreateEnvVarData {
  key: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  environment: EnvEnvironment;
}

export interface UpdateEnvVarData {
  encryptedValue: string;
  iv: string;
  authTag: string;
}

export interface IEnvironmentVariableRepository {
  findByProjectId(projectId: string): Promise<EnvironmentVariable[]>;
  findByProjectIdAndEnvironment(
    projectId: string,
    environment: EnvEnvironment,
  ): Promise<EnvironmentVariable[]>;
  findById(id: string): Promise<EnvironmentVariable | null>;
  findByProjectKeyEnv(
    projectId: string,
    key: string,
    environment: EnvEnvironment,
  ): Promise<EnvironmentVariable | null>;
  create(projectId: string, data: CreateEnvVarData): Promise<EnvironmentVariable>;
  update(id: string, data: UpdateEnvVarData): Promise<EnvironmentVariable>;
  delete(id: string): Promise<void>;
  deleteByProjectId(projectId: string): Promise<void>;
}

export class EnvironmentVariableRepository implements IEnvironmentVariableRepository {
  async findByProjectId(projectId: string): Promise<EnvironmentVariable[]> {
    return prisma.environmentVariable.findMany({
      where: { projectId },
      orderBy: { key: 'asc' },
    });
  }

  async findByProjectIdAndEnvironment(
    projectId: string,
    environment: EnvEnvironment,
  ): Promise<EnvironmentVariable[]> {
    return prisma.environmentVariable.findMany({
      where: {
        projectId,
        environment: { in: [environment, 'ALL'] },
      },
      orderBy: { key: 'asc' },
    });
  }

  async findById(id: string): Promise<EnvironmentVariable | null> {
    return prisma.environmentVariable.findUnique({ where: { id } });
  }

  async findByProjectKeyEnv(
    projectId: string,
    key: string,
    environment: EnvEnvironment,
  ): Promise<EnvironmentVariable | null> {
    return prisma.environmentVariable.findUnique({
      where: { projectId_key_environment: { projectId, key, environment } },
    });
  }

  async create(projectId: string, data: CreateEnvVarData): Promise<EnvironmentVariable> {
    return prisma.environmentVariable.create({
      data: { projectId, ...data },
    });
  }

  async update(id: string, data: UpdateEnvVarData): Promise<EnvironmentVariable> {
    return prisma.environmentVariable.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.environmentVariable.delete({ where: { id } });
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    await prisma.environmentVariable.deleteMany({ where: { projectId } });
  }
}

export const envVarRepository = new EnvironmentVariableRepository();
