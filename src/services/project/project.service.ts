import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { dockerService, type DockerService } from '@/services/docker';
import { NotFoundError } from '@/lib/errors';
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
    return this.projectRepo.create(userId, dto);
  }

  async update(id: string, userId: string, dto: UpdateProjectDto): Promise<Project> {
    await this.getById(id, userId);
    return this.projectRepo.update(id, dto);
  }

  async delete(id: string, userId: string): Promise<void> {
    const project = await this.getById(id, userId);
    await this.docker.stopAndRemoveContainer(`dropdeploy-${project.slug}`);
    await this.projectRepo.delete(id);
  }
}

export const projectService = new ProjectService(projectRepository, dockerService);
