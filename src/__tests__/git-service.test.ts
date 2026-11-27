import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

// Real git on local repositories. HOME is a fixture so a developer's ~/.gitconfig
// (url.insteadOf, commit signing) cannot change the results.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'git-service-'));
const HOME = path.join(ROOT, 'home');
const PROJECTS_DIR = path.join(ROOT, 'projects');
fs.mkdirSync(HOME);
fs.writeFileSync(path.join(HOME, '.gitconfig'), '[user]\n\tname = Test\n\temail = test@example.test\n[init]\n\tdefaultBranch = main\n');
// Every git run goes through a shim that logs its argv, so a test can check what `ps` would show.
const ARGV_LOG = path.join(ROOT, 'git-argv.log');
const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
fs.mkdirSync(path.join(ROOT, 'bin'));
fs.writeFileSync(path.join(ROOT, 'bin', 'git'), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${ARGV_LOG}'\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
const saved = { HOME: process.env.HOME, PATH: process.env.PATH };
Object.assign(process.env, { HOME, PROJECTS_DIR, PATH: `${path.join(ROOT, 'bin')}:${process.env.PATH}` });

/* eslint-disable @typescript-eslint/no-require-imports */
const { GitService } = require('@/services/git/git.service') as typeof import('@/services/git/git.service');
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(30_000);
afterAll(() => {
  Object.assign(process.env, saved);
  fs.rmSync(ROOT, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: { PATH: process.env.PATH, HOME, NODE_ENV: 'test' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let repos = 0;
/** A bare repository served at a file:// URL, with a working copy to commit from. */
function makeRepo() {
  const name = `repo${++repos}`;
  const bare = path.join(ROOT, `${name}.git`);
  const work = path.join(ROOT, name);
  git(ROOT, 'init', '-q', '--bare', bare);
  git(ROOT, 'init', '-q', work);
  git(work, 'remote', 'add', 'origin', bare);
  return {
    url: `file://${bare}`,
    /** Commits `files` on `branch` (a new one starts from the current commit) and pushes; returns the commit. */
    commit(files: Record<string, string>, branch = 'main'): string {
      if (git(work, 'branch', '--show-current') !== branch) git(work, 'checkout', '-q', '-b', branch);
      for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(work, file), content);
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', `update ${Object.keys(files).join(' ')}`);
      git(work, 'push', '-q', 'origin', branch);
      return git(work, 'rev-parse', 'HEAD');
    },
  };
}

let slugs = 0;
const newSlug = () => `site${++slugs}`;
const exists = (file: string) => fs.existsSync(file);
const basic = (username: string, token: string) => Buffer.from(`${username}:${token}`).toString('base64');

it('clones a first deploy shallow and returns the commit', async () => {
  const repo = makeRepo();
  repo.commit({ 'index.html': 'v1' });
  const head = repo.commit({ 'index.html': 'v2' });
  const slug = newSlug();
  const result = await new GitService().ensureRepo(repo.url, slug, 'main');
  expect(result).toEqual({ workDir: path.join(PROJECTS_DIR, slug), commitHash: head });
  expect(git(result.workDir, 'rev-parse', '--is-shallow-repository')).toBe('true');
});

it('a redeploy fetches the new commit and drops untracked and ignored files', async () => {
  const repo = makeRepo();
  repo.commit({ 'index.html': 'v1', '.gitignore': '.env\n' });
  const slug = newSlug();
  const { workDir } = await new GitService().ensureRepo(repo.url, slug, 'main');
  fs.writeFileSync(path.join(workDir, 'stray.txt'), 'left by the last build');
  fs.writeFileSync(path.join(workDir, '.env'), 'SECRET=fake');
  fs.writeFileSync(path.join(workDir, 'index.html'), 'edited in place');
  const head = repo.commit({ 'about.html': 'about' });

  await expect(new GitService().ensureRepo(repo.url, slug, 'main')).resolves.toEqual({ workDir, commitHash: head });
  expect(exists(path.join(workDir, 'about.html'))).toBe(true);
  expect(fs.readFileSync(path.join(workDir, 'index.html'), 'utf8')).toBe('v1');
  expect(exists(path.join(workDir, 'stray.txt'))).toBe(false);
  expect(exists(path.join(workDir, '.env'))).toBe(false);
});

it('switches the clone to another branch of the same repository and back', async () => {
  const repo = makeRepo();
  const main = repo.commit({ 'index.html': 'main' });
  const dev = repo.commit({ 'dev.html': 'dev' }, 'dev');
  const slug = newSlug();
  const service = new GitService();
  await service.ensureRepo(repo.url, slug, 'main');
  const { workDir, commitHash } = await service.ensureRepo(repo.url, slug, 'dev');
  expect(commitHash).toBe(dev);
  expect(exists(path.join(workDir, 'dev.html'))).toBe(true);
  await expect(service.ensureRepo(repo.url, slug, 'main')).resolves.toMatchObject({ commitHash: main });
  expect(exists(path.join(workDir, 'dev.html'))).toBe(false);
});

it("re-clones instead of reusing another repository's clone under the same slug", async () => {
  const previous = makeRepo();
  const previousHead = previous.commit({ 'secret.txt': 'previous owner' });
  const next = makeRepo();
  const head = next.commit({ 'index.html': 'new owner' });
  const slug = newSlug();
  await new GitService().ensureRepo(previous.url, slug, 'main');

  const { workDir, commitHash } = await new GitService().ensureRepo(next.url, slug, 'main');
  expect(commitHash).toBe(head);
  expect(git(workDir, 'remote', 'get-url', 'origin')).toBe(next.url);
  expect(exists(path.join(workDir, 'secret.txt'))).toBe(false);
  expect(() => git(workDir, 'cat-file', '-e', previousHead)).toThrow();
});

it('ignores git-related variables in the service environment', async () => {
  const hostile = { EDITOR: 'vim', PAGER: 'less', GIT_DIR: path.join(ROOT, 'nowhere'), GIT_SSH_COMMAND: 'false' };
  const saved = Object.fromEntries(Object.keys(hostile).map((k) => [k, process.env[k]]));
  const repo = makeRepo();
  const head = repo.commit({ 'index.html': 'v1' });
  const slug = newSlug();
  Object.assign(process.env, hostile);
  try {
    await new GitService().ensureRepo(repo.url, slug, 'main');
    await expect(new GitService().ensureRepo(repo.url, slug, 'main')).resolves.toMatchObject({ commitHash: head });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

it('sends credentials only as a Basic header, failing with the error the deployment reads as an auth failure', async () => {
  const requests: { authorization?: string }[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ authorization: req.headers.authorization });
    res.statusCode = 403;
    res.end();
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/org/private.git`;
    const message = await new GitService()
      .ensureRepo(url, newSlug(), 'main', { username: 'x-access-token', token: 'fake-token-123' })
      .then(() => '', (e: Error) => e.message);
    // The pattern deployment.service matches to report a missing or revoked token.
    expect(message).toMatch(/fatal: unable to access .*returned error: 40[13]/);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0].authorization).toBe(`Basic ${basic('x-access-token', 'fake-token-123')}`);
    const argv = fs.readFileSync(ARGV_LOG, 'utf8');
    expect(argv).not.toContain('fake-token-123');
    expect(argv).not.toContain(basic('x-access-token', 'fake-token-123'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

it('keeps the token out of .git/config and git argv across a clone and a redeploy', async () => {
  const repo = makeRepo();
  repo.commit({ 'index.html': 'v1' });
  const slug = newSlug();
  const credentials = { username: 'x-access-token', token: 'fake-token-456' };
  fs.writeFileSync(ARGV_LOG, '');
  const { workDir } = await new GitService().ensureRepo(repo.url, slug, 'main', credentials);
  const head = repo.commit({ 'about.html': 'about' });
  await expect(new GitService().ensureRepo(repo.url, slug, 'main', credentials)).resolves.toMatchObject({ commitHash: head });

  const argv = fs.readFileSync(ARGV_LOG, 'utf8');
  expect(argv).toMatch(/^clone$/m);
  expect(argv).toMatch(/^fetch$/m);
  const config = fs.readFileSync(path.join(workDir, '.git', 'config'), 'utf8');
  for (const secret of [credentials.token, basic(credentials.username, credentials.token)]) {
    expect(argv).not.toContain(secret);
    expect(config).not.toContain(secret);
  }
  expect(git(workDir, 'remote', 'get-url', 'origin')).toBe(repo.url);
});

it('rejects when the deployment is already aborted', async () => {
  const repo = makeRepo();
  repo.commit({ 'index.html': 'v1' });
  const controller = new AbortController();
  controller.abort();
  const slug = newSlug();
  await expect(new GitService().ensureRepo(repo.url, slug, 'main', undefined, controller.signal)).rejects.toThrow(/abort/i);
  expect(exists(path.join(PROJECTS_DIR, slug))).toBe(false);
});
