import type { EnvEnvironment } from '@prisma/client';

export interface CreateEnvVarDto {
  key: string;
  value: string;
  environment?: EnvEnvironment;
}

export interface UpdateEnvVarDto {
  value: string;
}

export interface EnvVarResponse {
  id: string;
  key: string;
  environment: EnvEnvironment;
  createdAt: Date;
  updatedAt: Date;
}
