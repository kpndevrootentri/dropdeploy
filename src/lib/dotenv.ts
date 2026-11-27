export interface DotenvEntry {
  line: number;
  key: string;
  value: string;
}

export interface DotenvProblem {
  line: number;
  key?: string;
  reason: string;
}

/** Index of the `"` that closes a double-quoted value, or -1. A backslash escapes the next character. */
function closingQuote(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i;
  }
  return -1;
}

/**
 * Parses .env text into entries in file order, plus the lines it could not read.
 * Same value rules as `parseDotenv` in plugin/src/util.ts (the CLI's `env push`), so a file
 * means the same thing in both: `export ` prefixes, blank lines and `#` comments are skipped;
 * single quotes are literal; double quotes may span lines and turn `\n`, `\"` and `\\` into a
 * newline, a quote and a backslash; an unquoted value ends at ` #`. CRLF and a BOM are fine.
 * Keys are not checked here, so the caller can say why a key is invalid. Reading stops once more
 * than `maxLines` lines have been entries or problems, so a caller with a cap does no more work than it needs.
 *
 * @example parseDotenv('A=1\n# note\nexport B="x y"').entries // [{line: 1, key: 'A', value: '1'}, {line: 3, key: 'B', value: 'x y'}]
 */
export function parseDotenv(text: string, maxLines = Infinity): { entries: DotenvEntry[]; problems: DotenvProblem[] } {
  const entries: DotenvEntry[] = [];
  const problems: DotenvProblem[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length && entries.length + problems.length <= maxLines; i++) {
    const line = i + 1;
    // Only the start is trimmed: a double-quoted value that spans lines keeps its trailing spaces.
    const raw = lines[i].trimStart();
    if (!raw || raw.startsWith('#')) continue;
    const match = raw.match(/^(?:export\s+)?([^\s=]+)\s*=([\s\S]*)$/);
    if (!match) {
      problems.push({ line, reason: 'Not a KEY=VALUE line' });
      continue;
    }
    const [, key, rest] = match;
    const quoted = rest.trimStart();
    let value: string;
    if (quoted.startsWith('"')) {
      // One line at a time, joined once at the end: growing one string and rescanning it is quadratic.
      const parts = [quoted.slice(1)];
      let end = closingQuote(parts[0]);
      while (end < 0 && i + 1 < lines.length) {
        parts.push(lines[++i]);
        end = closingQuote(parts[parts.length - 1]);
      }
      if (end < 0) {
        problems.push({ line, key, reason: 'The double-quoted value is never closed' });
        continue;
      }
      parts[parts.length - 1] = parts[parts.length - 1].slice(0, end);
      value = parts.join('\n').replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));
    } else if (quoted.startsWith("'") && quoted.indexOf("'", 1) > 0) {
      value = quoted.slice(1, quoted.indexOf("'", 1));
    } else {
      value = rest.replace(/\s#[\s\S]*$/, '').trim();
    }
    entries.push({ line, key, value });
  }
  return { entries, problems };
}
