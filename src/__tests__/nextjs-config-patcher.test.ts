import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { patchNextConfig } from '@/services/docker/nextjs-config-patcher';

const PATCHED = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: { cpus: 1, workerThreads: false },
};

let dir: string;
beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'next-config-'));
});
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

const read = (file: string) => fs.promises.readFile(path.join(dir, file), 'utf8');

/** The config a CommonJS next.config.js exports. */
async function loadCjs(file = 'next.config.js'): Promise<unknown> {
  const mod: { exports: unknown } = { exports: {} };
  new Function('module', 'exports', await read(file))(mod, mod.exports);
  return mod.exports;
}

const USER_CJS = "module.exports = { reactStrictMode: true, basePath: '/docs', output: 'standalone', eslint: { dirs: ['src'] } };\n";

it("keeps the user's CommonJS config and adds the build flags, clearing output and basePath", async () => {
  await fs.promises.writeFile(path.join(dir, 'next.config.js'), USER_CJS);
  await patchNextConfig(dir);
  const config = await loadCjs();
  expect(config).toEqual({ ...PATCHED, reactStrictMode: true, basePath: '', eslint: { dirs: ['src'], ignoreDuringBuilds: true } });
  expect(config).toHaveProperty('output', undefined);
});

it("sets output 'export' for static hosting", async () => {
  await fs.promises.writeFile(path.join(dir, 'next.config.js'), USER_CJS);
  await patchNextConfig(dir, { addStaticExport: true });
  expect(await loadCjs()).toMatchObject({ output: 'export', basePath: '' });
});

it('patches an ESM config before its `export default <name>`', async () => {
  await fs.promises.writeFile(path.join(dir, 'next.config.mjs'), 'const nextConfig = { images: { unoptimized: true } };\nexport default nextConfig;\n');
  await patchNextConfig(dir);
  const content = await read('next.config.mjs');
  expect(content).toMatch(/\/\/ dropdeploy-patch\nexport default nextConfig;\n$/);
  // Everything before the export runs; what follows it would not.
  expect(new Function(content.replace('export default', 'return'))()).toEqual({ ...PATCHED, images: { unoptimized: true }, basePath: '' });
});

it('still patches a config that already sets ignoreDuringBuilds itself', async () => {
  await fs.promises.writeFile(path.join(dir, 'next.config.js'), "module.exports = { basePath: '/docs', eslint: { ignoreDuringBuilds: true } };\n");
  await patchNextConfig(dir, { addStaticExport: true });
  expect(await loadCjs()).toMatchObject({ ...PATCHED, output: 'export', basePath: '' });
});

it('leaves an already patched config alone', async () => {
  await fs.promises.writeFile(path.join(dir, 'next.config.js'), USER_CJS);
  await patchNextConfig(dir);
  const once = await read('next.config.js');
  await patchNextConfig(dir, { addStaticExport: true });
  expect(await read('next.config.js')).toBe(once);
});

it('creates next.config.js when the project has none', async () => {
  await patchNextConfig(dir, { addStaticExport: true });
  expect(await loadCjs()).toEqual({ ...PATCHED, output: 'export' });
});
