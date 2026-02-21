import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanPackages } from '@/services/deployment/package-scanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'pkg-scan-test-'));
}

async function writeFile(dir: string, name: string, content: string): Promise<void> {
  await fs.promises.writeFile(path.join(dir, name), content, 'utf-8');
}

async function cleanup(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// package.json (npm)
// ---------------------------------------------------------------------------

describe('scanPackages — package.json', () => {
  let dir: string;
  beforeEach(async () => { dir = await makeTmpDir(); });
  afterEach(async () => { await cleanup(dir); });

  it('returns empty when no manifest files exist', async () => {
    const result = await scanPackages(dir);
    expect(result.blocked).toHaveLength(0);
  });

  it('detects a blocked package in dependencies', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { 'event-stream': '^3.3.6', 'express': '^4.0.0' },
    }));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('event-stream');
    expect(blocked).not.toContain('express');
  });

  it('detects a blocked package in devDependencies', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      devDependencies: { 'eslint-scope': '^3.7.1' },
    }));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('eslint-scope');
  });

  it('detects a blocked package in peerDependencies', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      peerDependencies: { 'node-ipc': '^9.2.1' },
    }));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('node-ipc');
  });

  it('detects a blocked package in optionalDependencies', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      optionalDependencies: { 'ua-parser-js': '^0.7.28' },
    }));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('ua-parser-js');
  });

  it('detects multiple blocked packages across dep fields', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { 'colors': '^1.4.0', 'lodash': '^4.0.0' },
      devDependencies: { 'faker': '^5.5.3' },
    }));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('colors');
    expect(blocked).toContain('faker');
    expect(blocked).not.toContain('lodash');
  });

  it('is case-insensitive for npm package names', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { 'Event-Stream': '^3.3.6' },
    }));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('Event-Stream');
  });

  it('passes a clean project with no blocked packages', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { 'react': '^18.0.0', 'typescript': '^5.0.0' },
    }));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toHaveLength(0);
  });

  it('skips gracefully when package.json is not valid JSON', async () => {
    await writeFile(dir, 'package.json', '{ invalid json }');
    const result = await scanPackages(dir);
    expect(result.blocked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// requirements.txt (pip)
// ---------------------------------------------------------------------------

describe('scanPackages — requirements.txt', () => {
  let dir: string;
  beforeEach(async () => { dir = await makeTmpDir(); });
  afterEach(async () => { await cleanup(dir); });

  it('detects a blocked pip package', async () => {
    await writeFile(dir, 'requirements.txt', 'colourama==1.0.0\nrequests>=2.0\n');
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('colourama');
    expect(blocked).not.toContain('requests');
  });

  it('normalizes underscore vs dash — typing_extensions blocked as typing-extensions', async () => {
    // blocklist has 'typing_extensions'; requirements.txt uses the dash form
    await writeFile(dir, 'requirements.txt', 'typing-extensions>=4.0\n');
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('typing-extensions');
  });

  it('normalizes underscore vs dash — both forms are caught', async () => {
    await writeFile(dir, 'requirements.txt', 'typing_extensions>=4.0\n');
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('typing_extensions');
  });

  it('ignores comment lines and blank lines', async () => {
    await writeFile(dir, 'requirements.txt', [
      '# this is a comment',
      '',
      'requests>=2.0',
    ].join('\n'));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toHaveLength(0);
  });

  it('ignores -r / -i / --index-url flags lines', async () => {
    await writeFile(dir, 'requirements.txt', [
      '-r base.txt',
      '--index-url https://pypi.org/simple',
      'requests>=2.0',
    ].join('\n'));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toHaveLength(0);
  });

  it('strips version specifiers correctly', async () => {
    await writeFile(dir, 'requirements.txt', [
      'colourama>=1.0,<2.0',
      'diango~=3.0',
      'reqests!=1.0',
    ].join('\n'));
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('colourama');
    expect(blocked).toContain('diango');
    expect(blocked).toContain('reqests');
  });

  it('strips extras in brackets', async () => {
    // e.g. "colourama[security]>=1.0"
    await writeFile(dir, 'requirements.txt', 'colourama[security]>=1.0\n');
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('colourama');
  });
});

// ---------------------------------------------------------------------------
// pyproject.toml
// ---------------------------------------------------------------------------

describe('scanPackages — pyproject.toml', () => {
  let dir: string;
  beforeEach(async () => { dir = await makeTmpDir(); });
  afterEach(async () => { await cleanup(dir); });

  it('detects a blocked package in PEP 621 [project] dependencies', async () => {
    await writeFile(dir, 'pyproject.toml', `
[project]
name = "myapp"
dependencies = [
  "colourama>=1.0",
  "requests>=2.0",
]
`);
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('colourama');
    expect(blocked).not.toContain('requests');
  });

  it('detects a blocked package in [tool.poetry.dependencies]', async () => {
    await writeFile(dir, 'pyproject.toml', `
[tool.poetry.dependencies]
python = "^3.11"
diango = "^3.2"
requests = "^2.28"
`);
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('diango');
    expect(blocked).not.toContain('requests');
    expect(blocked).not.toContain('python');
  });

  it('normalizes underscore vs dash in pyproject.toml', async () => {
    await writeFile(dir, 'pyproject.toml', `
[project]
dependencies = ["typing-extensions>=4.0"]
`);
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('typing-extensions');
  });

  it('passes a clean pyproject.toml', async () => {
    await writeFile(dir, 'pyproject.toml', `
[project]
dependencies = ["fastapi>=0.100", "pydantic>=2.0"]
`);
    const { blocked } = await scanPackages(dir);
    expect(blocked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extraBlocklist (BLOCKED_PACKAGES env var)
// ---------------------------------------------------------------------------

describe('scanPackages — extraBlocklist', () => {
  let dir: string;
  beforeEach(async () => { dir = await makeTmpDir(); });
  afterEach(async () => { await cleanup(dir); });

  it('blocks a package from the extra list (npm)', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { 'my-internal-banned-pkg': '^1.0.0' },
    }));
    const { blocked } = await scanPackages(dir, 'my-internal-banned-pkg');
    expect(blocked).toContain('my-internal-banned-pkg');
  });

  it('blocks a package from the extra list (pip)', async () => {
    await writeFile(dir, 'requirements.txt', 'internal-evil-lib==2.0\n');
    const { blocked } = await scanPackages(dir, 'internal-evil-lib');
    expect(blocked).toContain('internal-evil-lib');
  });

  it('handles comma-separated extra blocklist with whitespace', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { 'pkg-a': '^1.0', 'pkg-b': '^2.0', 'pkg-c': '^3.0' },
    }));
    const { blocked } = await scanPackages(dir, ' pkg-a , pkg-b ');
    expect(blocked).toContain('pkg-a');
    expect(blocked).toContain('pkg-b');
    expect(blocked).not.toContain('pkg-c');
  });

  it('normalizes extra blocklist names (underscore == dash)', async () => {
    await writeFile(dir, 'requirements.txt', 'custom-bad-lib==1.0\n');
    const { blocked } = await scanPackages(dir, 'custom_bad_lib');
    expect(blocked).toContain('custom-bad-lib');
  });

  it('ignores empty extra blocklist', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { 'react': '^18.0.0' },
    }));
    const { blocked } = await scanPackages(dir, '');
    expect(blocked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Mixed manifests
// ---------------------------------------------------------------------------

describe('scanPackages — mixed manifests', () => {
  let dir: string;
  beforeEach(async () => { dir = await makeTmpDir(); });
  afterEach(async () => { await cleanup(dir); });

  it('reports blocked packages from multiple manifest files at once', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { 'event-stream': '^3.3.6' },
    }));
    await writeFile(dir, 'requirements.txt', 'colourama==1.0\n');
    const { blocked } = await scanPackages(dir);
    expect(blocked).toContain('event-stream');
    expect(blocked).toContain('colourama');
  });

  it('returns no duplicates when same package appears in multiple fields', async () => {
    await writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { 'event-stream': '^3.3.6' },
      devDependencies: { 'event-stream': '^3.3.6' },
    }));
    const { blocked } = await scanPackages(dir);
    const count = blocked.filter((p) => p === 'event-stream').length;
    expect(count).toBe(1);
  });
});
