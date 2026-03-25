import { describe, it, expect, beforeEach } from 'vitest';
import { RtlPipeline } from './rtl-pipeline';

describe('RtlPipeline', () => {
  let pipeline: RtlPipeline;

  beforeEach(() => {
    pipeline = new RtlPipeline();
  });

  describe('mode: off', () => {
    it('passes through Arabic text unchanged', () => {
      const input = 'مرحبا';
      const result = pipeline.process(input, 'off');
      expect(result).toBe(input);
    });

    it('passes through English text unchanged', () => {
      const input = 'hello world';
      const result = pipeline.process(input, 'off');
      expect(result).toBe(input);
    });
  });

  describe('mode: on', () => {
    it('reshapes and reorders Arabic text (result differs from input)', () => {
      const input = 'مرحبا';
      const result = pipeline.process(input, 'on');
      expect(result).not.toBe(input);
      expect(result.length).toBeGreaterThan(0);
    });

    it('leaves English text unchanged', () => {
      const input = 'hello world';
      const result = pipeline.process(input, 'on');
      expect(result).toBe(input);
    });
  });

  describe('mode: auto', () => {
    it('processes Arabic text (result differs from input)', () => {
      const input = 'مرحبا';
      const result = pipeline.process(input, 'auto');
      expect(result).not.toBe(input);
      expect(result.length).toBeGreaterThan(0);
    });

    it('passes through English text unchanged', () => {
      const input = 'hello world';
      const result = pipeline.process(input, 'auto');
      expect(result).toBe(input);
    });
  });

  describe('ANSI code preservation', () => {
    it('preserves ANSI color codes with plain English text', () => {
      const input = '\x1b[31mhello\x1b[0m';
      const result = pipeline.process(input, 'on');
      expect(result).toContain('\x1b[31m');
      expect(result).toContain('\x1b[0m');
      expect(result).toContain('hello');
    });

    it('preserves ANSI color codes with Arabic text', () => {
      const input = '\x1b[32mمرحبا\x1b[0m';
      const result = pipeline.process(input, 'on');
      expect(result).toContain('\x1b[32m');
      expect(result).toContain('\x1b[0m');
    });
  });

  describe('multiline processing', () => {
    it('processes each line independently and preserves line count', () => {
      const input = 'hello\nمرحبا\nworld';
      const result = pipeline.process(input, 'on');
      const lines = result.split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('hello');
      expect(lines[2]).toBe('world');
    });
  });

  describe('alternate screen buffer passthrough', () => {
    it('enters passthrough mode on alternate screen enter sequence', () => {
      const arabic = 'مرحبا';
      // Enter alternate screen
      pipeline.process('\x1b[?1049h', 'on');
      // Arabic should pass through unchanged
      const result = pipeline.process(arabic, 'on');
      expect(result).toBe(arabic);
    });

    it('resumes processing after alternate screen exit sequence', () => {
      const arabic = 'مرحبا';
      // Enter then exit alternate screen
      pipeline.process('\x1b[?1049h', 'on');
      pipeline.process('\x1b[?1049l', 'on');
      // Arabic should now be processed
      const result = pipeline.process(arabic, 'on');
      expect(result).not.toBe(arabic);
    });
  });
});
