import { describe, it, expect } from 'vitest';
import { ArabicReshaper } from './arabic-reshaper';

const reshaper = new ArabicReshaper();

describe('ArabicReshaper', () => {
  describe('reshape', () => {
    it('single isolated character (ع → U+FEC9)', () => {
      const result = reshaper.reshape('ع');
      expect(result).toBe(String.fromCodePoint(0xfec9));
    });

    it('two-letter word reshaping (من)', () => {
      const result = reshaper.reshape('من');
      // م initial (0xFEE3) + ن final (0xFEE6)
      expect(result).toBe(
        String.fromCodePoint(0xfee3) + String.fromCodePoint(0xfee6)
      );
    });

    it('full word "مرحبا" produces presentation forms', () => {
      const result = reshaper.reshape('مرحبا');
      for (const ch of result) {
        const cp = ch.codePointAt(0)!;
        // Every char should be in presentation forms range or unchanged
        const inPresentationA = cp >= 0xfe70 && cp <= 0xfeff;
        const inPresentationB = cp >= 0xfb50 && cp <= 0xfdff;
        expect(inPresentationA || inPresentationB).toBe(true);
      }
    });

    it('lam-alef ligature (لا → U+FEFB)', () => {
      const result = reshaper.reshape('لا');
      expect(result).toBe(String.fromCodePoint(0xfefb));
    });

    it('non-Arabic text preserved ("hello" → "hello")', () => {
      expect(reshaper.reshape('hello')).toBe('hello');
    });

    it('spaces between Arabic words preserved', () => {
      const result = reshaper.reshape('مرحبا عالم');
      expect(result).toContain(' ');
    });

    it('mixed Arabic/English preserved', () => {
      const result = reshaper.reshape('hello مرحبا world');
      expect(result).toContain('hello');
      expect(result).toContain('world');
    });

    it('empty string → ""', () => {
      expect(reshaper.reshape('')).toBe('');
    });

    it('diacritics preserved (بَ — baa with fatha)', () => {
      const result = reshaper.reshape('بَ');
      // Should contain fatha (U+064E)
      const codepoints = [...result].map((c) => c.codePointAt(0)!);
      expect(codepoints).toContain(0x064e);
    });
  });

  describe('reshapeWithMap', () => {
    it('returns index map with entries', () => {
      const { reshaped, indexMap } = reshaper.reshapeWithMap('من');
      expect(reshaped.length).toBeGreaterThan(0);
      expect(indexMap.size).toBeGreaterThan(0);
    });
  });
});
