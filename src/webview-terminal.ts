import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
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
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      }
    );

    // Set tab icon
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'sidebar-icon-dark.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'sidebar-icon-dark.svg'),
    };

    this.panel.webview.html = this.getHtml(this.panel.webview, context.extensionUri);

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

  private getWorkspaceCwd(): string {
    // 1. Workspace folder (most reliable)
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    // 2. Active editor's directory
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (activeDoc && !activeDoc.isUntitled) {
      return path.dirname(activeDoc.uri.fsPath);
    }
    // 3. Deprecated rootPath fallback
    if (vscode.workspace.rootPath) {
      return vscode.workspace.rootPath;
    }
    // 4. Home directory
    return os.homedir();
  }

  private startShell(): void {
    const config = vscode.workspace.getConfiguration('rtlTerminal');
    const termConfig = vscode.workspace.getConfiguration('terminal.integrated');
    const shell =
      config.get<string>('shell') ||
      (os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash');

    const cwd = this.getWorkspaceCwd();

    this.ptyProcess = pty.spawn(shell, config.get<string[]>('shellArgs') || [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: process.env as Record<string, string>,
    });

    this.ptyProcess.onData((data: string) => {
      // Handle OSC title sequences — prefer version-like titles, skip paths
      const oscTitlePattern = /\x1b\](?:0|1|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
      data = data.replace(oscTitlePattern, (_match, title: string) => {
        const t = title.trim();
        if (t && !t.includes('/')) {
          // Prefer version numbers (e.g. "2.1.84") — don't overwrite with longer names
          const isVersion = /^\d+\.\d+/.test(t);
          const currentIsVersion = /^\d+\.\d+/.test(this.panel.title);
          if (isVersion || !currentIsVersion) {
            this.panel.title = t;
          }
        }
        return '';
      });

      // Send RAW data to xterm.js — don't reshape!
      // The overlay reads raw Arabic from the buffer and the browser's
      // native text engine connects the letters properly.
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

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const mediaUri = vscode.Uri.joinPath(extensionUri, 'media', 'xterm');
    const xtermCss = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'xterm.css'));
    const xtermJs = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'xterm.js'));
    const fitJs = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'addon-fit.js'));
    const webLinksJs = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'addon-web-links.js'));
    const searchJs = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'addon-search.js'));

    // Sync font settings from VS Code terminal config
    const termConfig = vscode.workspace.getConfiguration('terminal.integrated');
    const fontSize = termConfig.get<number>('fontSize') || 13;
    const fontFamily = termConfig.get<string>('fontFamily') ||
      "'MesloLGS NF', 'MesloLGS Nerd Font', 'Hack Nerd Font', 'FiraCode Nerd Font', 'JetBrainsMono Nerd Font', 'Menlo', 'Consolas', 'Courier New', monospace";

    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="${xtermCss}">
