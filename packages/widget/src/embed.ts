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

export type EmbedTarget =
  /** Script and element, for any HTML page. */
  | 'html'
  /** One script tag for header/footer injection; mounts itself after the post body. */
  | 'inject'
  /** Element for a Ghost `post.hbs`, keyed by post ID. */
  | 'ghost-post'
  /** Read-only element for Ghost post cards. */
  | 'ghost-card';

/** `soft` is the default and needs no attribute. */
export type WidgetVariant = 'soft' | 'outline' | 'plain';

export interface EmbedOptions {
  emojis: readonly string[];
  /** Base URL of the Pagemoji server, e.g. `https://pagemoji.magicpages.co`. */
  server: string;
  variant?: WidgetVariant;
  /** Text shown before the buttons, e.g. "What did you think?". Not used on cards. */
  label?: string;
  /** Where `inject` mounts the widget. Defaults to Ghost's post body. */
  mount?: string;
}

export const DEFAULT_MOUNT = 'after:.gh-content';

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function embedCode(target: EmbedTarget, options: EmbedOptions): string {
  if (options.emojis.length === 0 || options.emojis.length > MAX_EMOJIS_PER_WIDGET) {
    throw new RangeError(`Pick between 1 and ${MAX_EMOJIS_PER_WIDGET} emojis.`);
  }
  const emojis = escape(options.emojis.join(' '));
  const script = escape(new URL('/v1/pagemoji.js', options.server).href);
  const optional = [
    options.variant && options.variant !== 'soft' ? `variant="${options.variant}"` : '',
    options.label?.trim() ? `label="${escape(options.label.trim())}"` : '',
  ].filter(Boolean);
  const element = (...attributes: string[]) =>
    `<pagemoji-reactions ${[...attributes, `emojis="${emojis}"`].join(' ')}></pagemoji-reactions>`;

  switch (target) {
    case 'html':
      return `<script src="${script}" defer></script>\n${element(...optional)}`;
    case 'inject':
      return [
        `<script src="${script}" defer`,
        `  data-emojis="${emojis}"`,
        ...optional.map((attribute) => `  data-${attribute}`),
        `  data-mount="${escape(options.mount ?? DEFAULT_MOUNT)}"></script>`,
      ].join('\n');
    case 'ghost-post':
      return element('page="{{id}}"', ...optional);
    case 'ghost-card':
      return element('page="{{id}}"', 'readonly');
  }
}
