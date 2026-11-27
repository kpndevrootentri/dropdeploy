import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tarStream from 'tar-stream';
import { packBuildContext } from '@/services/docker/build-context';

function write(root: string, file: string, text = 'x'): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

async function tarEntries(stream: NodeJS.ReadableStream): Promise<string[]> {
  const names: string[] = [];
  const extract = tarStream.extract();
  extract.on('entry', (header, body, next) => {
    names.push(header.name);
    body.on('end', next);
    body.resume();
  });
  await new Promise((resolve, reject) => {
    extract.on('finish', resolve);
    extract.on('error', reject);
    stream.pipe(extract);
  });
  return names.sort();
}

describe('packBuildContext', () => {
  it('leaves out what .dockerignore excludes, keeping exceptions, the Dockerfile and .dockerignore', async () => {
    const ctx = fs.mkdtempSync(path.join(os.tmpdir(), 'build-context-'));
    try {
      write(ctx, '.dockerignore', ['.env*', '!.env.example', '.git', 'node_modules', '!node_modules/keep.js', 'Dockerfile', '.dockerignore'].join('\n'));
      for (const file of ['Dockerfile', 'index.js', 'src/app.js', '.env', '.env.local', '.env.example', '.git/config', 'node_modules/dep.js', 'node_modules/keep.js']) {
        write(ctx, file);
      }

      expect(await tarEntries(await packBuildContext(ctx))).toEqual([
        '.',
        '.dockerignore',
        '.env.example',
        'Dockerfile',
        'index.js',
        // Walked only because a `!` rule reaches into it.
        'node_modules',
        'node_modules/keep.js',
        'src',
        'src/app.js',
      ]);
    } finally {
      fs.rmSync(ctx, { recursive: true, force: true });
    }
  });
});
