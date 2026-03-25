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

    // Auto mode: skip if no RTL characters
    if (mode === 'auto' && !containsRTL(cleanText)) return raw;

    // Process line by line
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
  }
}
