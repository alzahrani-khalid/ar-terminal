import { describe, it, expect } from 'vitest';
import { AnsiParser } from './ansi-parser';

const parser = new AnsiParser();

describe('AnsiParser', () => {
  it('plain text is unchanged with no codes', () => {
    const result = parser.strip('hello world');
    expect(result.cleanText).toBe('hello world');
    expect(result.codes).toHaveLength(0);
  });

  it('strips SGR color codes and preserves position metadata', () => {
    const input = '\x1b[31mred text\x1b[0m';
    const result = parser.strip(input);
    expect(result.cleanText).toBe('red text');
    expect(result.codes).toHaveLength(2);
    expect(result.codes[0]).toEqual({ position: 0, code: '\x1b[31m' });
    expect(result.codes[1]).toEqual({ position: 8, code: '\x1b[0m' });
  });

  it('handles multiple adjacent codes at the same position', () => {
    const input = '\x1b[1m\x1b[32mtext';
    const result = parser.strip(input);
    expect(result.cleanText).toBe('text');
    expect(result.codes).toHaveLength(2);
    expect(result.codes[0]).toEqual({ position: 0, code: '\x1b[1m' });
    expect(result.codes[1]).toEqual({ position: 0, code: '\x1b[32m' });
  });

  it('round-trip: strip then restore produces original string', () => {
    const original = '\x1b[1m\x1b[34mHello\x1b[0m World\x1b[0m';
    const { cleanText, codes } = parser.strip(original);
    const restored = parser.restore(cleanText, codes);
    expect(restored).toBe(original);
  });

  it('Arabic text without escape codes passes through unchanged', () => {
    const arabic = 'مرحبا بالعالم';
    const result = parser.strip(arabic);
    expect(result.cleanText).toBe(arabic);
    expect(result.codes).toHaveLength(0);
  });

  it('handles codes at end of string', () => {
    const input = 'text\x1b[0m';
    const result = parser.strip(input);
    expect(result.cleanText).toBe('text');
    expect(result.codes).toHaveLength(1);
    expect(result.codes[0]).toEqual({ position: 4, code: '\x1b[0m' });
  });

  it('restoreWithMapping remaps positions through index map', () => {
    // Simulate reshaping that shifts positions: char at index 0 stays at 0, etc.
    const codes = [{ position: 5, code: '\x1b[31m' }];
    const indexMap = new Map<number, number>([[5, 3]]);
    const text = 'abcdefgh';
    const restored = parser.restoreWithMapping(text, codes, indexMap);
    expect(restored).toBe('abc\x1b[31mdefgh');
  });
});
