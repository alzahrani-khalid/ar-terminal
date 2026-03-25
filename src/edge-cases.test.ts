import { describe, it, expect } from 'vitest';
import { RtlPipeline } from './rtl-pipeline';
import { ArabicReshaper } from './arabic-reshaper';
import { BidiEngine } from './bidi-engine';

describe('Edge Cases', () => {
  const pipeline = new RtlPipeline();
  const reshaper = new ArabicReshaper();
  const bidi = new BidiEngine();

  it('emoji within Arabic text passes through untouched', () => {
    const result = pipeline.process('مرحبا 😀 عالم', 'on');
    expect(result).toContain('😀');
  });

  it('tab character is preserved', () => {
    const result = pipeline.process('\tمرحبا', 'on');
    expect(result).toContain('\t');
  });

  it('diacritics/tashkeel preserved through reshaping', () => {
    // بِسْمِ — baa+kasra, seen+sukun, meem+kasra
    const result = reshaper.reshape('بِسْمِ');
    expect(result.length).toBeGreaterThan(0);
    // Should contain combining marks
    let hasCombining = false;
    for (const char of result) {
      const cp = char.codePointAt(0)!;
      if (cp >= 0x064B && cp <= 0x065F) hasCombining = true;
    }
    expect(hasCombining).toBe(true);
  });

  it('Arabic-Indic numerals pass through without reshaping', () => {
    const result = reshaper.reshape('١٢٣');
    // These are not in the Arabic letter range, should pass through
    expect(result).toBe('١٢٣');
  });

  it('nested BiDi: Arabic containing English containing Arabic', () => {
    const result = pipeline.process('عربي English عربي', 'on');
    expect(result).toContain('English');
    expect(result.length).toBeGreaterThan(0);
  });

  it('very long line processes without error', () => {
    const longArabic = 'مرحبا '.repeat(200);
    expect(() => pipeline.process(longArabic, 'on')).not.toThrow();
    const result = pipeline.process(longArabic, 'on');
    expect(result.length).toBeGreaterThan(0);
  });

  it('empty lines and whitespace-only pass through', () => {
    const result = pipeline.process('', 'on');
    expect(result).toBe('');
    const result2 = pipeline.process('   ', 'on');
    expect(result2).toBe('   ');
  });

  it('ZWJ between Arabic chars', () => {
    // Zero-width joiner should not crash
    const input = 'م\u200Dر';
    expect(() => reshaper.reshape(input)).not.toThrow();
  });

  it('ZWNJ forces separation', () => {
    // Zero-width non-joiner should not crash
    const input = 'م\u200Cر';
    expect(() => reshaper.reshape(input)).not.toThrow();
  });
});
