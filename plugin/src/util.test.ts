import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CliError,
  EXIT,
  apiErrorMessage,
  buildDeployUrl,
  cliName,
  normaliseRepoUrl,
  parseArgs,
  parseDotenv,
  previousDeployed,
  projectNameFromRepo,
} from './util.js';

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

test('parseArgs never lets an on/off flag swallow the next word', () => {
  assert.deepEqual(parseArgs(['--json', 'env', 'list']), { command: ['env', 'list'], flags: { json: 'true' } });
  assert.deepEqual(parseArgs(['deploy', '--create', '--json']), { command: ['deploy'], flags: { create: 'true', json: 'true' } });
  assert.deepEqual(parseArgs(['env', 'set', 'A=1', 'B=x=y']), { command: ['env', 'set', 'A=1', 'B=x=y'], flags: {} });
});

test('parseDotenv reads keys and values the way .env files are written', () => {
  const text = [
    '# comment',
    '',
    'PLAIN=value',
    'export EXPORTED=1',
    'SPACED = padded ',
    'DOUBLE="has spaces # not a comment"',
    "SINGLE='literal \\n'",
    'NEWLINE="a\\nb"',
    'TRAILING=x # comment',
    'EMPTY=',
    'URL=postgres://u:p@h/db?x=1',
    'not a pair',
  ].join('\n');
  assert.deepEqual(parseDotenv(text), [
    ['PLAIN', 'value'],
    ['EXPORTED', '1'],
    ['SPACED', 'padded'],
    ['DOUBLE', 'has spaces # not a comment'],
    ['SINGLE', 'literal \\n'],
    ['NEWLINE', 'a\nb'],
    ['TRAILING', 'x'],
    ['EMPTY', ''],
    ['URL', 'postgres://u:p@h/db?x=1'],
  ]);
});

test('projectNameFromRepo takes the repo name and keeps it within 3-50 characters', () => {
  assert.equal(projectNameFromRepo('git@github.com:me/my-app.git'), 'my-app');
  assert.equal(projectNameFromRepo('https://github.com/me/ab'), 'ab-app');
  assert.equal(projectNameFromRepo(`https://github.com/me/${'x'.repeat(80)}`).length, 50);
});

test('previousDeployed skips the live deployment and failures', () => {
  const list = [
    { id: 'f', status: 'FAILED' },
    { id: 'live', status: 'DEPLOYED' },
    { id: 'c', status: 'CANCELLED' },
    { id: 'prev', status: 'DEPLOYED' },
    { id: 'old', status: 'DEPLOYED' },
  ];
  assert.equal(previousDeployed(list)?.id, 'prev');
  assert.equal(previousDeployed([{ id: 'only', status: 'DEPLOYED' }]), null);
});

test('CliError carries a code, an exit code and JSON details', () => {
  const err = new CliError('No match', 'NO_PROJECT_MATCH', EXIT.NEEDS_INPUT, { hint: 'x' });
  assert.equal(err.message, 'No match');
  assert.equal(err.code, 'NO_PROJECT_MATCH');
  assert.equal(err.exitCode, 2);
  assert.deepEqual(err.details, { hint: 'x' });
  assert.equal(new CliError('m', 'C').exitCode, EXIT.FAILED);
});

test('cliName echoes the command the user typed', () => {
  assert.equal(cliName('/usr/local/bin/dropdeploy'), 'dropdeploy');
  assert.equal(cliName('/usr/local/bin/entrify'), 'entrify');
  assert.equal(cliName(undefined), 'entrify');
});
