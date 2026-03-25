import { describe, it, expect, beforeEach } from 'vitest';
import { BidiEngine } from './bidi-engine';

describe('BidiEngine', () => {
  let engine: BidiEngine;

  beforeEach(() => {
    engine = new BidiEngine();
  });

  describe('reorder()', () => {
    it('pure Arabic reorders (reverses for LTR display)', () => {
      const result = engine.reorder('ابت');
      expect(result).toBe('تبا');
    });

    it('pure English is preserved', () => {
      const result = engine.reorder('hello world');
      expect(result).toBe('hello world');
    });

    it('mixed Arabic/English: result contains both words', () => {
      const result = engine.reorder('hello مرحبا world');
      expect(result).toContain('hello');
      expect(result).toContain('world');
    });

    it('empty string returns empty string', () => {
      const result = engine.reorder('');
      expect(result).toBe('');
    });

    it('numbers in Arabic context stay in their numeric form', () => {
      const result = engine.reorder('العدد 123');
      expect(result).toContain('123');
    });
  });

  describe('reorderWithMap()', () => {
    it('returns reordered string and index map', () => {
      const result = engine.reorderWithMap('ابت');
      expect(result.reordered).toBe('تبا');
      expect(result.indexMap).toBeInstanceOf(Map);
      expect(result.indexMap.size).toBeGreaterThan(0);
    });

    it('empty string returns empty reordered and empty map', () => {
      const result = engine.reorderWithMap('');
      expect(result.reordered).toBe('');
      expect(result.indexMap).toBeInstanceOf(Map);
      expect(result.indexMap.size).toBe(0);
    });

    it('index map has entries for each character', () => {
      const text = 'ابت';
      const result = engine.reorderWithMap(text);
      expect(result.indexMap.size).toBe(text.length);
    });
  });
});
