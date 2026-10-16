import {
  MAX_EMOJIS_PER_WIDGET,
  MAX_KEYS_PER_REQUEST,
  isValidPageId,
  normalizeHost,
  pageRef,
  type CountsResponse,
  type PageRef,
  type ReactionRequest,
  type ReactionResponse,
} from './protocol.js';

const DEFAULT_EMOJIS = ['❤️', '👏', '💡'];

// No cookies, and no page URL in a Referer header: the request itself carries
// everything the server needs.
const REQUEST: RequestInit = { credentials: 'omit', referrerPolicy: 'strict-origin' };

const STYLES = `
:host { display: block; }
:host([hidden]) { display: none; }
.r { display: flex; flex-wrap: wrap; gap: var(--pagemoji-gap, 0.5rem); }
button, span.i {
  display: inline-flex; align-items: center; gap: 0.375em;
  font: inherit; font-size: var(--pagemoji-font-size, 1rem); line-height: 1.5;
  color: var(--pagemoji-fg, inherit);
}
button {
  padding: 0.25em 0.75em; cursor: pointer;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-radius: var(--pagemoji-radius, 999px);
  background: var(--pagemoji-bg, transparent);
}
button[aria-pressed='true'] {
  border-color: color-mix(in srgb, currentColor 50%, transparent);
  background: var(--pagemoji-bg-active, color-mix(in srgb, currentColor 12%, transparent));
}
button:active { background: color-mix(in srgb, currentColor 20%, transparent); }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.c { font-variant-numeric: tabular-nums; }
.c:empty { display: none; }
[hidden] { display: none !important; }
`;

let defaultApi: string | undefined;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value, document.baseURI);
  } catch {
    return null;
  }
}

interface Item {
  element: HTMLElement;
  count: HTMLElement;
}

export class PagemojiReactions extends HTMLElement {
  static #queue: PagemojiReactions[] = [];

  #root = this.attachShadow({ mode: 'open' });
  #api = '';
  #ref: PageRef | null = null;
  #page: string | null = null;
  #url = '';
  #emojis: string[] = [];
  #items = new Map<string, Item>();
  #counts: Record<string, number> = {};
  #pressed = new Set<string>();
  #busy = new Set<string>();

