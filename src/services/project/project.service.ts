import * as fs from 'fs';
import * as path from 'path';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { userRepository, type IUserRepository } from '@/repositories/user.repository';
import { dockerService, type DockerService } from '@/services/docker';
import { getConfig } from '@/lib/config';
import { NotFoundError, QuotaExceededError } from '@/lib/errors';
import type { CreateProjectDto, UpdateProjectDto } from '@/types/project.types';
import type { Project } from '@prisma/client';

export type ProjectWithDeployments = Project & {
  deployments: Array<{
    id: string;
    status: string;
    subdomain: string | null;
    containerPort: number | null;
    createdAt: Date;
  }>;
};

export class ProjectService {
  constructor(
    private readonly projectRepo: IProjectRepository,
    private readonly docker: DockerService,
    private readonly userRepo: IUserRepository,
  ) {}

  async getById(id: string, userId: string): Promise<Project> {
    const project = await this.projectRepo.findById(id);
    if (!project) {
      throw new NotFoundError('Project');
    }
    if (project.userId !== userId) {
      throw new NotFoundError('Project');
    }
    return project;
  }

  async getByIdWithDeployments(
    id: string,
    userId: string
  ): Promise<ProjectWithDeployments> {
    const project = await this.projectRepo.findByIdWithDeployments(id);
    if (!project) {
      throw new NotFoundError('Project');
    }
    if (project.userId !== userId) {
      throw new NotFoundError('Project');
    }
    return project as ProjectWithDeployments;
  }

  async listByUser(userId: string): Promise<Project[]> {
    return this.projectRepo.findByUserId(userId);
  }

  async create(userId: string, dto: CreateProjectDto): Promise<Project> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');

    const existing = await this.projectRepo.findByUserId(userId);
    if (existing.length >= user.projectQuota) {
      throw new QuotaExceededError(
        `You have reached your project limit of ${user.projectQuota}. Contact an admin to increase your quota.`
      );
    }

    return this.projectRepo.create(userId, dto);
  }

  async update(id: string, userId: string, dto: UpdateProjectDto): Promise<Project> {
    await this.getById(id, userId);
    return this.projectRepo.update(id, dto);
  }

  async delete(id: string, userId: string): Promise<void> {
    const project = await this.getById(id, userId);
    await this.docker.stopAndRemoveContainer(`dropdeploy-${project.slug}`);
    const { STATIC_SERVE_DIR } = getConfig();
    await fs.promises.rm(path.join(STATIC_SERVE_DIR, project.slug), { recursive: true, force: true }).catch(() => {});
    await this.projectRepo.delete(id);
  }
}

export const projectService = new ProjectService(projectRepository, dockerService, userRepository);
