import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectFromFiles } from '@/lib/type-detector';

describe('detectFromFiles — WordPress', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'detect-'));
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('detects a wp-content repo as WORDPRESS even when a theme build adds package.json', async () => {
    await fs.promises.mkdir(path.join(dir, 'wp-content/themes/site'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { react: '18' } }));

    await expect(detectFromFiles(dir)).resolves.toMatchObject({ type: 'WORDPRESS', confidence: 'high' });
  });

  it('still detects a plain package.json repo as a Node project', async () => {
    await fs.promises.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));

    await expect(detectFromFiles(dir)).resolves.toMatchObject({ type: 'NODEJS' });
  });
});
