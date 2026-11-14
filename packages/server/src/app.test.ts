import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type AppOptions } from './app.js';
import { openStore, type Store } from './db.js';
import { Shield } from './shield.js';

const HOUR = 3_600_000;
let store: Store;

function setup(overrides: Partial<AppOptions> & { requestsPerMinute?: number } = {}) {
  let now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const { requestsPerMinute = 60, ...options } = overrides;
  store = openStore(':memory:');
  const app = createApp({
    store,
    shield: new Shield({ now: () => now, requestsPerMinute }),
    allowedOrigins: ['*'],
    widget: '/* widget */',
    clientIp: (c) => c.req.header('x-test-ip') ?? '192.0.2.1',
    now: () => now,
    ...options,
  });

  const react = (
    body: Record<string, unknown>,
    { origin = 'https://example.com', ip = '192.0.2.1' } = {},
  ) =>
    app.request('/v1/reactions', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin, 'x-test-ip': ip },
      body: JSON.stringify(body),
    });
  const counts = (query: string, ip = '192.0.2.1', headers: Record<string, string> = {}) =>
    app.request(`/v1/counts?${query}`, { headers: { 'x-test-ip': ip, ...headers } });
  const hosts = (host: string, headers: Record<string, string> = {}) =>
    app.request(`/v1/hosts/${host}`, { headers });

  return { app, react, counts, hosts, advance: (ms: number) => (now += ms) };
}

const like = (extra: Record<string, unknown> = {}) => ({
  url: 'https://example.com/post/',
  emoji: '❤️',
  action: 'add',
  ...extra,
});

afterEach(() => store.close());

