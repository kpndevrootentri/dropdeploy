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

/** How many projects the user may have, from GET /api/projects. */
export interface Quota {
  used: number;
  limit: number;
  available: number;
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

  /** The `data` of an API response: `{ success: true, data: [...] }` → `[...]`. */
  private async json<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    return (await this.request<{ data: T }>(method, path, body, timeoutMs)).data;
  }

  /** The whole parsed response body, for the few endpoints that return more than `data`. */
  private async request<P>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<P> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const isForm = body instanceof FormData;
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        // fetch sets the multipart Content-Type (with its boundary) for FormData.
        headers: isForm ? { Authorization: `Bearer ${this.token}` } : this.authHeaders(),
        body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      }).catch((err: unknown) => {
        const cause = (err as { cause?: { code?: unknown; message?: unknown } }).cause;
        const reason = String(cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : err));
        // A token holding CR/LF/NUL makes fetch quote the whole Authorization header; keep it out of the message.
        throw new CliError(`Could not reach ${this.base}: ${this.token ? reason.split(this.token).join('<token>') : reason}`, 'NETWORK');
      });
      if (res.status === 401) {
        // CLI logins are JWTs that expire (7 days by default).
        throw new CliError(
          process.env.ENTRIFY_TOKEN ?? process.env.DROPDEPLOY_TOKEN
            ? `ENTRIFY_TOKEN has expired or is not valid. Set a new one: run ${cliName()} auth login, then export ENTRIFY_TOKEN=$(${cliName()} auth token). If it is in Claude Desktop's config, update it there and restart Claude Desktop.`
            : `Your login has expired or is no longer valid. Run: ${cliName()} auth login`,
          'AUTH_EXPIRED',
          EXIT.AUTH,
        );
      }
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        throw new CliError(apiErrorMessage(body, `API ${res.status} on ${method} ${path}`), `HTTP_${res.status}`);
      }
      return (await res.json()) as P;
    } catch (err) {
      // The timer can also fire while the response body is still arriving.
      if (controller.signal.aborted) throw new CliError(`Request to ${this.base} timed out after ${timeoutMs / 1000} s`, 'TIMEOUT');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Publishes an .html or .zip file as a new static site, or as a new version of an uploaded one.
   * `upload(bytes, 'site.zip', { name: 'My Site' })` → `{ project, deployment, url: 'https://my-site.entrify.site' }`
   */
  async upload(
    file: Uint8Array,
    filename: string,
    target: { name: string } | { projectId: string },
  ): Promise<{ project: Project; deployment: { id: string; status: string }; url: string }> {
    const form = new FormData();
    // Type-only cast: the bytes never live in a SharedArrayBuffer.
    form.append('file', new Blob([file as Uint8Array<ArrayBuffer>]), filename);
    if ('name' in target) form.append('name', target.name);
    const path = 'projectId' in target ? `/api/projects/${target.projectId}/upload` : '/api/projects/upload';
    // 2 minutes plus 1 s per 100 KB (about 0.8 Mbit/s), so a 50 MB upload gets about 11 minutes.
    return this.json('POST', path, form, 120_000 + Math.ceil(file.length / 100_000) * 1000);
  }

  async listProjects(): Promise<Project[]> {
    return this.json<Project[]>('GET', '/api/projects');
  }

  /** Your projects and how many more you may create: `{ projects: [...], quota: { used: 4, limit: 5, available: 1 } }`. */
  async listProjectsWithQuota(): Promise<{ projects: Project[]; quota: Quota | null }> {
    const { data, quota } = await this.request<{ data: Project[]; quota?: Quota }>('GET', '/api/projects');
    return { projects: data, quota: quota ?? null };
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
