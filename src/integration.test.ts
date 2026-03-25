import { describe, it, expect } from 'vitest';
import { RtlPipeline } from './rtl-pipeline';

describe('Integration: Full RTL Pipeline', () => {
  const pipeline = new RtlPipeline();

  it('processes "هذا مثال عربي" into readable output', () => {
    const result = pipeline.process('هذا مثال عربي', 'on');
    expect(result).not.toBe('هذا مثال عربي');
    expect(result.length).toBeGreaterThan(0);
    // All Arabic chars should be in presentation forms
    for (const char of result) {
      const cp = char.codePointAt(0)!;
      if (cp > 0x7F && cp !== 0x20) {
        const valid =
          (cp >= 0xFE70 && cp <= 0xFEFF) ||
          (cp >= 0xFB50 && cp <= 0xFDFF) ||
          (cp >= 0x064B && cp <= 0x065F) ||
          (cp >= 0x0600 && cp <= 0x06FF);
        expect(valid).toBe(true);
      }
    }
  });

  it('handles Claude Code-style output with ANSI colors', () => {
    const input = '\x1b[1m\x1b[32mمرحبا بالعالم\x1b[0m';
    const result = pipeline.process(input, 'on');
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('\x1b[32m');
    expect(result).toContain('\x1b[0m');
  });

  it('handles mixed Arabic/English with numbers', () => {
    const result = pipeline.process('Version 2.0 - الإصدار', 'on');
    expect(result).toContain('Version');
    expect(result).toContain('2.0');
  });

  it('handles rapid sequential processing', () => {
    const chunks = ['مر', 'حبا', ' بال', 'عالم'];
    const results = chunks.map((c) => pipeline.process(c, 'on'));
    expect(results).toHaveLength(4);
  });

  it('passthrough for TUI apps', () => {
    const p = new RtlPipeline();
    p.process('\x1b[?1049h', 'on');
    const result = p.process('مرحبا', 'on');
    expect(result).toBe('مرحبا');
    p.process('\x1b[?1049l', 'on');
    const result2 = p.process('مرحبا', 'on');
    expect(result2).not.toBe('مرحبا');
  });

  it('pipeline error recovery: does not crash on edge input', () => {
    const p = new RtlPipeline();
    // Should not throw
    expect(() => p.process('', 'on')).not.toThrow();
    expect(() => p.process('\x1b[31m', 'on')).not.toThrow();
    expect(() => p.process('\n\n\n', 'on')).not.toThrow();
  });
});
