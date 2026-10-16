/**
 * The contract between the widget and the server: limits, page identity and
 * the JSON shapes on the wire. Both sides import this module, so a page key is
 * computed by exactly one function.
 */

export const MAX_EMOJIS_PER_WIDGET = 5;
export const MAX_KEYS_PER_REQUEST = 100;

const PAGE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export interface PageRef {
  host: string;
  /** `id:<page id>` when the page has a stable ID, otherwise the path. */
  key: string;
}

export function isValidPageId(value: string): boolean {
  return PAGE_ID.test(value);
}

/** Lowercase, without a trailing dot or a leading `www.`. */
export function normalizeHost(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host.startsWith('www.') ? host.slice(4) : host;
}

/**
 * The page a reaction belongs to. Paths start with `/` and IDs with `id:`, so
 * the two kinds of key can never collide.
 */
export function pageRef(url: URL, pageId?: string | null): PageRef {
  const host = normalizeHost(url.hostname);
  if (pageId) return { host, key: `id:${pageId}` };
  return { host, key: url.pathname.replace(/\/+$/, '') || '/' };
}

/** `GET /v1/counts`: `{ [key]: { [emoji]: count } }` */
export interface CountsResponse {
  counts: Record<string, Record<string, number>>;
}

/**
 * `POST /v1/reactions`. Sent as `text/plain` so the browser doesn't need a CORS
 * preflight; the body is still JSON. `url` is origin and path only.
 */
export interface ReactionRequest {
  url: string;
  page?: string;
  emoji: string;
  action: 'add' | 'remove';
}

export interface ReactionResponse {
  key: string;
  /** False when the duplicate guard turned the request into a no-op. */
  applied: boolean;
  /** Every emoji counted on the page, not only the ones in this widget. */
  counts: Record<string, number>;
}

export interface ErrorResponse {
  error: string;
}