<style>
  /* Load Powerline/Nerd Font glyphs from user's installed fonts */
  @font-face {
    font-family: 'TerminalIcons';
    src: local('Cascadia Code PL'), local('Cascadia Mono PL'),
         local('Cascadia Code'), local('Cascadia Mono'),
         local('Meslo LG S for Powerline'), local('Meslo LG M for Powerline'),
         local('MesloLGS NF'), local('MesloLGS Nerd Font'),
         local('Hack Nerd Font'), local('FiraCode Nerd Font'),
         local('JetBrainsMono Nerd Font'), local('Symbols Nerd Font Mono');
    unicode-range: U+E0A0-E0D4, U+E200-E2A9, U+E0B0-E0BF, U+E5FA-E6AC,
                   U+F000-F2E0, U+F300-F372, U+F400-F532, U+F500-FD46,
                   U+E700-E7C5, U+F0001-F1AF0, U+E6B2-E6B5, U+23FB-23FE, U+2665, U+26A1;
  }
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
    font-family: inherit;
    background: var(--vscode-terminal-background, #1e1e1e);
  }
  /* Overlay cursor */
  .overlay-cursor {
    display: inline-block;
    width: 2px;
    height: 1.2em;
    background: #d4d4d4;
    animation: blink 1s step-end infinite;
    vertical-align: text-bottom;
    position: absolute;
  }
  @keyframes blink { 50% { opacity: 0; } }
  /* Selection highlight */
  .overlay-selected {
    background: rgba(38, 79, 120, 0.6);
  }
  .c-default { color: #d4d4d4; }
  .c-0 { color: #000; } .c-1 { color: #cd3131; } .c-2 { color: #0dbc79; }
  .c-3 { color: #e5e510; } .c-4 { color: #2472c8; } .c-5 { color: #bc3fbc; }
  .c-6 { color: #11a8cd; } .c-7 { color: #e5e5e5; }
  .c-8 { color: #666; } .c-9 { color: #f14c4c; } .c-10 { color: #23d18b; }
  .c-11 { color: #f5f543; } .c-12 { color: #3b8eea; } .c-13 { color: #d670d6; }
  .c-14 { color: #29b8db; } .c-15 { color: #fff; }
  .c-bold { font-weight: bold; }
  /* Search bar */
  #search-bar {
    display: none;
    position: absolute;
    top: 4px;
    right: 16px;
    z-index: 20;
    background: var(--vscode-input-background, #3c3c3c);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px;
    padding: 4px 8px;
    gap: 6px;
    align-items: center;
  }
  #search-bar.visible { display: flex; }
  #search-input {
    background: transparent;
    border: none;
    color: var(--vscode-input-foreground, #ccc);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    width: 200px;
  }
  #search-bar button {
    background: transparent;
    border: none;
    color: var(--vscode-input-foreground, #ccc);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
  }
  #search-bar button:hover { background: rgba(255,255,255,0.1); border-radius: 3px; }
  #search-count { color: var(--vscode-descriptionForeground, #999); font-size: 12px; white-space: nowrap; }
</style>
</head>
<body>
<div id="terminal-container">
  <div id="search-bar">
    <input id="search-input" type="text" placeholder="Search..." />
    <span id="search-count"></span>
    <button id="search-prev" title="Previous">&#9650;</button>
    <button id="search-next" title="Next">&#9660;</button>
    <button id="search-close" title="Close">&#10005;</button>
  </div>
  <div id="arabic-overlay"></div>
</div>
<script src="${xtermJs}"></script>
<script src="${fitJs}"></script>
<script src="${webLinksJs}"></script>
<script src="${searchJs}"></script>
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
    fontSize: ${fontSize},
    fontFamily: 'Menlo, Consolas, TerminalIcons, "Courier New", monospace',
    customGlyphs: true,
    letterSpacing: 0,
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
  const searchAddon = new SearchAddon.SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
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
        cellW: d.css.cell.width,
        cellH: d.css.cell.height,
        canvasTop: d.css.canvas.top || 0,
        canvasLeft: d.css.canvas.left || 0,
      };
    }
    return { cellW: 7.8, cellH: 17, canvasTop: 0, canvasLeft: 0 };
  }

  // ANSI 16-color palette
  const palette16 = [
    '#000','#cd3131','#0dbc79','#e5e510','#2472c8','#bc3fbc','#11a8cd','#e5e5e5',
    '#666','#f14c4c','#23d18b','#f5f543','#3b8eea','#d670d6','#29b8db','#fff'
  ];
  function palette256(idx) {
    if (idx < 16) return palette16[idx];
    if (idx < 232) {
      const i = idx - 16;
      return 'rgb(' + Math.floor(i/36)*51 + ',' + Math.floor((i%36)/6)*51 + ',' + (i%6)*51 + ')';
    }
    const g = (idx - 232) * 10 + 8;
    return 'rgb(' + g + ',' + g + ',' + g + ')';
  }
  function getCellColor(cell) {
    const defaultFg = term.options.theme?.foreground || '#d4d4d4';
    try {
      if (cell.isFgPalette && cell.isFgPalette()) {
        const idx = cell.getFgColor();
        return idx < 16 ? palette16[idx] : palette256(idx);
      } else if (cell.isFgRGB && cell.isFgRGB()) {
        const rgb = cell.getFgColor();
        return 'rgb(' + ((rgb>>16)&0xFF) + ',' + ((rgb>>8)&0xFF) + ',' + (rgb&0xFF) + ')';
      }
    } catch(e) {}
    return defaultFg;
  }

  // Scan visible rows, overlay lines that contain Arabic text
  function updateArabicOverlay() {
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    const buf = term.buffer.active;
    const dims = getCellDims();
    const viewportY = buf.viewportY;

    for (let y = 0; y < term.rows; y++) {
      const bufLine = buf.getLine(viewportY + y);
      if (!bufLine) continue;

      // Check if line has RTL text
      let hasRTL = false;
      for (let x = 0; x < bufLine.length; x++) {
        const cell = bufLine.getCell(x);
        if (!cell) continue;
        const ch = cell.getChars();
        if (ch && isRTLChar(ch.codePointAt(0))) { hasRTL = true; break; }
      }
      if (!hasRTL) continue;

      // Create full-line overlay
      const lineDiv = document.createElement('div');
      lineDiv.className = 'arabic-line';
      lineDiv.style.top = (dims.canvasTop + y * dims.cellH) + 'px';
      lineDiv.style.height = dims.cellH + 'px';
      lineDiv.style.lineHeight = dims.cellH + 'px';
      lineDiv.style.fontSize = term.options.fontSize + 'px';

      let currentSpan = null;
      let currentKey = '';

      for (let x = 0; x < bufLine.length; x++) {
        const cell = bufLine.getCell(x);
        if (!cell) continue;
        const ch = cell.getChars();
        if (!ch && x > 0) continue;

        const fgColor = getCellColor(cell);
        let bold = false, dim = false, italic = false;
        try {
          bold = cell.isBold && cell.isBold();
          dim = cell.isDim && cell.isDim();
          italic = cell.isItalic && cell.isItalic();
        } catch(e) {}

        const key = fgColor + (bold?'b':'') + (dim?'d':'') + (italic?'i':'');
        if (key !== currentKey || !currentSpan) {
          currentSpan = document.createElement('span');
          currentSpan.style.color = fgColor;
          if (bold) currentSpan.style.fontWeight = 'bold';
          if (dim) currentSpan.style.opacity = '0.5';
          if (italic) currentSpan.style.fontStyle = 'italic';
          lineDiv.appendChild(currentSpan);
          currentKey = key;
        }
        currentSpan.textContent += ch || ' ';
      }

      // Cursor on this line
      if (y === buf.cursorY) {
        const cursorEl = document.createElement('span');
        cursorEl.className = 'overlay-cursor';
        cursorEl.style.left = (dims.canvasLeft + buf.cursorX * dims.cellW) + 'px';
        cursorEl.style.height = dims.cellH + 'px';
        lineDiv.appendChild(cursorEl);
      }

      overlay.appendChild(lineDiv);
    }

    applySelectionHighlight();
  }

  // Highlight selected text on overlay lines (character-accurate)
  function applySelectionHighlight() {
    const sel = term.getSelectionPosition();
    if (!sel) return;

    const buf = term.buffer.active;
    const viewportY = buf.viewportY;
    const dims = getCellDims();
    const overlayLines = overlay.querySelectorAll('.arabic-line');

    overlayLines.forEach((lineDiv) => {
      const topPx = parseFloat(lineDiv.style.top);
      const rowIndex = Math.round((topPx - dims.canvasTop) / dims.cellH);
      const absY = viewportY + rowIndex;

      if (absY < sel.start.y || absY > sel.end.y) return;

      // Determine selection columns for this line
      let startX = 0;
      let endX = Infinity;
      if (absY === sel.start.y) startX = sel.start.x;
      if (absY === sel.end.y) endX = sel.end.x;

      // Walk through spans, tracking character position
      let charPos = 0;
      const spans = lineDiv.querySelectorAll('span:not(.overlay-cursor)');
      spans.forEach((span) => {
        const text = span.textContent || '';
        const spanStart = charPos;
        const spanEnd = charPos + text.length;
        charPos = spanEnd;

        if (spanEnd <= startX || spanStart >= endX) {
          // Entirely outside selection
          return;
        }

        if (spanStart >= startX && spanEnd <= endX) {
          // Entirely inside selection
          span.classList.add('overlay-selected');
        } else {
          // Partially selected — split the span
          const selFrom = Math.max(0, startX - spanStart);
          const selTo = Math.min(text.length, endX - spanStart);

          // Clear original text
          const parent = span.parentNode;
          const color = span.style.color;
          const fw = span.style.fontWeight;
          const op = span.style.opacity;

          // Before selection
          if (selFrom > 0) {
            const before = document.createElement('span');
            before.style.color = color;
            if (fw) before.style.fontWeight = fw;
            if (op) before.style.opacity = op;
            before.textContent = text.slice(0, selFrom);
            parent.insertBefore(before, span);
          }
          // Selected portion
          const mid = document.createElement('span');
          mid.style.color = color;
          if (fw) mid.style.fontWeight = fw;
          if (op) mid.style.opacity = op;
          mid.classList.add('overlay-selected');
          mid.textContent = text.slice(selFrom, selTo);
          parent.insertBefore(mid, span);
          // After selection
          if (selTo < text.length) {
            const after = document.createElement('span');
            after.style.color = color;
            if (fw) after.style.fontWeight = fw;
            if (op) after.style.opacity = op;
            after.textContent = text.slice(selTo);
            parent.insertBefore(after, span);
          }
          parent.removeChild(span);
        }
      });
    });
  }

  // Schedule overlay update (debounced)
  let overlayTimer = null;
  function scheduleOverlay() {
    if (overlayTimer) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(updateArabicOverlay, 16); // reduced to 16ms (1 frame)
  }

  term.onWriteParsed(scheduleOverlay);
  term.onScroll(scheduleOverlay);
  term.onResize(scheduleOverlay);
  term.onSelectionChange(scheduleOverlay);

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

  // Search bar (Cmd+F / Ctrl+F)
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const searchCount = document.getElementById('search-count');

  function openSearch() {
    searchBar.classList.add('visible');
    searchInput.focus();
    searchInput.select();
  }
  function closeSearch() {
    searchBar.classList.remove('visible');
    searchAddon.clearDecorations();
    searchCount.textContent = '';
    term.focus();
  }

  document.getElementById('search-close').addEventListener('click', closeSearch);
  document.getElementById('search-next').addEventListener('click', () => {
    searchAddon.findNext(searchInput.value);
  });
  document.getElementById('search-prev').addEventListener('click', () => {
    searchAddon.findPrevious(searchInput.value);
  });

  searchInput.addEventListener('input', () => {
    if (searchInput.value) {
      searchAddon.findNext(searchInput.value);
    } else {
      searchAddon.clearDecorations();
      searchCount.textContent = '';
    }
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.shiftKey ? searchAddon.findPrevious(searchInput.value) : searchAddon.findNext(searchInput.value);
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  // Intercept Cmd+F / Ctrl+F
  term.attachCustomKeyEventHandler((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f' && e.type === 'keydown') {
      openSearch();
      return false; // prevent default
    }
    if (e.key === 'Escape' && searchBar.classList.contains('visible')) {
      closeSearch();
      return false;
    }
    return true;
  });

  // Copy connected Arabic from overlay
  document.addEventListener('copy', (e) => {
    const overlayLines = overlay.querySelectorAll('.arabic-line');
    if (overlayLines.length === 0) return; // no overlay, use default

    const sel = term.getSelectionPosition();
    if (!sel) return;

    // Build text from overlay spans (connected Arabic)
    const buf = term.buffer.active;
    const viewportY = buf.viewportY;
    const dims = getCellDims();
    let copiedText = '';

    for (let absY = sel.start.y; absY <= sel.end.y; absY++) {
      const rowIdx = absY - viewportY;
      // Find overlay line for this row
      let overlayLine = null;
      overlayLines.forEach((ld) => {
        const top = parseFloat(ld.style.top);
        const r = Math.round((top - dims.canvasTop) / dims.cellH);
        if (r === rowIdx) overlayLine = ld;
      });

      let lineText = '';
      if (overlayLine) {
        // Get text from overlay (connected Arabic)
        const spans = overlayLine.querySelectorAll('span:not(.overlay-cursor)');
        spans.forEach((s) => { lineText += s.textContent || ''; });
      } else {
        // Get text from xterm buffer
        const bufLine = buf.getLine(absY);
        if (bufLine) {
          for (let x = 0; x < bufLine.length; x++) {
            const cell = bufLine.getCell(x);
            if (cell) lineText += cell.getChars() || ' ';
          }
        }
      }

      // Trim to selection columns
      const startX = (absY === sel.start.y) ? sel.start.x : 0;
      const endX = (absY === sel.end.y) ? sel.end.x : lineText.length;
      copiedText += lineText.substring(startX, endX);
      if (absY < sel.end.y) copiedText += '\\n';
    }

    if (copiedText) {
      e.preventDefault();
      e.clipboardData.setData('text/plain', copiedText.trimEnd());
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
  }
}
