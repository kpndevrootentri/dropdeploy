const mockDetect = jest.fn<Promise<{ type: string }>, unknown[]>(async () => ({ type: 'STATIC' }));
jest.mock('@/lib/get-session', () => ({ getSession: async () => ({ userId: 'u1', via: 'jwt' }) }));
jest.mock('@/lib/type-detector', () => ({ detectFromRawUrl: (...args: unknown[]) => mockDetect(...args) }));
jest.mock('@/services/git-provider', () => ({ gitProviderService: { getTokenForDeployment: async () => null } }));

import { NextRequest } from 'next/server';
import { POST as detectType } from '@/app/api/detect-type/route';
import { loginSchema, registerSchema, splitEmails } from '@/validators/auth.validator';
import { addMentorSchema, addStudentsSchema, createCohortSchema, joinCodeSchema, updateCohortSchema } from '@/validators/cohort.validator';
import { grantAccessSchema } from '@/validators/project-access.validator';
import { createProjectSchema, updateProjectSchema, uploadProjectSchema } from '@/validators/project.validator';
import { createApiTokenSchema } from '@/validators/api-token.validator';
import { updatePlatformSettingsSchema } from '@/validators/platform-settings.validator';
import { addDomainSchema, updateDomainSchema } from '@/validators/domain.validator';
import { createEnvVarSchema } from '@/validators/env-var.validator';
import { tourEndedSchema } from '@/validators/onboarding.validator';

/** The first problem's message, or null when the input is accepted. */
function firstMessage(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, input: unknown): string | null {
  const result = schema.safeParse(input);
  return result.success ? null : result.error!.issues[0].message;
}

describe('email addresses', () => {
  const email = loginSchema.shape.email;

  it.each([
    ['student@entri.me', true],
    ['first.last+batch7@gmail.com', true],
    ['dev@mail.cs.example.ac.in', true],
    ['User.Name@Example.COM', true],
    ["o'brien@example.com", true],
    ['user_name-1@ex-ample.co', true],
    ['a@b.co', true],
    ['user@example.photography', true],
    [' student@entri.me', false],
    ['student@entri.me ', false],
    ['student@entri.me.', false],
    ['student@exämple.com', false],
    ['stüdent@example.com', false],
    ['student@xn--exmple-cua.com', true],
    ['user@localhost', false],
    ['user@example.c', false],
    ['user..name@example.com', false],
    ['.user@example.com', false],
    ['user.@example.com', false],
    ['user@-example.com', false],
    ['user@exa_mple.com', false],
    ['user@127.0.0.1', false],
    ['user@[127.0.0.1]', false],
    ['user@example..com', false],
    ['"quoted"@example.com', false],
    ['plainaddress', false],
    ['@example.com', false],
    ['user@', false],
    ['', false],
  ])('%j accepted: %s', (input, accepted) => {
    expect(email.safeParse(input).success).toBe(accepted);
  });

  it('trims before checking where the schema trims, and nowhere else', () => {
    expect(addMentorSchema.parse({ email: '  mentor@entri.me ' })).toEqual({ email: 'mentor@entri.me' });
    expect(registerSchema.safeParse({ email: ' new@entri.me', password: 'long-enough' }).success).toBe(false);
    expect(grantAccessSchema.safeParse({ email: 'Teacher@Entri.me' }).success).toBe(true);
  });

  it('splits a pasted list into lowercased, de-duplicated valid and invalid addresses', () => {
    expect(splitEmails([' A@Entri.me', 'a@entri.me', '', 'bad@', 'b+x@entri.me', 'c@entri.me.'])).toEqual({
      valid: ['a@entri.me', 'b+x@entri.me'],
      invalid: ['bad@', 'c@entri.me.'],
    });
  });
});

describe('URLs', () => {
  beforeEach(() => mockDetect.mockClear());

  function detect(body: unknown): Promise<Response> {
    return detectType(new NextRequest('http://localhost/api/detect-type', { method: 'POST', body: JSON.stringify(body) }));
  }

  it.each([
    ['https://github.com/entri/portfolio', 200],
    ['https://github.com/entri/portfolio.git', 200],
    ['http://gitlab.com/group/sub/repo', 200],
    ['HTTPS://GITHUB.COM/Entri/Portfolio', 200],
    ['javascript:alert(1)', 200],
    ['git@github.com:entri/portfolio.git', 400],
    ['github.com/entri/portfolio', 400],
    ['ssh://git@github.com/entri/portfolio.git', 200],
    ['https://', 400],
    ['', 400],
  ])('detect-type repoUrl %j answers %i', async (repoUrl, status) => {
    expect((await detect({ repoUrl })).status).toBe(status);
  });

  // zod 4 trims a URL and drops tabs and line breaks from it; zod 3 passed it on as sent.
  it('passes the URL on trimmed and defaults the branch to main', async () => {
    await detect({ repoUrl: ' https://github.com/entri/portfolio ' });
    expect(mockDetect).toHaveBeenCalledWith('https://github.com/entri/portfolio', 'main', undefined);
    await detect({ repoUrl: 'https://github.com/entri/portfolio', branch: 'dev' });
    expect(mockDetect).toHaveBeenLastCalledWith('https://github.com/entri/portfolio', 'dev', undefined);
  });

  it('refuses an empty branch', async () => {
    expect((await detect({ repoUrl: 'https://github.com/entri/portfolio', branch: '' })).status).toBe(400);
  });
});

