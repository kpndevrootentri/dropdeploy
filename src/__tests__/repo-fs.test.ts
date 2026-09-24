import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readRepoFile, writeRepoFile, repoFileExists } from '@/lib/repo-fs';
import { patchNextConfig } from '@/services/docker/nextjs-config-patcher';

describe('repo-fs', () => {
  let repo: string;
  let outside: string;

  beforeEach(async () => {
    repo = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'repo-'));
    outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'host-'));
  });

  afterEach(async () => {
    await fs.promises.rm(repo, { recursive: true, force: true });
    await fs.promises.rm(outside, { recursive: true, force: true });
  });

  it('reads and writes regular files', async () => {
    const file = path.join(repo, 'Dockerfile');
    expect(await readRepoFile(file)).toBeNull();
    await writeRepoFile(file, 'FROM node');
    expect(await readRepoFile(file)).toBe('FROM node');
    expect(await repoFileExists(file)).toBe(true);
  });

  it('refuses to write through a symlink to a host file', async () => {
    const victim = path.join(outside, 'authorized_keys');
    await fs.promises.writeFile(victim, 'ssh-ed25519 original');
    await fs.promises.symlink(victim, path.join(repo, 'Dockerfile'));

    await expect(writeRepoFile(path.join(repo, 'Dockerfile'), 'FROM evil')).rejects.toThrow(/symbolic link/);
    expect(await fs.promises.readFile(victim, 'utf8')).toBe('ssh-ed25519 original');
  });

  it('refuses a dangling symlink instead of creating its target', async () => {
    const target = path.join(outside, 'cron-job');
    await fs.promises.symlink(target, path.join(repo, 'next.config.js'));

    await expect(patchNextConfig(repo)).rejects.toThrow(/symbolic link/);
    await expect(fs.promises.access(target)).rejects.toThrow();
  });

  it('refuses to read through a symlink', async () => {
    const secret = path.join(outside, '.env');
    await fs.promises.writeFile(secret, 'JWT_SECRET=x');
    await fs.promises.symlink(secret, path.join(repo, 'next.config.mjs'));

    await expect(readRepoFile(path.join(repo, 'next.config.mjs'))).rejects.toThrow(/symbolic link/);
  });
});
