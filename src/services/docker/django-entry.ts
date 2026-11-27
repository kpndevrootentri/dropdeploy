import * as path from 'path';
import { readRepoFile, repoFileExists } from '@/lib/repo-fs';
import type { DjangoEntry } from './dockerfile.templates';

/** manage.py's `os.environ.setdefault("DJANGO_SETTINGS_MODULE", "x.settings")`. */
const SETTINGS_MODULE = /["']DJANGO_SETTINGS_MODULE["']\s*,\s*["']([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)["']/;

/**
 * A write that replaces the variable outright: `os.environ["DJANGO_SETTINGS_MODULE"] = …`,
 * `update(DJANGO_SETTINGS_MODULE=…)` or `{"DJANGO_SETTINGS_MODULE": …}`. manage.py would
 * then swap the wrapper settings for the project's, so collectstatic would have no STATIC_ROOT.
 * The bracket and the whitespace before it share one group: two adjacent `\s*` would
 * backtrack in quadratic time on a long whitespace run in the tenant's manage.py.
 */
const REPLACES_SETTINGS_MODULE = /DJANGO_SETTINGS_MODULE["']?(?:\s*\])?\s*(?:=(?!=)|:)/;

/**
 * manage.py changing the import path (a src/ or apps/ folder). gunicorn imports the
 * project with only /app on sys.path, so settings or apps found that way fail to boot.
 */
const EDITS_IMPORT_PATH = /\bsys\.path\b|\baddsitedir\b/;

/**
 * The settings module manage.py defaults to. Null when it names none, when it
 * replaces the variable outright, when it changes sys.path, when the module isn't
 * importable from the repo root, or when a file can't be read (a symlink), which
 * onLog reports since the build log's hint can't say it.
 * The module name holds only word characters and dots, so it is safe in a Dockerfile line.
 */
export async function findDjangoEntry(contextPath: string, onLog?: (line: string) => void): Promise<DjangoEntry | null> {
  try {
    // A tenant's clone: untraced, or Turbopack walks every repo in projects/.
    const managePy = await readRepoFile(path.join(/*turbopackIgnore: true*/ contextPath, 'manage.py'));
    if (!managePy || REPLACES_SETTINGS_MODULE.test(managePy) || EDITS_IMPORT_PATH.test(managePy)) return null;
    const settings = managePy.match(SETTINGS_MODULE)?.[1];
    if (!settings) return null;
    // Backstop for a module found another way (PYTHONPATH): gunicorn needs it under /app.
    const mod = path.join(/*turbopackIgnore: true*/ contextPath, ...settings.split('.'));
    const importable = (await repoFileExists(`${mod}.py`)) || (await repoFileExists(path.join(mod, '__init__.py')));
    return importable ? { settings } : null;
  } catch (err) {
    onLog?.(`${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}
