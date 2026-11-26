// `entrify mcp`: a stdio MCP server (JSON-RPC 2.0, one message per line) with tools that publish HTML and list your sites.
// stdout carries only protocol messages.
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { readCredentials, PRODUCTION_URL } from './auth.js';
import { EntrifyApi } from './api.js';
import { bundleHtml, deploySite } from './upload.js';
import { CliError, EXIT, buildDeployUrl, cliName } from './util.js';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'Entrify publishes HTML pages as live websites. Call list_my_sites first when the user may mean a site they already have. ' +
  'Choose a short descriptive name. Put the whole page in html, with CSS and JavaScript inline or passed in files. ' +
  'Images must be https:// URLs or data: URIs. Never update an existing site (project_id) without the user\'s OK. Always give the user the URL.';

// Deliberately no path input: the model must not be able to publish files from disk.
const DEPLOY_TOOL = {
  name: 'deploy_to_entrify',
  title: 'Deploy to Entrify',
  description:
    'Publish an HTML page to Entrify as a live website and get its URL. Put the complete page in `html` (it becomes index.html). ' +
    'Inline CSS and JavaScript in the page, or pass them in `files` (e.g. {"style.css": "...", "js/app.js": "..."}) and link them by relative path. ' +
    'Images must be https:// URLs or data: URIs. A new `name` creates a new site. ' +
    'If the call fails with NAME_TAKEN, ask the user whether to update that site (call again with project_id set to its slug) or to choose another name. ' +
    'To publish a new version of an existing site, pass its slug (from list_my_sites) as project_id, only with the user\'s OK. Always give the user the URL.',
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
  // Destructive: with project_id it replaces the live version of a site.
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
};

const LIST_TOOL = {
  name: 'list_my_sites',
  title: 'List my Entrify sites',
  description:
    'List your Entrify sites (name, slug, URL, source) and how many new sites you can still create. ' +
    'Call it before deploying when the user may mean an existing site. Only sites with source UPLOAD can be updated with deploy_to_entrify.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true, openWorldHint: true },
};

const failed = (text: string) => ({ isError: true, content: [{ type: 'text', text }] });

const needsToken = (apiUrl: string) =>
  `Entrify needs an API token. Create one at ${apiUrl}/settings#api-tokens, then paste it into the Entrify extension in Claude Desktop (Settings > Extensions, or Settings > Desktop app > Manage next to Extensions). ` +
  `In a terminal, run ${cliName()} auth login instead.`;

/** The CLI's messages name its flags; these name the tool's arguments instead. Undefined keeps the CLI message. */
function toolMessage(err: CliError, args: Record<string, unknown>, apiUrl: string): string | undefined {
  const { name, project_id } = args;
  const slug = (err.details.project as { slug?: string } | undefined)?.slug;
  switch (err.code) {
    case 'AUTH_EXPIRED':
      return `The Entrify token has expired or is not valid. ${needsToken(apiUrl)}`;
    case 'NAME_TAKEN':
      return err.details.source === 'UPLOAD'
        ? `A site named "${String(name)}" already exists (${slug}). Ask the user whether to update it (call deploy_to_entrify again with project_id "${slug}") or choose another name.`
        : `A site named "${String(name)}" already exists (${slug}) and is deployed from git, so it cannot be updated here. Choose another name.`;
    case 'PROJECT_NOT_FOUND':
      return `No site with id or slug "${String(project_id)}". Call list_my_sites for the right slug, or leave out project_id to create a new site.`;
    case 'NOT_UPLOAD_PROJECT':
      return `"${String(project_id)}" is deployed from git, so deploy_to_entrify cannot update it. Leave out project_id and choose another name to create a new site.`;
    case 'QUOTA_EXCEEDED':
      return 'No new site can be created: all of the user\'s Entrify projects are in use. Ask the user to delete one in the Entrify dashboard, or to update one of their uploaded sites (list_my_sites, then project_id).';
    case 'INVALID_NAME':
      return `Invalid name "${String(name)}": choose a name of 3 to 50 letters, numbers, spaces, - or _.`;
  }
  return undefined;
}

async function deployTool(api: EntrifyApi, args: Record<string, unknown>) {
  const { name, html, files, project_id } = args;
  const hasValidFiles = files === undefined || (typeof files === 'object' && files !== null && !Array.isArray(files));
  if (typeof name !== 'string' || !hasValidFiles || (project_id !== undefined && typeof project_id !== 'string')) {
    throw new CliError('name and html must be text, files an object of path to text, and project_id text.', 'INVALID_INPUT', EXIT.NEEDS_INPUT);
  }
  // Safe: bundleHtml checks at runtime that html and every file value are strings.
  const bundle = bundleHtml(html as string, files as Record<string, string> | undefined);
  const out = await deploySite(api, bundle, { name, projectId: project_id || undefined });
  const what = out.created ? 'new site' : `new version of ${out.project?.slug}`;
  return {
    content: [{ type: 'text', text: `Deployed to ${out.url} (${what}). Files: ${out.files.join(', ')}` }],
    structuredContent: { url: out.url, project: out.project, created: out.created, files: out.files },
  };
}

async function listSitesTool(api: EntrifyApi, apiUrl: string) {
  const { projects, quota } = await api.listProjectsWithQuota();
  const sites = projects.map((p) => ({ name: p.name, slug: p.slug, url: buildDeployUrl(apiUrl, p.slug), source: p.source, updatedAt: p.updatedAt }));
  const lines = sites.length
    ? sites.map((s) => `- ${s.name} (slug ${s.slug}, ${s.source ?? 'unknown source'}): ${s.url}`)
    : ['No sites yet.'];
  if (quota) lines.push(`${quota.available} new site(s) left (${quota.used} of ${quota.limit} used).`);
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { sites, quota } };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const creds = await readCredentials();
  if (!creds) return failed(needsToken(process.env.ENTRIFY_URL || PRODUCTION_URL));
  const api = new EntrifyApi(creds);
  try {
    return name === LIST_TOOL.name ? await listSitesTool(api, creds.apiUrl) : await deployTool(api, args);
  } catch (err) {
    const code = err instanceof CliError ? err.code : 'ERROR';
    const message = (err instanceof CliError && toolMessage(err, args, creds.apiUrl)) || (err instanceof Error ? err.message : String(err));
    return failed(`Entrify ${name === LIST_TOOL.name ? 'list' : 'deploy'} failed (${code}): ${message}`);
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
        instructions: INSTRUCTIONS,
      },
    };
  }
  if (method === 'ping') return { result: {} };
  if (method === 'tools/list') return { result: { tools: [LIST_TOOL, DEPLOY_TOOL] } };
  if (method === 'tools/call') {
    const name = params?.name;
    if (name !== LIST_TOOL.name && name !== DEPLOY_TOOL.name) return { error: { code: -32602, message: `Unknown tool: ${String(name)}` } };
    // Safe: deployTool checks each argument's type before using it.
    return { result: await callTool(name, (params?.arguments ?? {}) as Record<string, unknown>) };
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
