import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import type { User, UserRole, Project } from '@prisma/client';
import type { IUserRepository } from '@/repositories/user.repository';
import { userRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import { projectRepository } from '@/repositories/project.repository';
import { dockerService, type DockerService } from '@/services/docker';
import { deploymentService } from '@/services/deployment';
import { getConfig } from '@/lib/config';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/errors';

const SALT_ROUNDS = 10;

/** One row of the admin user table. Deliberately excludes `passwordHash`. */
export interface AdminUserRow {
  id: string;
  email: string;
  role: UserRole;
  projectQuota: number;
  domainQuota: number;
  mustResetPassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { projects: number; customDomains: number };
}

export class AdminService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly docker: DockerService,
  ) {}

  /**
   * Users for the admin table, with both quotas and both usage counts.
   *
   * NOTE the explicit `select`. This list is serialised straight to the admin
   * page, and a bare `findMany` returns every scalar column — including
   * `passwordHash`. Shipping every user's bcrypt hash to a browser is
   * Security Assessment finding #23; the select is what prevents it, so do not
   * replace it with `include` for convenience.
   *
   * Custom domains hang off Project, not User, so Prisma's `_count` cannot
   * reach them in one query. At this scale a second query and a tally is
   * cheaper and clearer than the join gymnastics that would avoid it.
   */
  async listAllUsers(): Promise<AdminUserRow[]> {
    const { prisma } = await import('@/lib/prisma');

    const [users, domains] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          role: true,
          projectQuota: true,
          domainQuota: true,
          mustResetPassword: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { projects: true } },
        },
      }),
      prisma.customDomain.findMany({ select: { project: { select: { userId: true } } } }),
    ]);

    const domainsPerUser = new Map<string, number>();
    for (const { project } of domains) {
      domainsPerUser.set(project.userId, (domainsPerUser.get(project.userId) ?? 0) + 1);
    }

    return users.map((user) => ({
      ...user,
      _count: { projects: user._count.projects, customDomains: domainsPerUser.get(user.id) ?? 0 },
    }));
  }

  async changeUserRole(userId: string, role: UserRole, actorId: string): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');

    // If demoting a contributor, ensure at least one other contributor remains
    if (role !== 'CONTRIBUTOR' && user.role === 'CONTRIBUTOR') {
      const { prisma } = await import('@/lib/prisma');
      const contributorCount = await prisma.user.count({ where: { role: 'CONTRIBUTOR' } });
      if (contributorCount <= 1) {
        throw new ConflictError('Cannot remove the last CONTRIBUTOR');
      }
    }

    return this.userRepo.updateRole(userId, role);
  }

  async deleteUser(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new ValidationError('Cannot delete your own account');
    }
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');

    if (user.role === 'CONTRIBUTOR') {
      const { prisma } = await import('@/lib/prisma');
      const contributorCount = await prisma.user.count({ where: { role: 'CONTRIBUTOR' } });
      if (contributorCount <= 1) {
        throw new ConflictError('Cannot delete the last CONTRIBUTOR');
      }
    }

    await this.userRepo.delete(userId);
  }

  async createUser(email: string, password: string): Promise<User> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) throw new ConflictError('Email already registered');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    return this.userRepo.create({ email, passwordHash, role: 'USER', mustResetPassword: true });
  }

  async listAllProjects(): Promise<(Project & { user: { id: string; email: string; role: string }; deployments: { id: string; status: string; createdAt: Date }[] })[]> {
    return this.projectRepo.findAll();
  }

  async transferOwnership(projectId: string, newOwnerId: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    const newOwner = await this.userRepo.findById(newOwnerId);
    if (!newOwner) throw new NotFoundError('User');
    return this.projectRepo.transferOwner(projectId, newOwnerId);
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.stopAndRemoveContainer(`dropdeploy-${project.slug}`);
    const { STATIC_SERVE_DIR } = getConfig();
    await fs.promises.rm(path.join(STATIC_SERVE_DIR, project.slug), { recursive: true, force: true }).catch(() => {});
    await this.projectRepo.delete(projectId);
  }

  async getProjectContainerInfo(projectId: string): Promise<ReturnType<DockerService['getContainerInfo']>> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    return this.docker.getContainerInfo(`dropdeploy-${project.slug}`);
  }

  async stopContainer(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.stopContainer(`dropdeploy-${project.slug}`);
  }

  async restartContainer(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.restartContainer(`dropdeploy-${project.slug}`);
  }

  async updateUserQuota(userId: string, quota: number): Promise<User> {
    if (quota < 0) throw new ValidationError('Quota must be a non-negative integer');
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    return this.userRepo.updateQuota(userId, quota);
  }

  /** Custom-domain allowance. Zero means the user cannot add any. */
  async updateUserDomainQuota(userId: string, quota: number): Promise<User> {
    if (quota < 0) throw new ValidationError('Quota must be a non-negative integer');
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    return this.userRepo.updateDomainQuota(userId, quota);
  }

  async resetUserPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    if (newPassword.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.userRepo.setPassword(userId, passwordHash);
  }

  async forceRedeploy(projectId: string, actorId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    // Bypass ownership check by delegating to deploymentService with the project's actual owner
    await deploymentService.createDeployment(projectId, project.userId);
  }
}

export const adminService = new AdminService(userRepository, projectRepository, dockerService);
