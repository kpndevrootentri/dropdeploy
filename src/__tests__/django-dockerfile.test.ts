import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DJANGO_SETTINGS, DJANGO_WSGI, DOCKERFILE_TEMPLATES, djangoDockerfile } from '@/services/docker/dockerfile.templates';
import { findDjangoEntry } from '@/services/docker/django-entry';

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { DockerService } = require('@/services/docker/docker.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const SQLITE =
  '[ -f db.sqlite3 ] && [ ! -e /data/db.sqlite3 ] && mv db.sqlite3 /data/; ln -sf /data/db.sqlite3 db.sqlite3; python manage.py migrate --noinput';

/** The shell script the Dockerfile's exec-form CMD hands to `sh -c`. */
function startScript(dockerfile: string): string {
  const cmd = dockerfile.split('\n').find((line) => line.startsWith('CMD '))!;
  const [sh, flag, script] = JSON.parse(cmd.slice(4)) as string[];
  expect([sh, flag]).toEqual(['sh', '-c']);
  return script;
}

describe('Django Dockerfile', () => {
  it('runs gunicorn on the wrapper WSGI, keeping the SQLite volume and migrations', () => {
    const dockerfile = djangoDockerfile({ settings: 'mysite.settings' });
    // Its own pip run: a hash-pinned requirements.txt would make pip demand hashes for these too.
    // The floor upgrades a pinned gunicorn 20.x, which crashes without pkg_resources.
    expect(dockerfile).toContain(
      "RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir 'gunicorn>=21' whitenoise\n",
    );
    expect(dockerfile).toContain(
      'ENV DJANGO_SETTINGS_MODULE=dropdeploy_settings DROPDEPLOY_DJANGO_SETTINGS=mysite.settings\n',
    );
    expect(dockerfile).toContain('RUN python manage.py collectstatic --noinput \\\n || echo');
    expect(dockerfile).toContain('EXPOSE 8000');
    expect(startScript(dockerfile)).toBe(
      '[ "$DJANGO_SETTINGS_MODULE" = dropdeploy_settings ] || export DROPDEPLOY_DJANGO_SETTINGS=$DJANGO_SETTINGS_MODULE DJANGO_SETTINGS_MODULE=dropdeploy_settings; ' +
        `${SQLITE}; ` +
        'python manage.py collectstatic --noinput; ' +
        'exec gunicorn dropdeploy_wsgi:application --bind 0.0.0.0:8000 --workers 2 --threads 4 --keep-alive 5',
    );
  });

  it('collects static files at every start, with the runtime env, and still starts gunicorn if that fails', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'django-start-'));
    try {
      // Stubs log each call; collectstatic fails. A build-time marker file must not skip the start run:
      // runtime env vars can move STATIC_ROOT away from what the build collected.
      await fs.promises.writeFile(path.join(dir, '.dropdeploy-collected'), '');
      for (const [bin, exit] of [['python', '[ "$2" != collectstatic ]'], ['gunicorn', 'true']]) {
        await fs.promises.writeFile(
          path.join(dir, bin),
          `#!/bin/sh\necho "${bin} $* $DJANGO_SETTINGS_MODULE $DROPDEPLOY_DJANGO_SETTINGS" >> log\n${exit}\n`,
          { mode: 0o755 },
        );
      }
      const script = startScript(djangoDockerfile({ settings: 'mysite.settings' }));
      const run = (settingsModule: string) => {
        execFileSync('sh', ['-c', script], {
          cwd: dir,
          env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DJANGO_SETTINGS_MODULE: settingsModule, DROPDEPLOY_DJANGO_SETTINGS: 'mysite.settings' },
          stdio: 'ignore',
        });
        return fs.promises.readFile(path.join(dir, 'log'), 'utf8').finally(() => fs.promises.rm(path.join(dir, 'log')));
      };
      const calls = (settings: string) =>
        ['manage.py migrate --noinput', 'manage.py collectstatic --noinput']
          .map((args) => `python ${args} dropdeploy_settings ${settings}\n`)
          .join('') + `gunicorn dropdeploy_wsgi:application --bind 0.0.0.0:8000 --workers 2 --threads 4 --keep-alive 5 dropdeploy_settings ${settings}\n`;
      expect(await run('dropdeploy_settings')).toBe(calls('mysite.settings'));
      expect(await run('mysite.prod')).toBe(calls('mysite.prod'));
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('serves settings.WSGI_APPLICATION, the app runserver serves', () => {
    expect(DJANGO_WSGI).toContain(
      'application = WhiteNoise(get_internal_wsgi_application(), root=settings.STATIC_ROOT, prefix=settings.STATIC_URL)\n',
    );
  });

  it('uses its own STATIC_ROOT when the project sets none or one outside /app', () => {
    expect(DJANGO_SETTINGS).toContain(
      "if not globals().get('STATIC_ROOT') or not os.path.abspath(str(STATIC_ROOT)).startswith('/app/'):\n" +
        "    STATIC_ROOT = '/app/.dropdeploy-static'\n",
    );
  });

  it('falls back to the unchanged runserver command', () => {
    const dockerfile = DOCKERFILE_TEMPLATES.DJANGO;
    expect(dockerfile).toContain('RUN pip install --no-cache-dir -r requirements.txt\n');
    expect(dockerfile).not.toMatch(/gunicorn|whitenoise|collectstatic/);
    expect(startScript(dockerfile)).toBe(`${SQLITE}; exec python manage.py runserver 0.0.0.0:8000`);
  });

  it('picks gunicorn only for a Django project whose settings module was found', () => {
    const docker = new DockerService({ socketPath: '/nonexistent.sock' });
    const entry = { settings: 'mysite.settings' };
    expect(docker.getDockerfileForProject({ type: 'DJANGO' }, [], entry)).toBe(djangoDockerfile(entry));
    expect(docker.getDockerfileForProject({ type: 'DJANGO' }, [], null)).toBe(DOCKERFILE_TEMPLATES.DJANGO);
    expect(docker.getDockerfileForProject({ type: 'FLASK' }, [], entry)).toBe(DOCKERFILE_TEMPLATES.FLASK);
  });
});

