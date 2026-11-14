import { describe, expect, it } from 'vitest';
import { parseReadTokens, tokenMatcher } from './tokens.js';

const A = 'a'.repeat(32);
const B = 'b'.repeat(40);

describe('parseReadTokens', () => {
  it('splits and trims, and is empty when unset', () => {
    expect(parseReadTokens()).toEqual([]);
    expect(parseReadTokens('')).toEqual([]);
    expect(parseReadTokens(` ${A} ,, ${B} `)).toEqual([A, B]);
  });

  it('refuses a short or repeated token without printing it', () => {
    expect(() => parseReadTokens(`${A},${'c'.repeat(31)}`)).toThrow(
      'READ_TOKENS: token 2 is shorter than 32 bytes.',
    );
    expect(() => parseReadTokens(`${A},${B},${A}`)).toThrow(
      'READ_TOKENS: token 3 repeats an earlier one.',
    );
    expect(() => parseReadTokens(' , ,')).toThrow('READ_TOKENS: set, but holds no token.');
  });
});

describe('tokenMatcher', () => {
  it('matches any configured token exactly', () => {
    const matches = tokenMatcher([A, B]);
    expect(matches(A)).toBe(true);
    expect(matches(B)).toBe(true);
    expect(matches(A.slice(1))).toBe(false);
    expect(matches(`${A}a`)).toBe(false);
    expect(matches('')).toBe(false);
  });

  it('matches nothing without tokens', () => {
    expect(tokenMatcher([])('')).toBe(false);
  });
});
