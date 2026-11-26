// `npm run pack:mcpb`: packs the built CLI as a Claude Desktop extension at ../public/downloads/entrify.mcpb.
// Run after `npm run build`; stages only what the server needs to run, so no tests, sources, maps or typings ship.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, '..', 'public', 'downloads', 'entrify.mcpb');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'mcpb', 'manifest.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error(`mcpb/manifest.json is ${manifest.version}; package.json is ${pkg.version}. Make them match.`);

const stage = mkdtempSync(join(tmpdir(), 'entrify-mcpb-'));
try {
  for (const file of ['manifest.json', 'icon.png']) cpSync(join(root, 'mcpb', file), join(stage, file));
  cpSync(join(root, 'package.json'), join(stage, 'package.json')); // "type": "module" and the version the server reports
  // dist is never cleaned, so skip any stale test build in it.
  for (const file of readdirSync(join(root, 'dist'))) {
    if (file.endsWith('.js') && !file.endsWith('.test.js') && file !== 'test-helpers.js') cpSync(join(root, 'dist', file), join(stage, 'dist', file));
  }
  // ponytail: copies direct dependencies only (fflate has none); use `npm install --omit=dev` in the stage if one gains its own.
  for (const dep of Object.keys(pkg.dependencies ?? {})) cpSync(join(root, 'node_modules', dep), join(stage, 'node_modules', dep), { recursive: true });
  execFileSync(process.execPath, [join(root, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js'), 'pack', stage, out], { stdio: 'inherit' });
} finally {
  rmSync(stage, { recursive: true, force: true });
}