describe('repository URLs on project create', () => {
  const create = (githubUrl: string, source = 'GITHUB'): string | null =>
    firstMessage(createProjectSchema, { name: 'portfolio', source, githubUrl });

  it.each([
    ['https://github.com/entri/portfolio', 'GITHUB', null],
    ['https://github.com/entri/portfolio.git', 'GITHUB', null],
    ['https://www.github.com/entri/portfolio', 'GITHUB', null],
    ['  https://github.com/entri/portfolio  ', 'GITHUB', null],
    ['https://gitlab.com/group/sub/repo', 'GITLAB', null],
    ['https://gitlab.com/group/repo', 'GITHUB', 'Repository host (gitlab.com) does not match the selected source (GITHUB)'],
    ['javascript:alert(1)', 'GITHUB', 'Repository URL must use https://'],
    ['http://github.com/entri/portfolio', 'GITHUB', 'Repository URL must use https://'],
    ['git@github.com:entri/portfolio.git', 'GITHUB', 'Repository URL is not a valid URL'],
    ['ssh://git@github.com/entri/portfolio.git', 'GITHUB', 'Repository URL must use https://'],
    ['https://user:token@github.com/entri/portfolio', 'GITHUB', 'Repository URL must not contain embedded credentials'],
    ['https://evil.example.com/entri/portfolio', 'GITHUB', 'Repository must be hosted on github.com or gitlab.com'],
    ['https://github.com/entri', 'GITHUB', 'Repository URL must point to a specific repository (e.g. https://github.com/owner/repo)'],
  ])('%j as %s: %j', (url, source, message) => {
    expect(create(url, source)).toBe(message);
  });

  it('keeps the repository URL and the other fields exactly as sent', () => {
    expect(
      createProjectSchema.parse({ name: 'portfolio', source: 'GITHUB', githubUrl: ' https://github.com/entri/portfolio ', branch: 'main', extra: 1 }),
    ).toEqual({ name: 'portfolio', source: 'GITHUB', githubUrl: ' https://github.com/entri/portfolio ', branch: 'main' });
  });

  it('does not run the repository check while a field is missing', () => {
    const result = createProjectSchema.safeParse({ source: 'GITHUB', githubUrl: 'nope' });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path)).toEqual([['name']]);
  });

  it.each([
    ['feature/login', true],
    ['-rf', false],
    ['a..b', false],
    ['has space', false],
  ])('branch %j accepted: %s', (branch, accepted) => {
    expect(updateProjectSchema.safeParse({ branch }).success).toBe(accepted);
  });
});

