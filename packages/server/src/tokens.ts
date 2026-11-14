import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_TOKEN_BYTES = 32;

/**
 * `READ_TOKENS`: comma-separated, one token per calling service, so one can be
 * rotated or revoked without touching the others. Refuses a token shorter than
 * 32 bytes or given twice, without ever printing one.
 */
export function parseReadTokens(value = ''): string[] {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0 && value.trim() !== '') {
    throw new Error('READ_TOKENS: set, but holds no token.');
  }
  tokens.forEach((token, index) => {
    if (Buffer.byteLength(token) < MIN_TOKEN_BYTES) {
      throw new Error(`READ_TOKENS: token ${index + 1} is shorter than ${MIN_TOKEN_BYTES} bytes.`);
    }
    if (tokens.indexOf(token) !== index) {
      throw new Error(`READ_TOKENS: token ${index + 1} repeats an earlier one.`);
    }
  });
  return tokens;
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Whether a candidate is one of the tokens, compared in constant time: as
 * digests, so a length difference shows no more than a content difference,
 * and against every token, so the time doesn't tell which one matched.
 */
export function tokenMatcher(tokens: readonly string[]): (candidate: string) => boolean {
  const digests = tokens.map(digest);
  return (candidate) => {
    const given = digest(candidate);
    let match = false;
    for (const token of digests) match = timingSafeEqual(token, given) || match;
    return match;
  };
}
