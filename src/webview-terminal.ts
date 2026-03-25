import * as vscode from 'vscode';
import * as os from 'node:os';
import * as pty from 'node-pty';

/**
 * WebView-based terminal that uses the browser's native text engine
 * for proper Arabic/RTL rendering. Shell data is processed server-side
 * to strip escape sequences and sent as structured segments to the WebView.
 */
export class WebviewTerminal {
  private panel: vscode.WebviewPanel;
  private ptyProcess: pty.IPty | undefined;
  private disposables: vscode.Disposable[] = [];

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
        }
      },
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose());
    this.startShell();
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
      // Process server-side: parse ANSI into structured segments
      const segments = this.parseAnsiToSegments(data);
      this.panel.webview.postMessage({ type: 'output', segments });
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
   * Parse raw terminal data into structured segments.
   * Strips all ANSI escape sequences, tracks current style state,
   * and produces text segments with style metadata.
   */
  private parseAnsiToSegments(
    data: string
  ): Array<{ text: string; styles: string[] }> {
    const segments: Array<{ text: string; styles: string[] }> = [];
    let currentStyles: string[] = [];
    let textBuf = '';
    let i = 0;

    const flush = () => {
      if (textBuf) {
        segments.push({ text: textBuf, styles: [...currentStyles] });
        textBuf = '';
      }
    };

    while (i < data.length) {
      const ch = data.charCodeAt(i);

      // ESC character (0x1B)
      if (ch === 0x1b) {
        const next = i + 1 < data.length ? data[i + 1] : '';

        // CSI: ESC [
        if (next === '[') {
          flush();
          i += 2;
          let params = '';
          while (i < data.length && ((data.charCodeAt(i) >= 0x30 && data.charCodeAt(i) <= 0x3f))) {
            params += data[i++];
          }
          // Intermediate bytes
          while (i < data.length && ((data.charCodeAt(i) >= 0x20 && data.charCodeAt(i) <= 0x2f))) {
            i++;
          }
          // Final byte
          if (i < data.length) {
            const cmd = data[i++];
            if (cmd === 'm') {
              // SGR
              const codes = params ? params.split(';').map(Number) : [0];
              for (const code of codes) {
                if (code === 0) {
                  currentStyles = [];
                } else {
                  const cls = this.sgrToClass(code);
                  if (cls) currentStyles.push(cls);
                }
              }
            }
            // All other CSI sequences: silently skip
          }
          continue;
        }

        // OSC: ESC ]
        if (next === ']') {
          flush();
          i += 2;
          // Skip until BEL (0x07) or ST (ESC \)
          while (i < data.length) {
            if (data.charCodeAt(i) === 0x07) { i++; break; }
            if (data.charCodeAt(i) === 0x1b && i + 1 < data.length && data[i + 1] === '\\') {
              i += 2; break;
            }
            i++;
          }
          continue;
        }

        // Other ESC sequences: ESC followed by single char
        if (next) {
          i += 2;
          continue;
        }

        i++;
        continue;
      }

      // Carriage return
      if (ch === 0x0d) {
        // CR — mark for line overwrite
        flush();
        segments.push({ text: '\r', styles: [] });
        i++;
        continue;
      }

      // Newline
      if (ch === 0x0a) {
        flush();
        segments.push({ text: '\n', styles: [] });
        i++;
        continue;
      }

      // Backspace
      if (ch === 0x08) {
        flush();
        segments.push({ text: '\b', styles: [] });
        i++;
        continue;
      }

      // Bell — skip
      if (ch === 0x07) {
        i++;
        continue;
      }

      // Other control chars < 0x20 (except tab) — skip
      if (ch < 0x20 && ch !== 0x09) {
        i++;
        continue;
      }

      // Regular character
      textBuf += data[i];
      i++;
    }

    flush();
    return segments;
  }

  private sgrToClass(code: number): string | null {
    const map: Record<number, string> = {
      1: 'b', 2: 'dm', 3: 'i', 4: 'u', 9: 'st',
      30: 'f0', 31: 'f1', 32: 'f2', 33: 'f3', 34: 'f4', 35: 'f5', 36: 'f6', 37: 'f7',
      90: 'f8', 91: 'f9', 92: 'fa', 93: 'fb', 94: 'fc', 95: 'fd', 96: 'fe', 97: 'ff',
      40: 'b0', 41: 'b1', 42: 'b2', 43: 'b3', 44: 'b4', 45: 'b5', 46: 'b6', 47: 'b7',
    };
    return map[code] || null;
  }

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root {
    --fg: var(--vscode-terminal-foreground, #d4d4d4);
    --bg: var(--vscode-terminal-background, #1e1e1e);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: 'Menlo', 'Consolas', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.5;
    height: 100vh;
    overflow: hidden;
    cursor: text;
  }
  #terminal {
    padding: 4px 8px;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .line {
    min-height: 1.5em;
    white-space: pre-wrap;
    word-wrap: break-word;
    unicode-bidi: plaintext;
  }
  /* Compact SGR classes */
  .b { font-weight: bold; }
  .dm { opacity: 0.7; }
  .i { font-style: italic; }
  .u { text-decoration: underline; }
  .st { text-decoration: line-through; }
  /* Foreground */
  .f0 { color: #555; } .f1 { color: #f14c4c; } .f2 { color: #23d18b; }
  .f3 { color: #f5f543; } .f4 { color: #3b8eea; } .f5 { color: #d670d6; }
  .f6 { color: #29b8db; } .f7 { color: #e5e5e5; }
  /* Bright foreground */
  .f8 { color: #666; } .f9 { color: #f14c4c; } .fa { color: #23d18b; }
  .fb { color: #f5f543; } .fc { color: #3b8eea; } .fd { color: #d670d6; }
  .fe { color: #29b8db; } .ff { color: #fff; }
  /* Background */
  .b0 { background: #000; } .b1 { background: #cd3131; } .b2 { background: #0dbc79; }
  .b3 { background: #e5e510; } .b4 { background: #2472c8; } .b5 { background: #bc3fbc; }
  .b6 { background: #11a8cd; } .b7 { background: #e5e5e5; }

  #cursor {
    display: inline;
    background: var(--fg);
    color: var(--bg);
    animation: blink 1s step-end infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }

  #input-capture {
    position: fixed;
    left: -9999px;
    top: 0;
    opacity: 0;
  }
</style>
</head>
<body>
<div id="terminal"><div class="line" id="current-line"><span id="cursor">&nbsp;</span></div></div>
<textarea id="input-capture" autofocus></textarea>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  const terminal = document.getElementById('terminal');
  const input = document.getElementById('input-capture');
  let currentLine = document.getElementById('current-line');
  const cursor = document.getElementById('cursor');

  // Focus management
  document.addEventListener('click', () => input.focus());
  window.addEventListener('focus', () => input.focus());
  setTimeout(() => input.focus(), 100);

  // Keyboard input
  input.addEventListener('input', (e) => {
    if (e.target.value) {
      vscode.postMessage({ type: 'input', data: e.target.value });
      e.target.value = '';
    }
  });

  input.addEventListener('keydown', (e) => {
    const keyMap = {
      'Enter': '\\r',
      'Backspace': String.fromCharCode(127),
      'Tab': '\\t',
      'Escape': String.fromCharCode(27),
      'ArrowUp': '\\x1b[A',
      'ArrowDown': '\\x1b[B',
      'ArrowRight': '\\x1b[C',
      'ArrowLeft': '\\x1b[D',
      'Home': '\\x1b[H',
      'End': '\\x1b[F',
      'Delete': '\\x1b[3~',
    };

    if (keyMap[e.key]) {
      vscode.postMessage({ type: 'input', data: keyMap[e.key] });
      e.preventDefault();
      return;
    }

    if (e.ctrlKey && e.key.length === 1) {
      const code = e.key.toLowerCase().charCodeAt(0) - 96;
      if (code > 0 && code < 27) {
        vscode.postMessage({ type: 'input', data: String.fromCharCode(code) });
        e.preventDefault();
      }
    }
  });

  function newLine() {
    // Remove cursor from current line
    if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
    // Create new line
    currentLine = document.createElement('div');
    currentLine.className = 'line';
    terminal.appendChild(currentLine);
    currentLine.appendChild(cursor);
    scrollToBottom();
  }

  function handleCarriageReturn() {
    // Clear current line content (keep the line element)
    if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
    currentLine.textContent = '';
    currentLine.appendChild(cursor);
  }

  function handleBackspace() {
    // Remove character before cursor
    const prev = cursor.previousSibling;
    if (prev) {
      if (prev.nodeType === Node.TEXT_NODE) {
        if (prev.textContent.length > 1) {
          prev.textContent = prev.textContent.slice(0, -1);
        } else {
          prev.parentNode.removeChild(prev);
        }
      } else if (prev.nodeType === Node.ELEMENT_NODE) {
        if (prev.textContent.length > 1) {
          prev.textContent = prev.textContent.slice(0, -1);
        } else {
          prev.parentNode.removeChild(prev);
        }
      }
    }
  }

  function appendText(text, styles) {
    if (!text) return;
    // Insert before cursor
    if (styles && styles.length > 0) {
      const span = document.createElement('span');
      span.className = styles.join(' ');
      span.textContent = text;
      currentLine.insertBefore(span, cursor);
    } else {
      const textNode = document.createTextNode(text);
      currentLine.insertBefore(textNode, cursor);
    }
  }

  function scrollToBottom() {
    terminal.scrollTop = terminal.scrollHeight;
  }

  // Handle messages from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'output') {
      for (const seg of msg.segments) {
        if (seg.text === '\\n') {
          newLine();
        } else if (seg.text === '\\r') {
          handleCarriageReturn();
        } else if (seg.text === '\\b') {
          handleBackspace();
        } else {
          appendText(seg.text, seg.styles);
        }
      }
      scrollToBottom();
    } else if (msg.type === 'exit') {
      appendText('\\n[Process exited]', []);
    }
  });

  // Report size
  const cols = Math.floor(terminal.clientWidth / 7.8);
  const rows = Math.floor(terminal.clientHeight / 19.5);
  vscode.postMessage({ type: 'resize', cols, rows });
})();
</script>
</body>
</html>`;
  }
}