describe('Flask Dockerfile', () => {
  it('installs gunicorn 21 or newer in its own pip run', () => {
    // A requirements.txt pin of gunicorn 20.x would satisfy a bare `gunicorn`, and 20.x crashes on python:3.13-slim.
    expect(DOCKERFILE_TEMPLATES.FLASK).toContain(
      "RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir 'gunicorn>=21'\n",
    );
  });
});

describe('DockerService.buildImage for Django', () => {
  it('writes the wrapper modules and re-includes them after the repo .dockerignore rules', async () => {
    const repo = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'django-'));
    try {
      await fs.promises.writeFile(path.join(repo, 'manage.py'), 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")\n');
      await fs.promises.mkdir(path.join(repo, 'mysite'));
      await fs.promises.writeFile(path.join(repo, 'mysite', 'settings.py'), '');
      await fs.promises.writeFile(path.join(repo, '.dockerignore'), '*.py\n!manage.py\n');
      const docker = new DockerService({ socketPath: '/nonexistent.sock' });
      // Stub the daemon call: a real one tars the context, and that walk outlives the failed build and races the cleanup below.
      const build = jest
        .spyOn((docker as unknown as { docker: { buildImage: () => Promise<unknown> } }).docker, 'buildImage')
        .mockRejectedValue(new Error('no daemon'));
      await expect(docker.buildImage({ type: 'DJANGO', slug: 'mysite' }, repo)).rejects.toThrow('no daemon');
      expect(build).toHaveBeenCalledTimes(1);
      expect(await fs.promises.readFile(path.join(repo, '.dockerignore'), 'utf8')).toBe(
        '*.py\n!manage.py\n\n# Entrify: keep secrets and git history out of the image\n.env*\n.git\n' +
          '!dropdeploy_settings.py\n!dropdeploy_wsgi.py\n',
      );
      expect(await fs.promises.readFile(path.join(repo, 'dropdeploy_wsgi.py'), 'utf8')).toBe(DJANGO_WSGI);
      expect(await fs.promises.readFile(path.join(repo, 'dropdeploy_settings.py'), 'utf8')).toBe(DJANGO_SETTINGS);
    } finally {
      await fs.promises.rm(repo, { recursive: true, force: true });
    }
  });
});

