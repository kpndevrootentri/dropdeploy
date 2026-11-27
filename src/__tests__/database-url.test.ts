import { getDbConfig } from '@/lib/config';
import { buildDatabaseUrl } from '@/lib/database-url';

const DB = { DB_CONNECTION_LIMIT: 10, DB_POOL_TIMEOUT_SECONDS: 10, DB_STATEMENT_TIMEOUT_MS: 30_000 };
const BASE = 'postgresql://dropdeploy:p%40ss@localhost:5432/dropdeploy';

describe('buildDatabaseUrl', () => {
  it('appends every setting after the existing parameters, leaving them as written', () => {
    expect(buildDatabaseUrl(`${BASE}?schema=public&sslmode=require`, DB)).toBe(
      `${BASE}?schema=public&sslmode=require&connection_limit=10&pool_timeout=10&options=-c%20statement_timeout%3D30000`,
    );
  });

  it('starts the query string when the URL has none', () => {
    expect(buildDatabaseUrl(BASE, DB)).toBe(
      `${BASE}?connection_limit=10&pool_timeout=10&options=-c%20statement_timeout%3D30000`,
    );
  });

  it('encodes the options value so a parser reads back exactly the Postgres flag', () => {
    const params = new URL(buildDatabaseUrl(`${BASE}?schema=public`, DB)).searchParams;
    expect(params.get('options')).toBe('-c statement_timeout=30000');
    expect(params.get('schema')).toBe('public');
  });

  it('keeps values the URL already sets', () => {
    const url = `${BASE}?connection_limit=3&schema=public&options=-c%20statement_timeout%3D5s`;
    expect(buildDatabaseUrl(url, DB)).toBe(`${url}&pool_timeout=10`);
  });

  it('leaves a user-set options value alone even without a statement timeout in it', () => {
    const url = `${BASE}?options=-c%20search_path%3Dapp`;
    expect(new URL(buildDatabaseUrl(url, DB)).searchParams.getAll('options')).toEqual(['-c search_path=app']);
  });

  it('returns the URL unchanged when it sets all three', () => {
    const url = `${BASE}?connection_limit=3&pool_timeout=5&options=-c%20statement_timeout%3D1000`;
    expect(buildDatabaseUrl(url, DB)).toBe(url);
  });
});

describe('getDbConfig', () => {
  const realEnv = process.env;
  afterEach(() => {
    process.env = realEnv;
  });
  const withEnv = (env: Record<string, string>) => {
    process.env = env as unknown as NodeJS.ProcessEnv;
    return getDbConfig();
  };

  it('defaults when unset, empty or blank', () => {
    expect(withEnv({})).toEqual(DB);
    expect(withEnv({ DB_CONNECTION_LIMIT: '', DB_POOL_TIMEOUT_SECONDS: '', DB_STATEMENT_TIMEOUT_MS: '' })).toEqual(DB);
    expect(withEnv({ DB_CONNECTION_LIMIT: ' ', DB_POOL_TIMEOUT_SECONDS: ' ', DB_STATEMENT_TIMEOUT_MS: '  ' })).toEqual(DB);
  });

  it('reads set values, 0 turning the timeouts off', () => {
    expect(withEnv({ DB_CONNECTION_LIMIT: '4', DB_POOL_TIMEOUT_SECONDS: '0', DB_STATEMENT_TIMEOUT_MS: '0' })).toEqual({
      DB_CONNECTION_LIMIT: 4,
      DB_POOL_TIMEOUT_SECONDS: 0,
      DB_STATEMENT_TIMEOUT_MS: 0,
    });
  });

  it.each<Record<string, string>>([{ DB_CONNECTION_LIMIT: '0' }, { DB_CONNECTION_LIMIT: 'ten' }, { DB_STATEMENT_TIMEOUT_MS: '1.5' }, { DB_POOL_TIMEOUT_SECONDS: '-1' }])(
    'rejects %p',
    (env) => {
      expect(() => withEnv(env)).toThrow(/Invalid env/);
    },
  );
});
