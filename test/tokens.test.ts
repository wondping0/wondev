import { describe, expect, it } from 'vitest';
import { estimateTokens, formatTokens } from '../src/util/tokens.js';

describe('estimateTokens', () => {
  it('counts four characters per token, rounding up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(4000))).toBe(1000);
  });
});

describe('formatTokens', () => {
  it('shows a bare count below a thousand', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('shows thousands with one decimal', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(640 * 4)).toBe('2.6k');
    expect(formatTokens(19000)).toBe('19.0k');
  });
});
