import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorMessage, buildDeployUrl, cliName, normaliseRepoUrl, parseArgs } from './util.js';

test('normaliseRepoUrl makes HTTPS and SSH remotes of one repo equal', () => {
  const want = 'github.com/owner/repo';
  for (const url of [
    'https://github.com/Owner/Repo.git',
    'https://github.com/owner/repo',
    'https://github.com/owner/repo/',
    'https://user:token@github.com/owner/repo.git',
    'git@github.com:owner/repo.git',
    'ssh://git@github.com/owner/repo.git',
    'ssh://git@github.com:22/owner/repo.git',
  ]) {
    assert.equal(normaliseRepoUrl(url), want, url);
  }
  assert.notEqual(normaliseRepoUrl('git@github.com:owner/other.git'), want);
});

test('apiErrorMessage reads the API error shape, then the older ones', () => {
  assert.equal(apiErrorMessage({ success: false, error: { code: 'X', message: 'Account suspended' } }, 'fb'), 'Account suspended');
  assert.equal(apiErrorMessage({ error: 'Plain' }, 'fb'), 'Plain');
  assert.equal(apiErrorMessage({ message: 'Top' }, 'fb'), 'Top');
  assert.equal(apiErrorMessage(null, 'fb'), 'fb');
  assert.equal(apiErrorMessage({ error: {} }, 'fb'), 'fb');
});

test('buildDeployUrl uses the subdomain in production and the proxy route locally', () => {
  assert.equal(buildDeployUrl('https://entrify.site', 'my-app'), 'https://my-app.entrify.site');
  assert.equal(buildDeployUrl('http://localhost:3001', 'my-app'), 'http://localhost:3001/api/proxy/my-app');
});

test('parseArgs accepts --flag value, --flag=value and bare flags', () => {
  assert.deepEqual(parseArgs(['deploy', '--project-id', 'my-app']), { command: ['deploy'], flags: { 'project-id': 'my-app' } });
  assert.deepEqual(parseArgs(['deploy', '--project-id=my-app']), { command: ['deploy'], flags: { 'project-id': 'my-app' } });
  assert.deepEqual(parseArgs(['--help']), { command: [], flags: { help: 'true' } });
  assert.deepEqual(parseArgs(['-v']), { command: [], flags: { version: 'true' } });
});

test('cliName echoes the command the user typed', () => {
  assert.equal(cliName('/usr/local/bin/dropdeploy'), 'dropdeploy');
  assert.equal(cliName('/usr/local/bin/entrify'), 'entrify');
  assert.equal(cliName(undefined), 'entrify');
});
