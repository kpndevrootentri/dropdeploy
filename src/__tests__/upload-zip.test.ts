import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import AdmZip from 'adm-zip';
import { extractZipToDir } from '@/services/upload/upload.service';

/**
 * Builds a one-entry zip by hand so the headers can lie about the
 * uncompressed size, the way a zip bomb does.
 */
function zipWithDeclaredSize(name: string, content: Buffer, declaredSize: number): Buffer {
  const data = zlib.deflateRawSync(content);
  const nameBuf = Buffer.from(name);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0, 14); // crc (unchecked)
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42); // local header offset

  const cdOffset = local.length + nameBuf.length + data.length;
  const cdSize = central.length + nameBuf.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}

describe('extractZipToDir', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zip-'));
  });
  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it('extracts a normal static site', async () => {
    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from('<h1>hi</h1>'));
    zip.addFile('assets/app.js', Buffer.from('console.log(1)'));
    const dest = path.join(root, 'site');

    await extractZipToDir(zip.toBuffer(), dest);

    expect(await fs.promises.readFile(path.join(dest, 'index.html'), 'utf8')).toBe('<h1>hi</h1>');
    expect(await fs.promises.readFile(path.join(dest, 'assets/app.js'), 'utf8')).toBe('console.log(1)');
  });

  it('stops inflating at the real byte budget when headers declare size 0', async () => {
    // 101 MB of zeros deflates to ~100 KB; the headers claim it is empty.
    const bomb = zipWithDeclaredSize('index.html', Buffer.alloc(101 * 1024 * 1024), 0);
    expect(bomb.length).toBeLessThan(1024 * 1024);

    await expect(extractZipToDir(bomb, path.join(root, 'site'))).rejects.toThrow(/exceeds 100 MB/);
    await expect(fs.promises.access(path.join(root, 'site'))).rejects.toThrow();
  });
});
