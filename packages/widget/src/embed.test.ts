import { describe, expect, it } from 'vitest';
import { embedCode, parseEmojis } from './embed.js';

describe('parseEmojis', () => {
  it('reads emojis with or without spaces, keeping order and dropping duplicates', () => {
    expect(parseEmojis('❤️👏  ❤️ 👍🏽👨‍👩‍👧')).toEqual({
      emojis: ['❤️', '👏', '👍🏽', '👨‍👩‍👧'],
      invalid: [],
      dropped: [],
    });
  });

  it('reports text and emojis beyond the limit separately', () => {
    expect(parseEmojis('❤️ hi 👏 💡 😂 🤔 🔥')).toEqual({
      emojis: ['❤️', '👏', '💡', '😂', '🤔'],
      invalid: ['h', 'i'],
      dropped: ['🔥'],
    });
  });
});

describe('embedCode', () => {
  it('builds the script URL from the server and escapes attribute values', () => {
    expect(
      embedCode('inject', {
        emojis: ['❤️'],
        server: 'https://pagemoji.example/',
        variant: 'plain',
        label: ' Was this "useful"? ',
        mount: 'after:.post',
      }),
    ).toBe(
      [
        '<script src="https://pagemoji.example/v1/pagemoji.js" defer',
        '  data-emojis="❤️"',
        '  data-variant="plain"',
        '  data-label="Was this &quot;useful&quot;?"',
        '  data-mount="after:.post"></script>',
      ].join('\n'),
    );
  });

  it('refuses an empty selection', () => {
    expect(() => embedCode('html', { emojis: [], server: 'https://pagemoji.example' })).toThrow(
      RangeError,
    );
  });
});
