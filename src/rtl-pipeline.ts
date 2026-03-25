import { AnsiParser } from './ansi-parser';
import { ArabicReshaper } from './arabic-reshaper';
import { BidiEngine } from './bidi-engine';
import { containsRTL } from './rtl-detector';

export type RtlMode = 'auto' | 'on' | 'off';

export class RtlPipeline {
  private ansiParser = new AnsiParser();
  private reshaper = new ArabicReshaper();
  private bidiEngine = new BidiEngine();
  private inAlternateScreen = false;

  // Input echo reshaping: track accumulated Arabic chars on current line
  private arabicLineBuffer: string[] = [];
  private lastOutputWasArabicEcho = false;

  process(raw: string, mode: RtlMode): string {
    // Check for alternate screen buffer toggle
    if (raw.includes('\x1b[?1049h') || raw.includes('\x1b[?47h')) {
      this.inAlternateScreen = true;
    }
    if (raw.includes('\x1b[?1049l') || raw.includes('\x1b[?47l')) {
      this.inAlternateScreen = false;
    }

    // Passthrough modes
    if (mode === 'off') return raw;
    if (this.inAlternateScreen) return raw;

    // Strip ANSI codes
    const { cleanText, codes } = this.ansiParser.strip(raw);

    // Detect newline/carriage return — reset line buffer
    if (cleanText.includes('\n') || cleanText.includes('\r')) {
      this.arabicLineBuffer = [];
      this.lastOutputWasArabicEcho = false;
    }

    // Detect backspace (0x7F or \b) — remove last char from buffer
    if (raw === '\x7f' || raw === '\b' || cleanText === '\x7f' || cleanText === '\b') {
      this.arabicLineBuffer.pop();
      return raw; // let the terminal handle the visual backspace
    }

    // Check if this is a single Arabic character echo (shell echoing typed input)
    if (this.isSingleArabicEcho(cleanText)) {
      return this.handleArabicEcho(cleanText);
    }

    // If previous output was Arabic echo and now we get non-Arabic, reset
    if (this.lastOutputWasArabicEcho && !containsRTL(cleanText)) {
      this.arabicLineBuffer = [];
      this.lastOutputWasArabicEcho = false;
    }

    // Auto mode: skip if no RTL characters
    if (mode === 'auto' && !containsRTL(cleanText)) return raw;

    // Process line by line (for command output — full lines of text)
    const lines = cleanText.split('\n');
    const processedLines: string[] = [];

    for (const line of lines) {
      if (line.length === 0 || !containsRTL(line)) {
        processedLines.push(line);
        continue;
      }

      // Reshape Arabic characters
      const { reshaped } = this.reshaper.reshapeWithMap(line);

      // Apply BiDi reordering
      const { reordered } = this.bidiEngine.reorderWithMap(reshaped);

      processedLines.push(reordered);
    }

    const processedText = processedLines.join('\n');

    // Restore ANSI codes
    return this.ansiParser.restore(processedText, codes);
  }

  reset(): void {
    this.inAlternateScreen = false;
    this.arabicLineBuffer = [];
    this.lastOutputWasArabicEcho = false;
  }

  /**
   * Check if incoming text is a single Arabic character (shell echo of typed input).
   * Shell echoes each keystroke individually.
   */
  private isSingleArabicEcho(text: string): boolean {
    const chars = [...text];
    // Single Arabic char, or Arabic char + diacritics
    if (chars.length === 0 || chars.length > 3) return false;
    const baseChar = chars[0];
    const cp = baseChar.codePointAt(0)!;
    // Check if it's in the Arabic block (not presentation forms — those come from our reshaper)
    return cp >= 0x0600 && cp <= 0x06FF;
  }

  /**
   * Handle a single Arabic character echoed by the shell.
   * Accumulate it in the line buffer, then erase previous output
   * and re-render the entire Arabic sequence with proper connected forms.
   */
  private handleArabicEcho(char: string): string {
    // Add to accumulated Arabic chars
    this.arabicLineBuffer.push(char);
    this.lastOutputWasArabicEcho = true;

    // If this is the first Arabic char, just reshape it alone
    if (this.arabicLineBuffer.length === 1) {
      const reshaped = this.reshaper.reshape(char);
      return reshaped;
    }

    // Calculate how many visual cells to erase (previous reshaped output)
    // Each previous Arabic char was output as 1 presentation form char = 1 cell
    const prevReshaped = this.reshaper.reshape(
      this.arabicLineBuffer.slice(0, -1).join('')
    );
    const eraseCells = [...prevReshaped].length;

    // Move cursor back and erase previous Arabic chars
    // \b moves cursor left 1 cell, then we overwrite with new text
    const moveBack = '\b'.repeat(eraseCells);

    // Reshape the entire accumulated Arabic text together
    const fullText = this.arabicLineBuffer.join('');
    const reshaped = this.reshaper.reshape(fullText);

    // Output: move back + reshaped full text
    // No BiDi reordering for input echo — shell manages cursor position
    return moveBack + reshaped;
  }
}