describe('defaults, transforms and refinements', () => {
  it('gives a new API token a Deploy scope and a 90-day expiry unless told otherwise', () => {
    expect(createApiTokenSchema.parse({ name: '  CLI  ', password: 'pw' })).toEqual({ name: 'CLI', scope: 'DEPLOY', expiresInDays: 90, password: 'pw' });
    expect(createApiTokenSchema.parse({ name: 'CLI', password: 'pw', scope: 'FULL', expiresInDays: null })).toMatchObject({ scope: 'FULL', expiresInDays: null });
    expect(firstMessage(createApiTokenSchema, { name: 'CLI', password: 'pw', expiresInDays: 45 })).toBe('Expiry must be 30, 90 or 365 days, or no expiry');
    expect(firstMessage(createApiTokenSchema, { name: 'CLI', password: 'pw', expiresInDays: '90' })).toBe('Expiry must be 30, 90 or 365 days, or no expiry');
  });

  it('trims the banner and turns an empty one into null; leaves out fields not sent', () => {
    expect(updatePlatformSettingsSchema.parse({ bannerMessage: '  Maintenance at 6pm  ' })).toEqual({ bannerMessage: 'Maintenance at 6pm' });
    expect(updatePlatformSettingsSchema.parse({ bannerMessage: '   ' })).toEqual({ bannerMessage: null });
    expect(updatePlatformSettingsSchema.parse({ bannerMessage: null })).toEqual({ bannerMessage: null });
    expect(updatePlatformSettingsSchema.parse({})).toEqual({});
    expect(updatePlatformSettingsSchema.safeParse({ defaultProjectQuota: 1.5 }).success).toBe(false);
    expect(updatePlatformSettingsSchema.safeParse({ signupOpen: 'true' }).success).toBe(false);
  });

  it('normalises an access domain and asks for exactly one of email or domain', () => {
    expect(grantAccessSchema.parse({ domain: ' @Entri.ME ' })).toEqual({ domain: 'entri.me' });
    expect(firstMessage(grantAccessSchema, { domain: 'entri' })).toBe('Must be a valid domain like "entri.me"');
    expect(firstMessage(grantAccessSchema, {})).toBe('Provide exactly one of email or domain');
    expect(firstMessage(grantAccessSchema, { email: 'a@entri.me', domain: 'entri.me' })).toBe('Provide exactly one of email or domain');
  });

  it('turns batch dates into Dates and wants the end after the start', () => {
    expect(createCohortSchema.parse({ name: ' Batch 7 ', program: 'MERN', startsAt: '2026-01-05', endsAt: '2026-04-05T10:00:00Z' })).toEqual({
      name: 'Batch 7',
      program: 'MERN',
      startsAt: new Date('2026-01-05'),
      endsAt: new Date('2026-04-05T10:00:00Z'),
    });
    expect(createCohortSchema.parse({ name: 'Batch 7', program: 'MERN', startsAt: 0, endsAt: 86_400_000 }).endsAt).toEqual(new Date(86_400_000));
    const reversed = createCohortSchema.safeParse({ name: 'Batch 7', program: 'MERN', startsAt: '2026-04-05', endsAt: '2026-01-05' });
    expect(reversed.error!.issues).toEqual([expect.objectContaining({ path: ['endsAt'], message: 'The end date must be after the start date' })]);
    const notADate = createCohortSchema.safeParse({ name: 'Batch 7', program: 'MERN', startsAt: 'soon', endsAt: '2026-01-05' });
    expect(notADate.error!.issues.map((i) => i.path)).toEqual([['startsAt']]);
    expect(updateCohortSchema.parse({ endsAt: '2026-05-01' })).toEqual({ endsAt: new Date('2026-05-01') });
    expect(updateCohortSchema.parse({})).toEqual({});
  });

  it('trims a join code and checks its characters', () => {
    expect(joinCodeSchema.parse('  abcdefghijklmnop_-12  ')).toBe('abcdefghijklmnop_-12');
    expect(firstMessage(joinCodeSchema, 'abcdefghijklmnop!')).toBe('Invalid join code');
    expect(joinCodeSchema.safeParse('short').success).toBe(false);
    expect(registerSchema.parse({ email: 'new@entri.me', password: 'long-enough', name: '  Asha ' })).toEqual({ email: 'new@entri.me', password: 'long-enough', name: 'Asha' });
  });

  it('bounds the student list but leaves each address to the service', () => {
    expect(addStudentsSchema.parse({ emails: ['not an email'] })).toEqual({ emails: ['not an email'] });
    expect(addStudentsSchema.safeParse({ emails: [] }).success).toBe(false);
    expect(addStudentsSchema.safeParse({ emails: Array(101).fill('a@entri.me') }).success).toBe(false);
  });

  it('keeps the custom domain and env var messages', () => {
    expect(firstMessage(addDomainSchema, { hostname: '' })).toBe('Enter a domain');
    expect(firstMessage(updateDomainSchema, {})).toBe('Nothing to update');
    expect(updateDomainSchema.safeParse({ isPrimary: false }).success).toBe(false);
    expect(updateDomainSchema.parse({ redirectToPrimary: false })).toEqual({ redirectToPrimary: false });
    expect(firstMessage(createEnvVarSchema, { key: '1BAD', value: 'x' })).toBe('Key must be a valid environment variable name');
    expect(createEnvVarSchema.parse({ key: 'API_KEY', value: '', environment: 'ALL' })).toEqual({ key: 'API_KEY', value: '', environment: 'ALL' });
    expect(firstMessage(uploadProjectSchema, { name: 'my/site' })).toBe('Only letters, numbers, spaces, hyphens, and underscores are allowed');
  });

  it('refuses unknown keys in the tour report', () => {
    const ended = { outcome: 'completed', source: 'auto', last_step: null };
    expect(tourEndedSchema.parse(ended)).toEqual(ended);
    expect(tourEndedSchema.safeParse({ ...ended, extra: 1 }).success).toBe(false);
  });
});