describe('findDjangoEntry', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'django-'));
  });

  afterEach(async () => {
    await fs.promises.rm(repo, { recursive: true, force: true });
  });

  async function write(file: string, content = ''): Promise<void> {
    await fs.promises.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await fs.promises.writeFile(path.join(repo, file), content);
  }

  it('reads the settings module manage.py defaults to, wherever wsgi.py is', async () => {
    await write('manage.py', '    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")\n');
    await write('config/settings/prod.py');
    expect(await findDjangoEntry(repo)).toEqual({ settings: 'config.settings.prod' });
  });

  it('keeps runserver when manage.py changes sys.path or the settings module is not under the repo root', async () => {
    // gunicorn puts only /app on sys.path, so a src/ or apps/ layout would fail to boot under it.
    const setdefault = 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")\n';
    await write('mysite/settings/__init__.py');
    for (const edit of ['sys.path.insert(0, str(BASE / "apps"))', 'sys.path.append("src")', 'site.addsitedir("lib")']) {
      await write('manage.py', `${edit}\n${setdefault}`);
      expect(await findDjangoEntry(repo)).toBeNull();
    }
    await write('manage.py', `import sys\nexecute_from_command_line(sys.argv)\n${setdefault}`);
    expect(await findDjangoEntry(repo)).toEqual({ settings: 'mysite.settings' });
    await fs.promises.rm(path.join(repo, 'mysite'), { recursive: true });
    await write('src/mysite/settings.py');
    expect(await findDjangoEntry(repo)).toBeNull();
  });

  it('falls back when manage.py replaces the variable, which would bypass the wrapper settings', async () => {
    await write('mysite/settings.py');
    for (const line of [
      "os.environ['DJANGO_SETTINGS_MODULE'] = 'mysite.settings'",
      'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")\nos.environ["DJANGO_SETTINGS_MODULE"]="mysite.settings"',
      'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")\nos.environ.update(DJANGO_SETTINGS_MODULE="mysite.settings")',
      'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")\nos.environ.update({"DJANGO_SETTINGS_MODULE": "mysite.settings"})',
    ]) {
      await write('manage.py', `${line}\n`);
      expect(await findDjangoEntry(repo)).toBeNull();
    }
    // Reading or comparing it is fine.
    await write('manage.py', 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")\nif os.environ["DJANGO_SETTINGS_MODULE"] == "x": pass\n');
    expect(await findDjangoEntry(repo)).toEqual({ settings: 'mysite.settings' });
  });

  it('checks a manage.py with a long whitespace run in linear time', async () => {
    await write('mysite/settings.py');
    // The old pattern took about 5 s on this, and the time grew with the square of the run.
    await write('manage.py', `os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")\nDJANGO_SETTINGS_MODULE${' \n'.repeat(50_000)}x\n`);
    const start = Date.now();
    expect(await findDjangoEntry(repo)).toEqual({ settings: 'mysite.settings' });
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('returns null when manage.py names no settings module', async () => {
    expect(await findDjangoEntry(repo)).toBeNull();
    await write('manage.py', 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", os.environ["APP_SETTINGS"])\n');
    expect(await findDjangoEntry(repo)).toBeNull();
  });

  it('rejects names that could break out of the Dockerfile line, and symlinks', async () => {
    await write('real.py', 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")\n');
    await write('manage.py', 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings\\nRUN id")\n');
    expect(await findDjangoEntry(repo)).toBeNull();
    await fs.promises.rm(path.join(repo, 'manage.py'));
    await fs.promises.symlink(path.join(repo, 'real.py'), path.join(repo, 'manage.py'));
    const onLog = jest.fn();
    expect(await findDjangoEntry(repo, onLog)).toBeNull();
    expect(onLog).toHaveBeenCalledWith('manage.py in the repository is a symbolic link. Replace it with a regular file.\n');
  });
});
