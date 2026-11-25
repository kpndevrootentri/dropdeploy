// `entrify mcp`: a stdio MCP server (JSON-RPC 2.0, one message per line) with one tool that publishes HTML.
// stdout carries only protocol messages.
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { readCredentials, PRODUCTION_URL } from './auth.js';
import { EntrifyApi } from './api.js';
import { bundleHtml, deploySite } from './upload.js';
import { CliError, EXIT, cliName } from './util.js';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Deliberately no path input: the model must not be able to publish files from disk.
const TOOL = {
  name: 'deploy_to_entrify',
  description:
    'Publish an HTML page to Entrify as a live website and get its URL. Put the complete page in `html` (it becomes index.html). ' +
    'Inline CSS and JavaScript in the page, or pass them in `files` (e.g. {"style.css": "...", "js/app.js": "..."}) and link them by relative path. ' +
    'Images must be https:// URLs or data: URIs. A new `name` creates a new site. ' +
    'If the call fails with NAME_TAKEN, ask the user whether to update that site (call again with project_id set to its slug) or to choose another name. ' +
    'To publish a new version of a site made earlier in this conversation, pass its slug as project_id. Always give the user the URL.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Site name: 3-50 letters, numbers, spaces, - or _.' },
      html: { type: 'string', description: 'The full HTML page.' },
      files: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Extra text files (CSS, JS, JSON, SVG...) by relative path, e.g. {"css/style.css": "body { ... }"}.',
      },
      project_id: { type: 'string', description: 'Slug or id of an existing uploaded site, to publish a new version of it.' },
    },
    required: ['name', 'html'],
  },
};

const failed = (text: string) => ({ isError: true, content: [{ type: 'text', text }] });

async function deployTool(args: Record<string, unknown>) {
  const creds = await readCredentials();
  if (!creds) {
    return failed(`Not logged in to Entrify. Set ENTRIFY_TOKEN (and ENTRIFY_URL if not ${PRODUCTION_URL}) in the MCP server env, or run ${cliName()} auth login in a terminal.`);
  }
  try {
    const { name, html, files, project_id } = args;
    const hasValidFiles = files === undefined || (typeof files === 'object' && files !== null && !Array.isArray(files));
    if (typeof name !== 'string' || !hasValidFiles || (project_id !== undefined && typeof project_id !== 'string')) {
      throw new CliError('name and html must be text, files an object of path to text, and project_id text.', 'INVALID_INPUT', EXIT.NEEDS_INPUT);
    }
    // Safe: bundleHtml checks at runtime that html and every file value are strings.
    const bundle = bundleHtml(html as string, files as Record<string, string> | undefined);
    const out = await deploySite(new EntrifyApi(creds), bundle, { name, projectId: project_id || undefined });
    const what = out.created ? 'new site' : `new version of ${out.project?.slug}`;
    return {
      content: [{ type: 'text', text: `Deployed to ${out.url} (${what}). Files: ${out.files.join(', ')}` }],
      structuredContent: { url: out.url, project: out.project, created: out.created, files: out.files },
    };
  } catch (err) {
    const code = err instanceof CliError ? err.code : 'ERROR';
    return failed(`Entrify deploy failed (${code}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

type Reply = { result: unknown } | { error: { code: number; message: string } };

async function handle(method: unknown, params: Record<string, unknown> | undefined, version: string): Promise<Reply> {
  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return {
      result: {
        protocolVersion: typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'entrify', version },
      },
    };
  }
  if (method === 'ping') return { result: {} };
  if (method === 'tools/list') return { result: { tools: [TOOL] } };
  if (method === 'tools/call') {
    if (params?.name !== TOOL.name) return { error: { code: -32602, message: `Unknown tool: ${String(params?.name)}` } };
    // Safe: deployTool checks each argument's type before using it.
    return { result: await deployTool((params.arguments ?? {}) as Record<string, unknown>) };
  }
  return { error: { code: -32601, message: `Method not found: ${String(method)}` } };
}

/**
 * Serves MCP over stdio until stdin closes.
 * stdin `{"jsonrpc":"2.0","id":1,"method":"ping"}` → stdout `{"jsonrpc":"2.0","id":1,"result":{}}`
 */
export async function runMcpServer(): Promise<void> {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const send = (msg: object) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let msg: { id?: string | number | null; method?: unknown; params?: Record<string, unknown> } | null;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    // Batches (arrays) and other non-objects are not supported: say so instead of leaving the sender waiting.
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
      send({ id: null, error: { code: -32600, message: 'Invalid Request' } });
      continue;
    }
    const id = msg.id;
    if (id === undefined) continue; // A notification: never answered.
    // Not awaited, so a ping is answered while an upload is still running.
    void handle(msg.method, msg.params, version).then((reply) => send({ id, ...reply }));
  }
}
