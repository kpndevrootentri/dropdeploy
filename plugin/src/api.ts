import type { Credentials } from './auth.js';

export interface Project {
  id: string;
  name: string;
  slug: string;
  type: string;
  githubUrl: string | null;
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

export class DropDeployApi {
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
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? `API ${res.status} on ${method} ${path}`);
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
