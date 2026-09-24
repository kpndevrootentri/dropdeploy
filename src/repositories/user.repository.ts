import type { User, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  create(data: { email: string; passwordHash: string; role?: UserRole; mustResetPassword?: boolean }): Promise<User>;
  updateRole(id: string, role: UserRole): Promise<User>;
  updateQuota(id: string, quota: number): Promise<User>;
  /** Custom domains the user may claim across all their projects. */
  updateDomainQuota(id: string, quota: number): Promise<User>;
  setPassword(id: string, passwordHash: string, mustResetPassword?: boolean): Promise<User>;
  delete(id: string): Promise<void>;
}

export class UserRepository implements IUserRepository {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findAll(): Promise<User[]> {
    return prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async create(data: { email: string; passwordHash: string; role?: UserRole; mustResetPassword?: boolean }): Promise<User> {
    return prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        ...(data.role ? { role: data.role } : {}),
        ...(data.mustResetPassword !== undefined ? { mustResetPassword: data.mustResetPassword } : {}),
      },
    });
  }

  /** Also revokes the user's sessions, so a demotion takes effect at once. */
  async updateRole(id: string, role: UserRole): Promise<User> {
    return prisma.user.update({ where: { id }, data: { role, tokenVersion: { increment: 1 } } });
  }

  async updateQuota(id: string, quota: number): Promise<User> {
    return prisma.user.update({ where: { id }, data: { projectQuota: quota } });
  }

  async updateDomainQuota(id: string, quota: number): Promise<User> {
    return prisma.user.update({ where: { id }, data: { domainQuota: quota } });
  }

  /**
   * Also revokes every outstanding session and CLI token — a stolen token must
   * not outlive the password change meant to lock its thief out.
   */
  async setPassword(id: string, passwordHash: string, mustResetPassword = false): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { passwordHash, mustResetPassword, tokenVersion: { increment: 1 } },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.user.delete({ where: { id } });
  }
}

export const userRepository = new UserRepository();