describe('POST /v1/reactions', () => {
  it('counts a reaction once per client and returns every count on the page', async () => {
    const { react } = setup();
    await react(like({ emoji: '👏' }), { ip: '192.0.2.9' });

    const first = await react(like());
    expect(await first.json()).toEqual({
      key: '/post',
      applied: true,
      counts: { '❤️': 1, '👏': 1 },
    });

    const again = await react(like());
    expect(await again.json()).toEqual({
      key: '/post',
      applied: false,
      counts: { '❤️': 1, '👏': 1 },
    });
  });

  it('removes only reactions the same client gave', async () => {
    const { react } = setup();
    await react(like());

    const stranger = await react(like({ action: 'remove' }), { ip: '192.0.2.2' });
    expect(await stranger.json()).toMatchObject({ applied: false, counts: { '❤️': 1 } });

    const own = await react(like({ action: 'remove' }));
    expect(await own.json()).toMatchObject({ applied: true, counts: {} });
  });

  it('keys a page by its ID when one is given, independent of the URL', async () => {
    const { react } = setup();
    await react(like({ url: 'https://example.com/old-slug', page: 'abc123' }));
    const moved = await react(like({ url: 'https://www.example.com/new-slug', page: 'abc123' }), {
      origin: 'https://www.example.com',
      ip: '192.0.2.2',
    });
    expect(await moved.json()).toMatchObject({ key: 'id:abc123', counts: { '❤️': 2 } });
  });

  it('forgets who reacted when the salt rotates', async () => {
    const { react, advance } = setup();
    await react(like());
    advance(HOUR);
    const response = await react(like({ action: 'remove' }));
    expect(await response.json()).toMatchObject({ applied: false, counts: { '❤️': 1 } });
  });

  it('treats an IPv6 /64 as one client, however the address is written', async () => {
    const { react } = setup();
    for (const [ip, applied] of [
      ['2001:db8:1:2::1', true],
      ['2001:db8:1:2:ffff:ffff:ffff:9', false],
      ['2001:0DB8:0001:0002:0000:0000:0000:0005', false],
      ['2001:db8:1:3::1', true],
    ] as const) {
      expect(await (await react(like(), { ip })).json()).toMatchObject({ applied });
    }
  });

  it('keeps IPv4 clients apart when they arrive as IPv4-mapped IPv6', async () => {
    const { react } = setup();
    for (const [ip, applied] of [
      ['::ffff:192.0.2.1', true],
      ['::ffff:192.0.2.2', true],
      ['192.0.2.1', false],
    ] as const) {
      expect(await (await react(like(), { ip })).json()).toMatchObject({ applied });
    }
  });

  it.each([
    ['no origin', ''],
    ['another site', 'https://evil.example'],
    ['an opaque origin', 'null'],
  ])('rejects a reaction from %s', async (_, origin) => {
    const { react } = setup();
    const response = await react(like(), { origin });
    expect(response.status).toBe(403);
  });

  it('rejects origins outside ALLOWED_ORIGINS even for their own pages', async () => {
    const { react } = setup({ allowedOrigins: ['https://example.com'] });
    expect((await react(like())).status).toBe(200);
    const other = await react(like({ url: 'https://other.example/post' }), {
      origin: 'https://other.example',
    });
    expect(other.status).toBe(403);
  });

  it.each([
    ['text instead of an emoji', like({ emoji: 'a' })],
    ['two emojis', like({ emoji: '❤️❤️' })],
    ['an unknown action', like({ action: 'toggle' })],
    ['a non-http URL', like({ url: 'javascript:alert(1)' })],
    ['an invalid page ID', like({ page: '{{id}}' })],
  ])('rejects %s', async (_, body) => {
    const { react } = setup();
    const response = await react(body);
    expect(response.status).toBe(400);
  });

  it('accepts skin tones, ZWJ sequences, flags and keycaps', async () => {
    const { react } = setup();
    for (const emoji of ['👍🏽', '👨‍👩‍👧', '🇦🇹', '1️⃣']) {
      expect((await react(like({ emoji }))).status).toBe(200);
    }
  });

  it('rejects an oversized body without reading all of it', async () => {
    const { app } = setup();
    const chunk = new TextEncoder().encode('x'.repeat(1024));
    let read = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (read >= 1024 * 1024) return controller.close();
        read += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const response = await app.request('/v1/reactions', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://example.com' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(read).toBeLessThan(64 * 1024);
  });
});

describe('GET /v1/counts', () => {
  it('returns counts for many pages in one request, with unknown pages empty', async () => {
    const { react, counts } = setup();
    await react(like());
    await react(like({ url: 'https://example.com/other', emoji: '👏' }));

    const response = await counts(
      'host=www.example.com&key=/post&key=/other&key=/new&emoji=❤️&emoji=👏',
    );
    expect(response.headers.get('cache-control')).toBe('public, max-age=10');
    expect(await response.json()).toEqual({
      counts: { '/post': { '❤️': 1 }, '/other': { '👏': 1 }, '/new': {} },
    });
  });

  it('rejects more than five emojis', async () => {
    const { counts } = setup();
    const response = await counts(
      'host=example.com&key=/&emoji=❤️&emoji=👏&emoji=💡&emoji=😂&emoji=🤔&emoji=🔥',
    );
    expect(response.status).toBe(400);
  });
});

describe('rate limit', () => {
  it('limits each client per minute and tells it when to retry', async () => {
    const { counts, advance } = setup({ requestsPerMinute: 2 });
    const query = 'host=example.com&key=/&emoji=❤️';
    advance(15_000);
    expect((await counts(query)).status).toBe(200);
    expect((await counts(query)).status).toBe(200);

    const limited = await counts(query);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('45');
    expect((await counts(query, '192.0.2.2')).status).toBe(200);

    advance(45_000);
    expect((await counts(query)).status).toBe(200);
  });

  it('shares the limit across an IPv6 /64', async () => {
    const { counts } = setup({ requestsPerMinute: 2 });
    const query = 'host=example.com&key=/&emoji=❤️';
    expect((await counts(query, '2001:db8::1')).status).toBe(200);
    expect((await counts(query, '2001:db8::2')).status).toBe(200);
    expect((await counts(query, '2001:db8::3')).status).toBe(429);
    expect((await counts(query, '2001:db8:0:1::1')).status).toBe(200);
  });
});

const TOKEN = 'portal-token-'.padEnd(40, 'x');
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const query = 'host=example.com&key=/&emoji=❤️';

describe('read tokens', () => {
  it('lift the per-client limit on counts, and nothing else', async () => {
    const { counts } = setup({
      requestsPerMinute: 1,
      readTokens: ['other-'.padEnd(40, 'y'), TOKEN],
    });
    for (let i = 0; i < 5; i++) {
      expect((await counts(query, undefined, bearer(TOKEN))).status).toBe(200);
    }
    expect((await counts(query)).status).toBe(200);
    expect((await counts(query)).status).toBe(429);

    const keys = Array.from({ length: 101 }, (_, i) => `key=/${i}`).join('&');
    const tooMany = await counts(`host=example.com&${keys}&emoji=❤️`, undefined, bearer(TOKEN));
    expect(tooMany.status).toBe(400);
  });

  it.each([
    ['a wrong token', bearer('wrong-'.padEnd(40, 'z'))],
    ['a prefix of the token', bearer(TOKEN.slice(0, -1))],
    ['another scheme', { authorization: `Basic ${TOKEN}` }],
  ])('refuse %s, which still counts against the limit', async (_, headers) => {
    const { counts } = setup({ requestsPerMinute: 1, readTokens: [TOKEN] });
    const refused = await counts(query, undefined, headers);
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toBe('Bearer');
    expect((await counts(query, undefined, headers)).status).toBe(429);
  });

  it('change nothing while READ_TOKENS is unset', async () => {
    const { counts } = setup({ requestsPerMinute: 1 });
    expect((await counts(query, undefined, bearer(TOKEN))).status).toBe(200);
    expect((await counts(query, undefined, bearer(TOKEN))).status).toBe(429);
  });
});

describe('last seen', () => {
  it('notes host, path and time from the first counts request per host and hour', async () => {
    const { counts, hosts, advance } = setup({ readTokens: [TOKEN] });
    await counts('host=www.example.com&key=id:abc&key=/post&key=/other&emoji=❤️', undefined, {
      origin: 'https://www.example.com',
    });
    advance(30 * 60_000);
    await counts('host=example.com&key=/later&emoji=❤️', undefined, {
      origin: 'https://example.com',
    });

    const seen = await hosts('www.example.com', bearer(TOKEN));
    expect(await seen.json()).toEqual({
      host: 'example.com',
      lastSeenAt: '2026-01-01T12:00:00.000Z',
      lastSeenPath: '/post',
    });

    advance(30 * 60_000);
    await counts('host=example.com&key=id:abc&emoji=❤️', undefined, {
      origin: 'https://example.com',
    });
    expect(await (await hosts('example.com', bearer(TOKEN))).json()).toEqual({
      host: 'example.com',
      lastSeenAt: '2026-01-01T13:00:00.000Z',
      lastSeenPath: null,
    });
  });

  it.each([
    ['a read token', { origin: 'https://example.com', ...bearer(TOKEN) }],
    ['no origin', {}],
    ['another site', { origin: 'https://evil.example' }],
  ])('notes nothing for a request with %s', async (_, headers) => {
    const { counts, hosts } = setup({ readTokens: [TOKEN] });
    expect((await counts('host=example.com&key=/post&emoji=❤️', undefined, headers)).status).toBe(
      200,
    );
    expect((await hosts('example.com', bearer(TOKEN))).status).toBe(404);
  });

  it('notes nothing from origins outside ALLOWED_ORIGINS', async () => {
    const { counts, hosts } = setup({
      readTokens: [TOKEN],
      allowedOrigins: ['https://other.example'],
    });
    await counts(query, undefined, { origin: 'https://example.com' });
    expect((await hosts('example.com', bearer(TOKEN))).status).toBe(404);
  });
});

describe('GET /v1/hosts/:host', () => {
  it.each([
    ['no token', {}],
    ['a wrong token', bearer('wrong-'.padEnd(40, 'z'))],
  ])('refuses %s, which counts against the limit', async (_, headers) => {
    const { counts, hosts } = setup({ readTokens: [TOKEN], requestsPerMinute: 2 });
    await counts(query, undefined, { origin: 'https://example.com' });
    const response = await hosts('example.com', headers);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect((await hosts('example.com', headers)).status).toBe(429);
    expect((await hosts('example.com', bearer(TOKEN))).status).toBe(200);
  });

  it('refuses every token while READ_TOKENS is unset', async () => {
    const { hosts } = setup();
    expect((await hosts('example.com', bearer(TOKEN))).status).toBe(401);
  });

  it('finds an internationalised domain written in Unicode or punycode', async () => {
    const { react, counts, hosts } = setup({ readTokens: [TOKEN] });
    const origin = 'https://xn--bcher-kva.example';
    await react(like({ url: 'https://bücher.example/post' }), { origin });
    await counts('host=xn--bcher-kva.example&key=/post&emoji=❤️', undefined, { origin });

    for (const host of [encodeURIComponent('www.Bücher.example'), 'xn--bcher-kva.example']) {
      expect(await (await hosts(host, bearer(TOKEN))).json()).toMatchObject({
        host: 'xn--bcher-kva.example',
        lastSeenPath: '/post',
      });
    }
    const read = await counts('host=bücher.example&key=/post&emoji=❤️', undefined, bearer(TOKEN));
    expect(await read.json()).toEqual({ counts: { '/post': { '❤️': 1 } } });
  });

  it('is 404 for a host no widget was seen on', async () => {
    const { hosts } = setup({ readTokens: [TOKEN] });
    const response = await hosts('example.com', bearer(TOKEN));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'No widget seen on this host.' });
  });
});
