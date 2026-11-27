import { parseDotenv } from '@/lib/dotenv';
import { checkEnvFile, MAX_ENV_FILE_LENGTH } from '@/validators/env-var.validator';
// The CLI's `env push` parser (a separate package): both must read a file the same way.
import { parseDotenv as cliParseDotenv } from '../../plugin/src/util';

const pairs = (text: string): Array<[string, string]> => parseDotenv(text).entries.map((e) => [e.key, e.value]);

describe('parseDotenv', () => {
  it.each<[string, string, Array<[string, string]>]>([
    ['plain', 'A=1', [['A', '1']]],
    ['export prefix', 'export A=1', [['A', '1']]],
    ['spaces around =', 'A = padded ', [['A', 'padded']]],
    ['empty value', 'A=', [['A', '']]],
    ['= inside the value', 'URL=postgres://u:p@h/db?x=1', [['URL', 'postgres://u:p@h/db?x=1']]],
    ['inline comment on an unquoted value', 'A=x # note', [['A', 'x']]],
    ['# without a space before it is part of the value', 'A=x#y', [['A', 'x#y']]],
    ['value that starts with #', 'A=#x', [['A', '#x']]],
    ['comment after = and a space', 'A= # note', [['A', '']]],
    ['double quotes keep # and spaces', 'A="has spaces # not a comment"', [['A', 'has spaces # not a comment']]],
    ['comment after a closing double quote', 'A="x" # note', [['A', 'x']]],
    ['\\n in double quotes is a newline', 'A="a\\nb"', [['A', 'a\nb']]],
    ['escaped quote and backslash', 'A="say \\"hi\\" \\\\n"', [['A', 'say "hi" \\n']]],
    ['other backslashes stay', 'A="C:\\temp"', [['A', 'C:\\temp']]],
    ['double quotes span lines', 'KEY="-----BEGIN-----\nabc  \n-----END-----"\nB=2', [['KEY', '-----BEGIN-----\nabc  \n-----END-----'], ['B', '2']]],
    ['single quotes are literal', "A='literal \\n # x'", [['A', 'literal \\n # x']]],
    ['unclosed single quote is kept', "A='abc", [['A', "'abc"]]],
    ['full-line and indented comments, blank lines', '# c\n\n   \n  # indented\nA=1', [['A', '1']]],
    ['CRLF', 'A=1\r\nB="x\r\ny"\r\n', [['A', '1'], ['B', 'x\ny']]],
    ['BOM', '\uFEFFA=1', [['A', '1']]],
    ['file order, duplicates kept', 'B=1\nA=2\nB=3', [['B', '1'], ['A', '2'], ['B', '3']]],
  ])('%s', (_name, text, expected) => {
    expect(parseDotenv(text).problems).toEqual([]);
    expect(pairs(text)).toEqual(expected);
    // Same values from the CLI parser.
    expect(cliParseDotenv(text)).toEqual(expected);
  });

  it('numbers entries by the line they start on', () => {
    expect(parseDotenv('# c\nA="x\ny"\nB=1').entries.map((e) => e.line)).toEqual([2, 4]);
  });

  it('reports lines it cannot read, without values', () => {
    expect(parseDotenv('not a pair\nA=1\nB="never closed\nC=2').problems).toEqual([
      { line: 1, reason: 'Not a KEY=VALUE line' },
      { line: 3, key: 'B', reason: 'The double-quoted value is never closed' },
    ]);
  });

  it('leaves key checks to the caller, while the CLI skips invalid keys', () => {
    expect(pairs('MY-KEY=1\n1A=2')).toEqual([['MY-KEY', '1'], ['1A', '2']]);
    expect(cliParseDotenv('MY-KEY=1\n1A=2\nOK=3')).toEqual([['OK', '3']]);
  });

  it('the CLI refuses an unclosed double quote instead of dropping the rest of the file', () => {
    expect(() => cliParseDotenv('A="x\nB=1')).toThrow('The double-quoted value of A is never closed');
  });

  it('stays linear on long lines of spaces', () => {
    const text = `A=${' '.repeat(200_000)}x`;
    const started = Date.now();
    expect(pairs(text)).toEqual([['A', 'x']]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('stays linear on a double-quoted value that spans many lines', () => {
    // 2 MB over a million lines: rescanning a growing string here took about 25 s.
    const lines = 'x\n'.repeat(1_000_000);
    const started = Date.now();
    expect(parseDotenv(`A="${lines}"`).entries[0].value).toHaveLength(2_000_000);
    expect(cliParseDotenv(`A="${lines}"`)[0][1]).toHaveLength(2_000_000);
    expect(parseDotenv(`A="${lines}`).problems).toEqual([{ line: 1, key: 'A', reason: 'The double-quoted value is never closed' }]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('stops reading at the first entry or problem past maxLines', () => {
    const { entries, problems } = parseDotenv('A=1\n# c\n\noops\nB=2\nC=3\nD=4', 3);
    expect(entries.map((e) => e.key)).toEqual(['A', 'B', 'C']);
    expect(problems).toEqual([{ line: 4, reason: 'Not a KEY=VALUE line' }]);
  });
});

describe('checkEnvFile', () => {
  it('checks keys and values like single create and keeps the last of a repeated key', () => {
    const { variables, invalid } = checkEnvFile(
      ['A=1', 'MY-KEY=x', `${'K'.repeat(257)}=x`, `BIG=${'v'.repeat(10_001)}`, 'A=2', 'oops'].join('\n'),
    );
    expect(variables.map((v) => [v.key, v.value])).toEqual([['A', '2']]);
    expect(invalid.map((p) => [p.line, p.key?.slice(0, 6)])).toEqual([[2, 'MY-KEY'], [3, 'KKKKKK'], [4, 'BIG'], [6, undefined]]);
    expect(invalid[0].reason).toBe('Key must be a valid environment variable name');
    expect(invalid[2].reason).toMatch(/^Value: /);
    expect(JSON.stringify(invalid)).not.toContain('vvvv');
  });

  it('stops at the first line past 200, so a file at the size limit is refused at once', () => {
    // A key that fails validation on every line was the costliest file: 1.6 s before the cap.
    const content = '1=1\n'.repeat(MAX_ENV_FILE_LENGTH / 4);
    const started = Date.now();
    const { tooMany, invalid } = checkEnvFile(content);
    expect(Date.now() - started).toBeLessThan(100);
    expect(tooMany).toBe(true);
    expect(invalid).toHaveLength(201);
  });

  it('counts each KEY=VALUE line toward the cap, repeated keys included', () => {
    const file = (n: number): string => Array.from({ length: n }, () => 'A=1').join('\n');
    expect(checkEnvFile(file(200))).toMatchObject({ tooMany: false, variables: [{ key: 'A' }] });
    expect(checkEnvFile(file(201)).tooMany).toBe(true);
  });
});
