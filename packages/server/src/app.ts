import { domainToASCII } from 'node:url';
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
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { Sighting, Store } from './db.js';
import type { Shield } from './shield.js';
import { tokenMatcher } from './tokens.js';

const MAX_URL_LENGTH = 2048;
const MAX_BODY_BYTES = 4096;
const HOUR = 3_600_000;

export interface AppOptions {
  store: Store;
  shield: Shield;
  /** `['*']` allows every origin. */
  allowedOrigins: readonly string[];
  clientIp: (c: Context) => string;
  /** Source of the widget's script-tag build. */
  widget: string;
  /** `READ_TOKENS`, one per calling service. None: every request is a reader's. */
  readTokens?: readonly string[];
  now?: () => number;
}

/** `GET /v1/hosts/:host` */
interface HostResponse extends Sighting {
  host: string;
}

type Env = { Variables: { client: string; service: boolean } };

function parseUrl(value: string): URL | null {
  return value.length <= MAX_URL_LENGTH && URL.canParse(value) ? new URL(value) : null;
}

/**
 * A host as given by a caller, keyed as the widget keys it: from `URL.hostname`,
 * so punycode for internationalised domains, and without `www.`.
 */
function siteHost(value: string): string {
  return normalizeHost(domainToASCII(value) || value);
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
  readTokens = [],
  now = Date.now,
}: AppOptions): Hono<Env> {
  const app = new Hono<Env>();
  const anyOrigin = allowedOrigins.includes('*');
  const error = (c: Context, status: 400 | 401 | 403 | 404 | 413 | 429 | 500, message: string) =>
    c.json<ErrorResponse, typeof status>({ error: message }, status);

  /** Whether the request comes from a page on the host, through an allowed origin. */
  const fromHost = (c: Context, host: string): boolean => {
    const origin = parseUrl(c.req.header('origin') ?? '');
    return (
      origin !== null &&
      (anyOrigin || allowedOrigins.includes(origin.origin)) &&
      normalizeHost(origin.hostname) === normalizeHost(host)
    );
  };

  const isReadToken = tokenMatcher(readTokens);
  /**
   * The bearer token, `''` for any other `Authorization`, and undefined without
   * one or when no read tokens are configured, so self-hosters see no change.
   */
  const bearer = (c: Context): string | undefined => {
    const authorization = c.req.header('authorization');
    if (readTokens.length === 0 || authorization === undefined) return undefined;
    return /^Bearer (.+)$/i.exec(authorization)?.[1] ?? '';
  };
  const unauthorized = (c: Context) => {
    c.header('WWW-Authenticate', 'Bearer');
    return error(c, 401, 'Expected a valid read token.');
  };

  /** Counts a request against its client's limit. A response when over it. */
  const limit = (c: Context<Env>): Response | undefined => {
    const client = shield.client(clientIp(c));
    const wait = shield.limit(client);
    if (wait > 0) {
      c.header('Retry-After', String(wait));
      return error(c, 429, 'Too many requests.');
    }
    c.set('client', client);
    return undefined;
  };

  app.use(
    '/v1/*',
    cors({ origin: anyOrigin ? '*' : [...allowedOrigins], allowMethods: ['GET', 'POST'] }),
  );

  app.use('/v1/reactions', async (c, next) => limit(c) ?? next());

  // A service with a read token asks for many sites from one address, so it
  // has no per-client limit. A wrong token still counts against the limit, so
  // guessing stays slow, and is refused rather than read as no token, so a
  // misconfigured service fails loudly instead of running into 429s.
  app.use('/v1/counts', async (c, next) => {
    const token = bearer(c);
    const service = token !== undefined && isReadToken(token);
    c.set('service', service);
    if (service) return next();
    return limit(c) ?? (token === undefined ? next() : unauthorized(c));
  });

  // Hosts noted this hour. Cleared on the hour, so it holds an hour's hosts at
  // most, and the database sees at most one write per host and hour.
  let seenHour = -1;
  const seenHosts = new Set<string>();

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
    const site = siteHost(host);

    // A widget on the site, not a service reading its counts: note host, path
    // and time, so its owner can tell the widget is installed. Nothing else.
    if (!c.get('service') && fromHost(c, site)) {
      const at = now();
      if (Math.floor(at / HOUR) !== seenHour) {
        seenHour = Math.floor(at / HOUR);
        seenHosts.clear();
      }
      if (!seenHosts.has(site)) {
        seenHosts.add(site);
        store.see(site, keys.find((key) => key.startsWith('/')) ?? null, new Date(at));
      }
    }

    c.header('Cache-Control', 'public, max-age=10');
    return c.json({ counts: store.counts(site, keys, emojis) });
  });

  // Token only. Failed attempts count against the per-client limit, as on counts.
  app.get('/v1/hosts/:host', (c) => {
    const token = bearer(c);
    if (token === undefined || !isReadToken(token)) return limit(c) ?? unauthorized(c);
    const host = siteHost(c.req.param('host'));
    const sighting = store.sighting(host);
    if (!sighting) return error(c, 404, 'No widget seen on this host.');
    return c.json<HostResponse>({ host, ...sighting });
  });

  // Stops reading at the limit, rather than reading the whole body and checking it after.
  const limitBody = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => error(c, 413, 'Request body too large.'),
  });

  app.post('/v1/reactions', limitBody, async (c) => {
    const parsed = parseReaction(await c.req.text());
    if (!parsed) return error(c, 400, 'Expected { url, page?, emoji, action }.');
    const { request, url } = parsed;

    // The body is sent as text/plain, which browsers send without a preflight,
    // so CORS alone doesn't keep other sites out: check the origin here.
    if (!fromHost(c, url.hostname)) {
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
