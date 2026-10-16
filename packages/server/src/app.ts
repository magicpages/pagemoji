import { isEmoji } from '@magicpages/pagemoji/embed';
import {
  MAX_EMOJIS_PER_WIDGET,
  MAX_KEYS_PER_REQUEST,
  isValidPageId,
  normalizeHost,
  pageRef,
  type ErrorResponse,
  type ReactionRequest,
  type ReactionResponse,
} from '@magicpages/pagemoji/protocol';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { Store } from './db.js';
import type { Shield } from './shield.js';

const MAX_URL_LENGTH = 2048;
const MAX_BODY_LENGTH = 4096;

export interface AppOptions {
  store: Store;
  shield: Shield;
  /** `['*']` allows every origin. */
  allowedOrigins: readonly string[];
  clientIp: (c: Context) => string;
  /** Source of the widget's script-tag build. */
  widget: string;
}

type Env = { Variables: { client: string } };

function parseUrl(value: string): URL | null {
  return value.length <= MAX_URL_LENGTH && URL.canParse(value) ? new URL(value) : null;
}

function parseReaction(text: string): { request: ReactionRequest; url: URL } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const field = (name: keyof ReactionRequest): unknown => Reflect.get(value, name);
  const [url, page, emoji, action] = [field('url'), field('page'), field('emoji'), field('action')];

  const parsed = typeof url === 'string' ? parseUrl(url) : null;
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return null;
  if (page !== undefined && (typeof page !== 'string' || !isValidPageId(page))) return null;
  if (typeof emoji !== 'string' || !isEmoji(emoji)) return null;
  if (action !== 'add' && action !== 'remove') return null;
  return {
    request: { url: parsed.href, emoji, action, ...(page === undefined ? {} : { page }) },
    url: parsed,
  };
}

export function createApp({
  store,
  shield,
  allowedOrigins,
  clientIp,
  widget,
}: AppOptions): Hono<Env> {
  const app = new Hono<Env>();
  const anyOrigin = allowedOrigins.includes('*');
  const error = (c: Context, status: 400 | 403 | 429 | 500, message: string) =>
    c.json<ErrorResponse, typeof status>({ error: message }, status);

  app.use(
    '/v1/*',
    cors({ origin: anyOrigin ? '*' : [...allowedOrigins], allowMethods: ['GET', 'POST'] }),
  );

  for (const path of ['/v1/counts', '/v1/reactions']) {
    app.use(path, async (c, next) => {
      const client = shield.client(clientIp(c));
      const wait = shield.limit(client);
      if (wait > 0) {
        c.header('Retry-After', String(wait));
        return error(c, 429, 'Too many requests.');
      }
      c.set('client', client);
      return next();
    });
  }

  app.get('/v1/counts', (c) => {
    const host = c.req.query('host');
    const keys = [...new Set(c.req.queries('key') ?? [])];
    const emojis = [...new Set(c.req.queries('emoji') ?? [])];
    if (
      !host ||
      keys.length === 0 ||
      keys.length > MAX_KEYS_PER_REQUEST ||
      keys.some((key) => key.length > MAX_URL_LENGTH) ||
      emojis.length === 0 ||
      emojis.length > MAX_EMOJIS_PER_WIDGET ||
      !emojis.every(isEmoji)
    ) {
      return error(c, 400, 'Expected host, 1 to 100 keys and 1 to 5 emojis.');
    }
    c.header('Cache-Control', 'public, max-age=10');
    return c.json({ counts: store.counts(normalizeHost(host), keys, emojis) });
  });

  app.post('/v1/reactions', async (c) => {
    const text = await c.req.text();
    const parsed = text.length <= MAX_BODY_LENGTH ? parseReaction(text) : null;
    if (!parsed) return error(c, 400, 'Expected { url, page?, emoji, action }.');
    const { request, url } = parsed;

    // The body is sent as text/plain, which browsers send without a preflight,
    // so CORS alone doesn't keep other sites out: check the origin here.
    const origin = parseUrl(c.req.header('origin') ?? '');
    if (
      !origin ||
      (!anyOrigin && !allowedOrigins.includes(origin.origin)) ||
      normalizeHost(origin.hostname) !== normalizeHost(url.hostname)
    ) {
      return error(c, 403, 'Reactions must come from the page they are for.');
    }

    const { host, key } = pageRef(url, request.page);
    const reaction = `${host}\n${key}\n${request.emoji}`;
    const client = c.get('client');
    const adding = request.action === 'add';
    const applied = adding ? shield.add(client, reaction) : shield.remove(client, reaction);
    const counts = applied
      ? store.change(host, key, request.emoji, adding ? 1 : -1)
      : store.page(host, key);
    return c.json<ReactionResponse>({ key, applied, counts });
  });

  app.get('/v1/pagemoji.js', (c) =>
    c.body(widget, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    }),
  );

  app.get('/healthz', (c) => {
    store.ping();
    return c.text('ok');
  });

  app.get('/', (c) => c.text('Pagemoji server. See https://github.com/magicpages/pagemoji\n'));

  // Only the message: requests carry IP addresses and URLs, which never get logged.
  app.onError((err, c) => {
    console.error(`pagemoji: ${err.message}`);
    return error(c, 500, 'Internal error.');
  });

  return app;
}
