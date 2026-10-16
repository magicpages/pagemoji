/**
 * What every generator needs: turn what a site owner typed or picked into a
 * valid emoji selection, and that selection into embed code. Generators share
 * this module so they all produce the same code.
 */

import { MAX_EMOJIS_PER_WIDGET } from './protocol.js';

export { MAX_EMOJIS_PER_WIDGET };

/** A single fully-qualified emoji: skin tones, ZWJ sequences, flags and keycaps included. */
const SINGLE_EMOJI = /^\p{RGI_Emoji}$/v;

export function isEmoji(value: string): boolean {
  return SINGLE_EMOJI.test(value);
}

export interface EmojiSelection {
  /** Valid, deduplicated, in input order, at most `MAX_EMOJIS_PER_WIDGET`. */
  emojis: string[];
  /** Input that isn't a single emoji. */
  invalid: string[];
  /** Valid emojis beyond the limit. */
  dropped: string[];
}

/** Accepts emojis with or without spaces between them: `❤️👏` and `❤️ 👏` are the same. */
export function parseEmojis(input: string): EmojiSelection {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const selection: EmojiSelection = { emojis: [], invalid: [], dropped: [] };
  const seen = new Set<string>();
  for (const word of input.split(/\s+/).filter(Boolean)) {
    for (const { segment } of segmenter.segment(word)) {
      if (!isEmoji(segment)) {
        selection.invalid.push(segment);
      } else if (!seen.has(segment)) {
        seen.add(segment);
        if (selection.emojis.length < MAX_EMOJIS_PER_WIDGET) selection.emojis.push(segment);
        else selection.dropped.push(segment);
      }
    }
  }
  return selection;
}

export type EmbedVariant =
  /** Script and element, for any HTML page. */
  | 'html'
  /** One script tag for header/footer injection; mounts itself after the post body. */
  | 'inject'
  /** Element for a Ghost `post.hbs`, keyed by post ID. */
  | 'ghost-post'
  /** Read-only element for Ghost post cards. */
  | 'ghost-card';

export interface EmbedOptions {
  emojis: readonly string[];
  /** Base URL of the Pagemoji server, e.g. `https://pagemoji.magicpages.co`. */
  server: string;
  /** Where `inject` mounts the widget. Defaults to Ghost's post body. */
  mount?: string;
}

export const DEFAULT_MOUNT = 'after:.gh-content';

function attr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function embedCode(variant: EmbedVariant, options: EmbedOptions): string {
  if (options.emojis.length === 0 || options.emojis.length > MAX_EMOJIS_PER_WIDGET) {
    throw new RangeError(`Pick between 1 and ${MAX_EMOJIS_PER_WIDGET} emojis.`);
  }
  const emojis = attr(options.emojis.join(' '));
  const script = attr(new URL('/v1/pagemoji.js', options.server).href);
  switch (variant) {
    case 'html':
      return [
        `<script src="${script}" defer></script>`,
        `<pagemoji-reactions emojis="${emojis}"></pagemoji-reactions>`,
      ].join('\n');
    case 'inject':
      return [
        `<script src="${script}" defer`,
        `  data-emojis="${emojis}"`,
        `  data-mount="${attr(options.mount ?? DEFAULT_MOUNT)}"></script>`,
      ].join('\n');
    case 'ghost-post':
      return `<pagemoji-reactions page="{{id}}" emojis="${emojis}"></pagemoji-reactions>`;
    case 'ghost-card':
      return `<pagemoji-reactions page="{{id}}" emojis="${emojis}" readonly></pagemoji-reactions>`;
  }
}
