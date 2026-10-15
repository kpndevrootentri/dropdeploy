import { execFileSync } from 'child_process';
import * as path from 'path';

// globals.css keeps Tailwind 3's space-* behavior on Tailwind 4. The reset of
// v4's end margin only stays harmless while it sorts before the m*- utilities.
describe('Tailwind 3 compatibility in globals.css', () => {
  let css: string;

  beforeAll(() => {
    // @tailwindcss/node registers module hooks, which jest's runtime refuses.
    const script = `
      const fs = require('fs');
      const { compile } = require('@tailwindcss/node');
      const base = ${JSON.stringify(path.join(process.cwd(), 'src/app'))};
      compile(fs.readFileSync(base + '/globals.css', 'utf8'), { base, onDependency: () => {} })
        .then((c) => process.stdout.write(c.build(['space-y-2', 'mb-2', 'mt-2'])));
    `;
    css = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  }, 30_000);

  it('puts space-y on the start of every child but the first', () => {
    expect(css).toMatch(/\.space-y-2 > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{\s*margin-top: calc\(var\(--spacing\) \* 2\)/);
  });

  it("lets a child's own mb- override the end-margin reset", () => {
    expect(css.indexOf('.space-y-2 > * {')).toBeGreaterThan(-1);
    expect(css.indexOf('.space-y-2 > * {')).toBeLessThan(css.indexOf('.mb-2 {'));
  });
});
