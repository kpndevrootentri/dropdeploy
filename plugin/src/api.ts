import type { Credentials } from './auth.js';
import { CliError, EXIT, apiErrorMessage, cliName } from './util.js';

export interface Project {
  id: string;
  name: string;
  slug: string;
  type: string;
  /** GITHUB, GITLAB or UPLOAD. */
  source?: string;
  githubUrl: string | null;
  /** The branch the server builds, whatever is checked out locally. */
  branch?: string;
  deployments?: Array<{
    id: string;
    status: string;
    subdomain: string | null;
    createdAt: string;
  }>;
}

export interface DeployResult {
  deploymentId: string;
  message: string;
  queued: boolean;
}

export interface DeployStatus {
  status: string;
  buildLog: string | null;
  commitHash: string | null;
  subdomain: string | null;
}

export interface Deployment {
  id: string;
  status: string;
  subdomain: string | null;
  commitHash?: string | null;
  createdAt: string;
}

export interface EnvVar {
  id: string;
  key: string;
  environment: string;
}

export interface DetectResult {
  type: string;
  confidence: 'high' | 'medium' | 'low';
  hint: string;
}

export type SseEvent =
  | { type: 'line'; text: string }
  | { type: 'existing'; log: string }
  | { type: 'done' };

function isSseEvent(x: unknown): x is SseEvent {
  if (typeof x !== 'object' || x === null) return false;
  const t = (x as Record<string, unknown>).type;
  return t === 'line' || t === 'existing' || t === 'done';
}

export class EntrifyApi {
  private base: string;
  private token: string;

  constructor(creds: Credentials) {
    this.base = creds.apiUrl;
    this.token = creds.token;
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: this.authHeaders(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (res.status === 401) {
        // CLI logins are JWTs that expire (7 days by default).
        throw new CliError(
          `Your login has expired or is no longer valid. Run: ${cliName()} auth login`,
          'AUTH_EXPIRED',
          EXIT.AUTH,
        );
      }
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        throw new CliError(apiErrorMessage(body, `API ${res.status} on ${method} ${path}`), `HTTP_${res.status}`);
      }
      const payload = (await res.json()) as { data: T };
      return payload.data;
    } finally {
      clearTimeout(timer);
    }
  }

  async listProjects(): Promise<Project[]> {
    return this.json<Project[]>('GET', '/api/projects');
  }

  async detectType(repoUrl: string, branch: string): Promise<DetectResult> {
    return this.json<DetectResult>('POST', '/api/detect-type', { repoUrl, branch });
  }

  async triggerDeploy(projectId: string): Promise<DeployResult> {
    return this.json<DeployResult>('POST', `/api/projects/${projectId}/deploy`);
  }

  async createProject(dto: { name: string; source: 'GITHUB' | 'GITLAB'; githubUrl: string; type?: string; branch?: string }): Promise<Project> {
    return this.json<Project>('POST', '/api/projects', dto);
  }

  /** Newest first. */
  async listDeployments(projectId: string, limit = 20): Promise<Deployment[]> {
    const data = await this.json<{ deployments: Deployment[] }>('GET', `/api/projects/${projectId}/deployments?limit=${limit}`);
    return data.deployments;
  }

  /** Re-runs an earlier deployment; resolves to the new deployment's id. */
  async rollback(projectId: string, deploymentId: string): Promise<{ deploymentId: string; queued: boolean }> {
    return this.json('POST', `/api/projects/${projectId}/deployments/${deploymentId}/rollback`);
  }

  async cancelDeployment(projectId: string, deploymentId: string): Promise<void> {
    await this.json('POST', `/api/projects/${projectId}/deployments/${deploymentId}/cancel`);
  }

  /** Keys only: the API never returns values. */
  async listEnv(projectId: string): Promise<EnvVar[]> {
    return this.json<EnvVar[]>('GET', `/api/projects/${projectId}/env-vars`);
  }

  async createEnv(projectId: string, key: string, value: string): Promise<void> {
    await this.json('POST', `/api/projects/${projectId}/env-vars`, { key, value });
  }

  async updateEnv(projectId: string, varId: string, value: string): Promise<void> {
    await this.json('PUT', `/api/projects/${projectId}/env-vars/${varId}`, { value });
  }

  async deleteEnv(projectId: string, varId: string): Promise<void> {
    await this.json('DELETE', `/api/projects/${projectId}/env-vars/${varId}`);
  }

  async getDeploymentStatus(
    projectId: string,
    deploymentId: string,
  ): Promise<DeployStatus> {
    return this.json<DeployStatus>(
      'GET',
      `/api/projects/${projectId}/deployments/${deploymentId}/logs`,
    );
  }

  async *streamLogs(
    projectId: string,
    deploymentId: string,
  ): AsyncGenerator<SseEvent> {
    const res = await fetch(
      `${this.base}/api/projects/${projectId}/deployments/${deploymentId}/logs/stream`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (!res.ok || !res.body) {
      throw new Error(`Stream connect failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          try {
            const raw = JSON.parse(chunk.slice(6)) as unknown;
            if (!isSseEvent(raw)) continue;
            yield raw;
            if (raw.type === 'done') return;
          } catch {
            // malformed SSE chunk — skip
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }
}
