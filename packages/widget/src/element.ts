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

// Every colour derives from the surrounding text colour and an accent, so the
// widget fits light and dark themes without configuration. Ghost sites supply
// their accent through --ghost-accent-color.
const STYLES = `
:host {
  --_accent: var(--pagemoji-accent, var(--ghost-accent-color, currentColor));
  display: block;
  color: var(--pagemoji-fg, inherit);
  font-size: var(--pagemoji-font-size, 0.9375rem);
}
:host([hidden]) { display: none; }
.r {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: var(--pagemoji-gap, 0.5rem);
  justify-content: var(--pagemoji-justify, flex-start);
}
.l { margin-inline-end: 0.25rem; }
button, .i {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.4em;
  font: inherit; color: inherit; line-height: 1;
}
button {
  min-height: 2.25em;
  padding: var(--pagemoji-padding, 0.3em 0.75em);
  border: 1px solid var(--pagemoji-border, color-mix(in srgb, currentColor 14%, transparent));
  border-radius: var(--pagemoji-radius, 999px);
  background: var(--pagemoji-bg, color-mix(in srgb, currentColor 5%, transparent));
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s, border-color 0.15s;
}
button:hover { background: var(--pagemoji-bg-hover, color-mix(in srgb, currentColor 10%, transparent)); }
button[aria-pressed='true'] {
  border-color: var(--pagemoji-border-active, color-mix(in srgb, var(--_accent) 60%, transparent));
  background: var(--pagemoji-bg-active, color-mix(in srgb, var(--_accent) 14%, transparent));
}
button:active { background: color-mix(in srgb, var(--_accent) 24%, transparent); }
button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
:host([variant='outline']) button:not(:hover, [aria-pressed='true']) { background: transparent; }
:host([variant='plain']) button { padding-inline: 0.5em; border-color: transparent; }
:host([variant='plain']) button:not(:hover, :active, [aria-pressed='true']) { background: transparent; }
.e { position: relative; display: inline-block; }
.g { display: inline-block; font-size: 1.2em; }
.c { display: inline-block; min-width: 1ch; font-variant-numeric: tabular-nums; }
.c:empty { display: none; }
[aria-pressed='true'] .c { font-weight: 600; }
.i .c { opacity: 0.75; }
.p { position: absolute; left: 50%; top: 50%; translate: -50% -50%; font-size: 0.6em; pointer-events: none; }
[hidden] { display: none !important; }
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .g { transition: transform 0.15s ease-out; }
  button:hover .g { transform: scale(1.15); }
}
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
  /** Holds the emoji and, briefly, the burst around it. */
  burst: HTMLElement;
  glyph: HTMLElement;
  count: HTMLElement;
}

const BURST_SIZE = 6;

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
    list.setAttribute('part', 'list');
    const text = this.getAttribute('label')?.trim();
    if (text) {
      const label = document.createElement('span');
      label.className = 'l';
      label.setAttribute('part', 'label');
      label.textContent = text;
      list.append(label);
    }
    for (const emoji of this.#emojis) {
      const element = document.createElement(readonly ? 'span' : 'button');
      const burst = document.createElement('span');
      const glyph = document.createElement('span');
      const count = document.createElement('span');
      burst.className = 'e';
      glyph.className = 'g';
      glyph.setAttribute('part', 'emoji');
      count.className = 'c';
      count.setAttribute('part', 'count');
      glyph.textContent = emoji;
      burst.append(glyph);
      element.append(burst, count);
      if (element instanceof HTMLButtonElement) {
        element.type = 'button';
        element.addEventListener('click', () => void this.#toggle(emoji));
      } else {
        element.className = 'i';
        element.setAttribute('part', 'item');
      }
      this.#items.set(emoji, { element, burst, glyph, count });
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
      else {
        const pressed = this.#pressed.has(emoji);
        element.setAttribute('aria-pressed', String(pressed));
        element.setAttribute('part', pressed ? 'button pressed' : 'button');
      }
    }
  }

  /**
   * Feedback for the reader's own click, never for counts loading or changing
   * by themselves. Adding celebrates; taking a reaction back stays quiet.
   */
  #animate(emoji: string, adding: boolean): void {
    const item = this.#items.get(emoji);
    if (!item || !window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) return;
    const { burst, glyph, count } = item;
    for (const animation of glyph.getAnimations()) animation.cancel();

    glyph.animate(
      {
        transform: adding
          ? ['scale(1)', 'scale(1.4)', 'scale(0.92)', 'scale(1)']
          : ['scale(1)', 'scale(0.8)', 'scale(1)'],
      },
      { duration: adding ? 400 : 200, easing: 'ease-out' },
    );
    if (count.textContent) {
      count.animate(
        { transform: [`translateY(${adding ? 0.4 : -0.4}em)`, 'none'], opacity: [0, 1] },
        { duration: 200, easing: 'ease-out' },
      );
    }
    if (!adding) return;

    const offset = Math.random();
    for (let i = 0; i < BURST_SIZE; i++) {
      const angle = ((i + offset) / BURST_SIZE) * 2 * Math.PI;
      const distance = 1.3 + Math.random() * 0.5;
      const particle = document.createElement('span');
      particle.className = 'p';
      particle.textContent = emoji;
      particle.setAttribute('aria-hidden', 'true');
      burst.append(particle);
      particle.animate(
        {
          transform: [
            'scale(0.6)',
            `translate(${Math.cos(angle) * distance}em, ${Math.sin(angle) * distance}em) scale(0.3)`,
          ],
          opacity: [1, 1, 0],
        },
        { duration: 450, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
      ).onfinish = () => particle.remove();
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
    this.#animate(emoji, adding);

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
