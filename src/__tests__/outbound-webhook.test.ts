import * as net from 'net';
import type { LookupAddress } from 'dns';

// What each test hostname resolves to. Everything else fails like an unknown name.
const mockAnswers: Record<string, string[]> = {};
jest.mock('dns', () => ({
  ...jest.requireActual('dns'),
  lookup: (hostname: string, _opts: unknown, cb: (err: Error | null, addresses: LookupAddress[]) => void) => {
    const answer = mockAnswers[hostname];
    if (!answer) return cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), []);
    cb(null, answer.map((address) => ({ address, family: 4 })));
  },
}));

import { BlockedAddressError, guardedLookup, parseHookUrl, postJson } from '@/lib/outbound-webhook';

function lookup(hostname: string, all: boolean): Promise<{ err: Error | null; address: unknown; family?: number }> {
  return new Promise((resolve) => {
    guardedLookup(hostname, { all }, (err, address, family) => resolve({ err, address, family }));
  });
}

describe('parseHookUrl', () => {
  it.each([
    ['http://hooks.slack.com/services/T/B/x', /https:\/\//],
    ['https://user:pass@example.com/hook', /username or password/],
    ['https://example.com:8443/hook', /port/],
    ['https://127.0.0.1/hook', /not an IP/],
    ['https://2130706433/hook', /not an IP/],
    ['https://0x7f.1/hook', /not an IP/],
    ['https://[::1]/hook', /not an IP/],
    ['https://169.254.169.254/latest/meta-data/', /not an IP/],
    ['not a url', /full URL/],
  ])('refuses %s', (input, message) => {
    expect(() => parseHookUrl(input)).toThrow(message);
  });

  it('accepts a Slack webhook and an explicit :443', () => {
    expect(parseHookUrl('https://hooks.slack.com/services/T/B/x').hostname).toBe('hooks.slack.com');
    expect(parseHookUrl('https://example.com:443/hook').href).toBe('https://example.com/hook');
  });
});

describe('guardedLookup', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.17.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1'])(
    'refuses a name that resolves to %s',
    async (address) => {
      mockAnswers['private.test'] = [address];
      expect((await lookup('private.test', false)).err).toBeInstanceOf(BlockedAddressError);
    },
  );

  it('refuses a name when any of its addresses is private', async () => {
    mockAnswers['mixed.test'] = ['8.8.8.8', '10.0.0.1'];
    expect((await lookup('mixed.test', true)).err).toBeInstanceOf(BlockedAddressError);
  });

  it('answers in the shape Node asked for', async () => {
    mockAnswers['public.test'] = ['8.8.8.8', '1.1.1.1'];
    expect(await lookup('public.test', true)).toEqual({
      err: null,
      address: [{ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 }],
      family: undefined,
    });
    expect(await lookup('public.test', false)).toEqual({ err: null, address: '8.8.8.8', family: 4 });
  });

  it('never opens a connection to a name that resolves to loopback', async () => {
    let connections = 0;
    const server = net.createServer((socket) => { connections++; socket.destroy(); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    mockAnswers['rebind.test'] = ['127.0.0.1'];

    const err = await new Promise<Error>((resolve) => {
      net.connect({ host: 'rebind.test', port, lookup: guardedLookup }).on('error', resolve).on('connect', () => resolve(new Error('connected')));
    });
    await new Promise((resolve) => server.close(resolve));
    expect(err).toBeInstanceOf(BlockedAddressError);
    expect(connections).toBe(0);
  });

  it('is what postJson connects through', async () => {
    mockAnswers['rebind.test'] = ['127.0.0.1'];
    await expect(postJson(new URL('https://rebind.test/hook'), '{}', {})).rejects.toBeInstanceOf(BlockedAddressError);
  });
});
