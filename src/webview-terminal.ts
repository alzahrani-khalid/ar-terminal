import * as vscode from 'vscode';
import * as os from 'node:os';
import * as pty from 'node-pty';
import { ArabicReshaper } from './arabic-reshaper';
import { BidiEngine } from './bidi-engine';
import { AnsiParser } from './ansi-parser';
import { containsRTL } from './rtl-detector';

/**
 * WebView terminal using xterm.js for full terminal emulation,
 * with Arabic text preprocessing before rendering.
 *
 * xterm.js handles: cursor, scrollback, ANSI, selection, etc.
 * Our reshaper handles: Arabic letter joining (presentation forms).
 * The browser handles: text rendering with proper glyph shaping.
 */
export class WebviewTerminal {
  private panel: vscode.WebviewPanel;
  private ptyProcess: pty.IPty | undefined;
  private disposables: vscode.Disposable[] = [];
  private reshaper = new ArabicReshaper();
  private bidiEngine = new BidiEngine();
  private ansiParser = new AnsiParser();

  constructor(private context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      'rtlTerminal',
      'RTL Terminal',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.type === 'input') {
          this.ptyProcess?.write(message.data);
        } else if (message.type === 'resize') {
          this.ptyProcess?.resize(message.cols, message.rows);
        } else if (message.type === 'ready') {
          this.startShell();
        }
      },
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose());
  }

  private startShell(): void {
    const config = vscode.workspace.getConfiguration('rtlTerminal');
    const shell =
      config.get<string>('shell') ||
      (os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash');

    this.ptyProcess = pty.spawn(shell, config.get<string[]>('shellArgs') || [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: os.homedir(),
      env: process.env as Record<string, string>,
    });

    this.ptyProcess.onData((data: string) => {
      // Send raw data to xterm.js — the DOM overlay handles Arabic rendering
      this.panel.webview.postMessage({ type: 'output', data });
    });

    this.ptyProcess.onExit(() => {
      this.panel.webview.postMessage({ type: 'exit' });
    });
  }

  dispose(): void {
    this.ptyProcess?.kill();
    this.disposables.forEach((d) => d.dispose());
    this.panel.dispose();
  }

  /**
   * Reshape Arabic characters in terminal data while preserving
   * all ANSI escape sequences in their exact positions.
   *
   * Uses AnsiParser to strip ALL escape sequences at once,
   * reshape the entire clean text together (so Arabic chars
   * see their neighbors for proper joining), then restore
   * escape sequences at their original positions.
   */
  private reshapeArabicInStream(data: string): string {
    if (!containsRTL(data)) return data;

    // 1. Strip all ANSI escape sequences, preserving positions
    const { cleanText, codes } = this.ansiParser.strip(data);

    // 2. If clean text has no RTL, return as-is
    if (!containsRTL(cleanText)) return data;

    // 3. Reshape the entire clean text at once
    //    This ensures Arabic chars see their neighbors for proper joining
    //    No BiDi reordering — xterm.js is LTR, and reshaping alone makes
    //    Arabic readable with connected letters in the terminal
    const reshaped = this.reshaper.reshape(cleanText);

    // 4. Restore ANSI codes at their original positions
    return this.ansiParser.restore(reshaped, codes);
  }

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--vscode-terminal-background, #1e1e1e);
    height: 100vh;
    overflow: hidden;
  }
  #terminal-container {
    width: 100%;
    height: 100%;
    position: relative;
  }
  /* Arabic overlay sits on top of xterm.js canvas */
  #arabic-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 10;
    overflow: hidden;
  }
  .arabic-line {
    position: absolute;
    left: 0;
    right: 0;
    white-space: pre;
    unicode-bidi: normal;
    direction: ltr;
    text-align: left;
    font-family: 'Menlo', 'Consolas', 'Courier New', monospace;
    padding-left: 4px;
    background: var(--vscode-terminal-background, #1e1e1e);
  }
  .c-default { color: #d4d4d4; }
  .c-0 { color: #000; } .c-1 { color: #cd3131; } .c-2 { color: #0dbc79; }
  .c-3 { color: #e5e510; } .c-4 { color: #2472c8; } .c-5 { color: #bc3fbc; }
  .c-6 { color: #11a8cd; } .c-7 { color: #e5e5e5; }
  .c-8 { color: #666; } .c-9 { color: #f14c4c; } .c-10 { color: #23d18b; }
  .c-11 { color: #f5f543; } .c-12 { color: #3b8eea; } .c-13 { color: #d670d6; }
  .c-14 { color: #29b8db; } .c-15 { color: #fff; }
  .c-bold { font-weight: bold; }
</style>
</head>
<body>
<div id="terminal-container">
  <div id="arabic-overlay"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js"></script>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  const overlay = document.getElementById('arabic-overlay');

  function isRTLChar(cp) {
    return (cp >= 0x0590 && cp <= 0x05FF) || (cp >= 0x0600 && cp <= 0x06FF) ||
           (cp >= 0x0700 && cp <= 0x074F) || (cp >= 0x0750 && cp <= 0x077F) ||
           (cp >= 0x08A0 && cp <= 0x08FF) || (cp >= 0xFB1D && cp <= 0xFB4F) ||
           (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF);
  }
  function containsRTL(text) {
    for (const ch of text) {
      if (isRTLChar(ch.codePointAt(0))) return true;
    }
    return false;
  }

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'Menlo', 'Consolas', 'Courier New', monospace",
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#264f78',
    },
    allowProposedApi: true,
    scrollback: 10000,
    convertEol: false,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());

  const container = document.getElementById('terminal-container');
  term.open(container);
  fitAddon.fit();

  // Get xterm cell dimensions for overlay positioning
  function getCellDims() {
    const core = term._core;
    if (core && core._renderService) {
      const d = core._renderService.dimensions;
      return {
        cellH: d.css.cell.height,
        canvasTop: d.css.canvas.top || 0,
        canvasLeft: d.css.canvas.left || 0,
      };
    }
    return { cellH: 17, canvasTop: 0, canvasLeft: 0 };
  }

  // Scan visible terminal rows, overlay Arabic lines with proper HTML text
  function updateArabicOverlay() {
    // Clear overlay using DOM methods (safe, no innerHTML)
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    const buf = term.buffer.active;

    // Skip overlay in alternate screen buffer (TUI apps like Claude Code input, vim, htop)
    if (buf.type !== 'normal') {
      return;
    }
    const dims = getCellDims();
    const viewportY = buf.viewportY;

    for (let y = 0; y < term.rows; y++) {
      const bufLine = buf.getLine(viewportY + y);
      if (!bufLine) continue;

      // Extract full line text
      let lineText = '';
      for (let x = 0; x < bufLine.length; x++) {
        const cell = bufLine.getCell(x);
        if (cell) lineText += cell.getChars() || ' ';
      }

      if (!containsRTL(lineText.trim())) continue;

      // Create overlay div for this line
      const lineDiv = document.createElement('div');
      lineDiv.className = 'arabic-line';
      lineDiv.style.top = (dims.canvasTop + y * dims.cellH) + 'px';
      lineDiv.style.height = dims.cellH + 'px';
      lineDiv.style.lineHeight = dims.cellH + 'px';
      lineDiv.style.fontSize = term.options.fontSize + 'px';

      // ANSI 16-color palette
      const palette16 = [
        '#000','#cd3131','#0dbc79','#e5e510','#2472c8','#bc3fbc','#11a8cd','#e5e5e5',
        '#666','#f14c4c','#23d18b','#f5f543','#3b8eea','#d670d6','#29b8db','#fff'
      ];

      // Build styled text segments with full color support
      let currentSpan = null;
      let currentKey = '';

      for (let x = 0; x < bufLine.length; x++) {
        const cell = bufLine.getCell(x);
        if (!cell) continue;
        const ch = cell.getChars();
        if (!ch && x > 0) continue; // skip wide char continuations

        // Extract foreground color
        let fgColor = '#d4d4d4'; // default
        try {
          const fgMode = cell.getFgColorMode();
          if (fgMode === 1) {
            // Palette color (0-255)
            const idx = cell.getFgColor();
            if (idx >= 0 && idx < 16) fgColor = palette16[idx];
            else if (idx >= 16) fgColor = palette256(idx);
          } else if (fgMode === 2) {
            // RGB color — getFgColor returns 24-bit number
            const rgb = cell.getFgColor();
            if (rgb >= 0) {
              const r = (rgb >> 16) & 0xFF;
              const g = (rgb >> 8) & 0xFF;
              const b = rgb & 0xFF;
              fgColor = 'rgb(' + r + ',' + g + ',' + b + ')';
            }
          }
        } catch(e) {
          // Fallback to default on any color extraction error
        }

        const bold = cell.isBold();
        const styleKey = fgColor + (bold ? 'b' : '');

        if (styleKey !== currentKey || !currentSpan) {
          currentSpan = document.createElement('span');
          currentSpan.style.color = fgColor;
          if (bold) currentSpan.style.fontWeight = 'bold';
          lineDiv.appendChild(currentSpan);
          currentKey = styleKey;
        }
        currentSpan.textContent += ch || ' ';
      }

      // 256-color palette helper
      function palette256(idx) {
        if (idx < 16) return palette16[idx];
        if (idx < 232) {
          const i = idx - 16;
          const r = Math.floor(i / 36) * 51;
          const g = Math.floor((i % 36) / 6) * 51;
          const b = (i % 6) * 51;
          return 'rgb(' + r + ',' + g + ',' + b + ')';
        }
        const gray = (idx - 232) * 10 + 8;
        return 'rgb(' + gray + ',' + gray + ',' + gray + ')';
      }

      overlay.appendChild(lineDiv);
    }
  }

  // Schedule overlay update (debounced)
  let overlayTimer = null;
  function scheduleOverlay() {
    if (overlayTimer) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(updateArabicOverlay, 30);
  }

  term.onWriteParsed(scheduleOverlay);
  term.onScroll(scheduleOverlay);
  term.onResize(scheduleOverlay);

  term.onData((data) => {
    vscode.postMessage({ type: 'input', data });
  });

  term.onResize(({ cols, rows }) => {
    vscode.postMessage({ type: 'resize', cols, rows });
  });

  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    scheduleOverlay();
  });
  resizeObserver.observe(container);

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'output') {
      term.write(msg.data);
    } else if (msg.type === 'exit') {
      term.write('\\r\\n[Process exited]');
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
  }
}
