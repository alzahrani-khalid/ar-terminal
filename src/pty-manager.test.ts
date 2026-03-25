import { describe, it, expect } from 'vitest';
import { PtyManager } from './pty-manager';

describe('PtyManager.hasIncompleteSequence', () => {
  describe('incomplete ANSI escape sequences', () => {
    it('returns true for bare ESC character', () => {
      expect(PtyManager.hasIncompleteSequence('\x1b')).toBe(true);
    });

    it('returns true for ESC + [ (CSI start without params or final byte)', () => {
      expect(PtyManager.hasIncompleteSequence('\x1b[')).toBe(true);
    });

    it('returns true for ESC + [ + digits (no terminating letter)', () => {
      expect(PtyManager.hasIncompleteSequence('\x1b[31')).toBe(true);
    });

    it('returns true for ESC + [ + digits + semicolon (param separator, no final byte)', () => {
      expect(PtyManager.hasIncompleteSequence('\x1b[1;')).toBe(true);
    });
  });

  describe('complete ANSI escape sequences', () => {
    it('returns false for complete SGR sequence (color)', () => {
      expect(PtyManager.hasIncompleteSequence('\x1b[31m')).toBe(false);
    });

    it('returns false for complete SGR reset', () => {
      expect(PtyManager.hasIncompleteSequence('\x1b[0m')).toBe(false);
    });

    it('returns false for text followed by complete ANSI sequence', () => {
      expect(PtyManager.hasIncompleteSequence('hello\x1b[32m')).toBe(false);
    });
  });

  describe('incomplete UTF-16 surrogate pairs', () => {
    it('returns true for high surrogate without low surrogate', () => {
      expect(PtyManager.hasIncompleteSequence('\uD83D')).toBe(true);
    });

    it('returns true for text ending with high surrogate', () => {
      expect(PtyManager.hasIncompleteSequence('hello\uD83D')).toBe(true);
    });
  });

  describe('complete / normal text', () => {
    it('returns false for plain ASCII', () => {
      expect(PtyManager.hasIncompleteSequence('hello')).toBe(false);
    });

    it('returns false for Arabic text', () => {
      expect(PtyManager.hasIncompleteSequence('مرحبا')).toBe(false);
    });

    it('returns false for complete emoji (surrogate pair)', () => {
      expect(PtyManager.hasIncompleteSequence('\uD83D\uDE00')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(PtyManager.hasIncompleteSequence('')).toBe(false);
    });
  });
});
