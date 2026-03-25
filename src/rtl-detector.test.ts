import { describe, it, expect } from 'vitest';
import { containsRTL, getRTLRatio } from './rtl-detector';

describe('containsRTL', () => {
  it('detects Arabic text → true', () => {
    expect(containsRTL('مرحبا بالعالم')).toBe(true);
  });

  it('detects Hebrew text → true', () => {
    expect(containsRTL('שלום עולם')).toBe(true);
  });

  it('detects Persian text → true', () => {
    expect(containsRTL('سلام دنیا')).toBe(true);
  });

  it('returns false for English text', () => {
    expect(containsRTL('Hello, world!')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(containsRTL('')).toBe(false);
  });

  it('returns false for numbers and symbols', () => {
    expect(containsRTL('1234567890 !@#$%^&*()')).toBe(false);
  });

  it('detects RTL in mixed text', () => {
    expect(containsRTL('Hello مرحبا world')).toBe(true);
  });
});

describe('getRTLRatio', () => {
  it('returns > 0.9 for pure Arabic text', () => {
    expect(getRTLRatio('مرحبا بالعالم')).toBeGreaterThan(0.9);
  });

  it('returns 0 for pure English text', () => {
    expect(getRTLRatio('Hello world')).toBe(0);
  });

  it('returns between 0 and 1 for mixed text', () => {
    const ratio = getRTLRatio('Hello مرحبا world');
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it('returns 0 for empty string', () => {
    expect(getRTLRatio('')).toBe(0);
  });
});
