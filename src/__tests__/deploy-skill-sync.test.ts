import fs from 'fs';
import path from 'path';

const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Claude Code deploy skill', () => {
  // public/deploy.md is the copy people save to ~/.claude/commands by hand; the plugin's SKILL.md is the source.
  it('public/deploy.md is the same file as the plugin skill', () => {
    expect(read('public/deploy.md')).toBe(read('plugin/plugins/entrify/skills/deploy/SKILL.md'));
  });

  it('the plugin version follows the CLI version it needs', () => {
    const cli = JSON.parse(read('plugin/package.json')) as { version: string };
    const manifest = JSON.parse(read('plugin/plugins/entrify/.claude-plugin/plugin.json')) as { version: string };
    expect(manifest.version).toBe(cli.version);
  });
});
