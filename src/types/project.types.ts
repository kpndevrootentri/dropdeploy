/**
 * Project domain types (PRD-aligned).
 */

export type SourceType = 'GITHUB' | 'GITLAB' | 'UPLOAD';

export type ProjectType = 'STATIC' | 'NODEJS' | 'NEXTJS' | 'DJANGO' | 'REACT' | 'FASTAPI' | 'FLASK' | 'VUE' | 'SVELTE' | 'GO' | 'RUST' | 'JAVA' | 'WORDPRESS';

/**
 * A fresh WordPress site hands admin to whoever opens its install wizard
 * first, so it starts behind the private-URL gate. The owner installs it,
 * then makes it public.
 */
export function startsPrivate(type: ProjectType | undefined): boolean {
  return type === 'WORDPRESS';
}

export interface CreateProjectDto {
  name: string;
  description?: string;
  source: SourceType;
  githubUrl?: string;
  type?: ProjectType;
  branch?: string;
  useStaticHosting?: boolean;
  isPrivate?: boolean;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string | null;
  type?: ProjectType;
  branch?: string;
  isPrivate?: boolean;
  useStaticHosting?: boolean;
}

export interface ProjectWithLatestDeployment {
  id: string;
  name: string;
  slug: string;
  source: SourceType;
  githubUrl: string | null;
  type: ProjectType;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  deployments?: Array<{
    id: string;
    status: string;
    subdomain: string | null;
    createdAt: Date;
  }>;
}
