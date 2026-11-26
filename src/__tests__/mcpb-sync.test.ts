import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Claude Desktop extension download', () => {
  // public/downloads/entrify.mcpb is built by `npm run pack:mcpb` in plugin/; this fails when a version bump forgot it.
  it('public/downloads/entrify.mcpb is packed from the current CLI version', () => {
    const zip = new AdmZip(path.join(process.cwd(), 'public/downloads/entrify.mcpb'));
    const manifest = JSON.parse(zip.readAsText('manifest.json')) as { version: string };
    const cli = JSON.parse(read('plugin/package.json')) as { version: string };

    expect(manifest.version).toBe(cli.version);
    expect(zip.readAsText('manifest.json')).toBe(read('plugin/mcpb/manifest.json'));
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toEqual(expect.arrayContaining(['dist/cli.js', 'dist/mcp.js', 'package.json', 'node_modules/fflate/package.json']));
    expect(names.filter((n) => /\.test\.js$|test-helpers|\.map$|^src\//.test(n))).toEqual([]);
  });
});