  connectedCallback(): void {
    // Moving the element around the DOM must not fetch again.
    if (this.#ref) return;
    const api = parseUrl(this.getAttribute('api') ?? defaultApi ?? '');
    if (!api) return;
    this.#api = api.href.endsWith('/') ? api.href : `${api.href}/`;

    const here = new URL(location.href);
    let target = here;
    const candidate =
      this.getAttribute('url') ??
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
    const parsed = candidate ? parseUrl(candidate) : null;
    // A canonical URL on another host usually marks a republished post; the
    // reactions still belong to this site.
    if (parsed && normalizeHost(parsed.hostname) === normalizeHost(here.hostname)) target = parsed;

    const page = this.getAttribute('page');
    this.#page = page && isValidPageId(page) ? page : null;
    this.#ref = pageRef(target, this.#page);
    this.#url = here.origin + target.pathname;

    const emojis = new Set((this.getAttribute('emojis') ?? '').split(/\s+/).filter(Boolean));
    this.#emojis = emojis.size ? [...emojis].slice(0, MAX_EMOJIS_PER_WIDGET) : DEFAULT_EMOJIS;

    if (PagemojiReactions.#queue.push(this) === 1) {
      queueMicrotask(() => void PagemojiReactions.#flush());
    }
  }

  /** One counts request per server, site and emoji set, however many widgets the page has. */
  static async #flush(): Promise<void> {
    const widgets = PagemojiReactions.#queue;
    PagemojiReactions.#queue = [];
    const groups = new Map<string, PagemojiReactions[]>();
    for (const widget of widgets) {
      const id = [widget.#api, widget.#ref?.host, ...widget.#emojis].join(' ');
      let group = groups.get(id);
      if (!group) groups.set(id, (group = []));
      group.push(widget);
    }
    await Promise.all([...groups.values()].map((group) => PagemojiReactions.#load(group)));
  }

  static async #load(group: PagemojiReactions[]): Promise<void> {
    const [first] = group;
    const host = first ? first.#ref?.host : undefined;
    if (!first || !host) return;
    const keys = [...new Set(group.map((widget) => widget.#ref?.key ?? ''))];
    for (let start = 0; start < keys.length; start += MAX_KEYS_PER_REQUEST) {
      const query = new URLSearchParams({ host });
      for (const key of keys.slice(start, start + MAX_KEYS_PER_REQUEST)) query.append('key', key);
      for (const emoji of first.#emojis) query.append('emoji', emoji);
      try {
        const response = await fetch(new URL(`v1/counts?${query}`, first.#api), REQUEST);
        if (!response.ok) continue;
        const { counts }: CountsResponse = await response.json();
        for (const widget of group) {
          const key = widget.#ref?.key ?? '';
          if (key in counts) widget.#show(counts[key] ?? {});
        }
      } catch {
        // Server unreachable: the widgets stay empty.
      }
    }
  }

  #show(counts: Record<string, number>): void {
    this.#counts = counts;
    if (this.#items.size === 0) this.#build();
    this.#update();
  }

  #build(): void {
    const readonly = this.hasAttribute('readonly');
    const list = document.createElement('div');
    list.className = 'r';
    for (const emoji of this.#emojis) {
      const element = document.createElement(readonly ? 'span' : 'button');
      const count = document.createElement('span');
      count.className = 'c';
      element.append(emoji, count);
      if (element instanceof HTMLButtonElement) {
        element.type = 'button';
        element.setAttribute('part', 'button');
        element.addEventListener('click', () => void this.#toggle(emoji));
      } else {
        element.className = 'i';
      }
      this.#items.set(emoji, { element, count });
      list.append(element);
    }
    const style = document.createElement('style');
    style.textContent = STYLES;
    this.#root.replaceChildren(style, list);
  }

  #update(): void {
    const readonly = this.hasAttribute('readonly');
    const format = new Intl.NumberFormat(undefined, { notation: 'compact' });
    for (const [emoji, { element, count }] of this.#items) {
      const value = this.#counts[emoji] ?? 0;
      count.textContent = value > 0 ? format.format(value) : '';
      if (readonly) element.hidden = value === 0;
      else element.setAttribute('aria-pressed', String(this.#pressed.has(emoji)));
    }
  }

  async #toggle(emoji: string): Promise<void> {
    if (this.#busy.has(emoji)) return;
    this.#busy.add(emoji);
    const adding = !this.#pressed.has(emoji);
    const previous = this.#counts[emoji] ?? 0;
    const flip = (on: boolean): void => {
      if (on) this.#pressed.add(emoji);
      else this.#pressed.delete(emoji);
    };

    flip(adding);
    this.#counts = { ...this.#counts, [emoji]: Math.max(0, previous + (adding ? 1 : -1)) };
    this.#update();

    const body: ReactionRequest = {
      url: this.#url,
      emoji,
      action: adding ? 'add' : 'remove',
      ...(this.#page ? { page: this.#page } : {}),
    };
    try {
      const response = await fetch(new URL('v1/reactions', this.#api), {
        ...REQUEST,
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result: ReactionResponse = await response.json();
      this.#counts = result.counts;
    } catch {
      flip(!adding);
      this.#counts = { ...this.#counts, [emoji]: previous };
    } finally {
      this.#busy.delete(emoji);
      this.#update();
    }
  }
}

export interface DefineOptions {
  /** Base URL of the Pagemoji server, used by widgets without an `api` attribute. */
  api?: string;
}

export function definePagemoji(options: DefineOptions = {}): void {
  if (options.api) defaultApi = options.api;
  if (!customElements.get('pagemoji-reactions')) {
    customElements.define('pagemoji-reactions', PagemojiReactions);
  }
}
