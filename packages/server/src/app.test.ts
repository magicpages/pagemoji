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
  const counts = (query: string, ip = '192.0.2.1') =>
    app.request(`/v1/counts?${query}`, { headers: { 'x-test-ip': ip } });

  return { app, react, counts, advance: (ms: number) => (now += ms) };
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
