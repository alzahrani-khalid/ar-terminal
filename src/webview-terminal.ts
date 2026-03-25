import * as vscode from 'vscode';
import * as os from 'node:os';
import * as pty from 'node-pty';

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

    // Handle messages from WebView (keyboard input)
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

    this.panel.onDidDispose(() => {
      this.dispose();
    });

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
      this.panel.webview.postMessage({
        type: 'output',
        data,
      });
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

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="ar" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--vscode-terminal-background, #1e1e1e);
    color: var(--vscode-terminal-foreground, #d4d4d4);
    font-family: 'Cascadia Code', 'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace;
    font-size: 14px;
    line-height: 1.4;
    padding: 8px 12px;
    height: 100vh;
    overflow: hidden;
    cursor: text;
  }

  #terminal {
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-y: auto;
    height: calc(100vh - 16px);
    unicode-bidi: plaintext;
    direction: ltr;
  }

  /* Arabic and RTL text segments get automatic browser BiDi */
  #terminal span[dir="rtl"],
  #terminal .rtl-segment {
    unicode-bidi: embed;
    direction: rtl;
  }

  /* ANSI color classes */
  .ansi-black { color: #000000; }
  .ansi-red { color: #cd3131; }
  .ansi-green { color: #0dbc79; }
  .ansi-yellow { color: #e5e510; }
  .ansi-blue { color: #2472c8; }
  .ansi-magenta { color: #bc3fbc; }
  .ansi-cyan { color: #11a8cd; }
  .ansi-white { color: #e5e5e5; }
  .ansi-bright-black { color: #666666; }
  .ansi-bright-red { color: #f14c4c; }
  .ansi-bright-green { color: #23d18b; }
  .ansi-bright-yellow { color: #f5f543; }
  .ansi-bright-blue { color: #3b8eea; }
  .ansi-bright-magenta { color: #d670d6; }
  .ansi-bright-cyan { color: #29b8db; }
  .ansi-bright-white { color: #ffffff; }
  .ansi-bold { font-weight: bold; }
  .ansi-italic { font-style: italic; }
  .ansi-underline { text-decoration: underline; }
  .ansi-dim { opacity: 0.7; }
  .ansi-strikethrough { text-decoration: line-through; }

  /* Background colors */
  .ansi-bg-black { background: #000000; }
  .ansi-bg-red { background: #cd3131; }
  .ansi-bg-green { background: #0dbc79; }
  .ansi-bg-yellow { background: #e5e510; }
  .ansi-bg-blue { background: #2472c8; }
  .ansi-bg-magenta { background: #bc3fbc; }
  .ansi-bg-cyan { background: #11a8cd; }
  .ansi-bg-white { background: #e5e5e5; }

  /* Cursor */
  #cursor {
    display: inline-block;
    width: 0.6em;
    height: 1.2em;
    background: var(--vscode-terminalCursor-foreground, #d4d4d4);
    animation: blink 1s step-end infinite;
    vertical-align: text-bottom;
  }

  @keyframes blink {
    50% { opacity: 0; }
  }

  /* Hidden input for capturing keyboard */
  #input-capture {
    position: absolute;
    left: -9999px;
    top: 0;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
</style>
</head>
<body>
<div id="terminal"></div>
<textarea id="input-capture" autofocus autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>

<script>
(function() {
  const vscode = acquireVsCodeApi();
  const terminal = document.getElementById('terminal');
  const input = document.getElementById('input-capture');

  // ANSI parser state
  let currentStyles = [];
  let cursorVisible = true;

  // Focus input on any click
  document.addEventListener('click', () => input.focus());
  document.addEventListener('focus', () => input.focus());
  window.addEventListener('focus', () => input.focus());

  // Capture keyboard input
  input.addEventListener('input', (e) => {
    const data = e.target.value;
    if (data) {
      vscode.postMessage({ type: 'input', data });
      e.target.value = '';
    }
  });

  // Handle special keys
  input.addEventListener('keydown', (e) => {
    let data = '';
    switch (e.key) {
      case 'Enter': data = '\\r'; break;
      case 'Backspace': data = '\\x7f'; break;
      case 'Tab': data = '\\t'; e.preventDefault(); break;
      case 'Escape': data = '\\x1b'; break;
      case 'ArrowUp': data = '\\x1b[A'; break;
      case 'ArrowDown': data = '\\x1b[B'; break;
      case 'ArrowRight': data = '\\x1b[C'; break;
      case 'ArrowLeft': data = '\\x1b[D'; break;
      case 'Home': data = '\\x1b[H'; break;
      case 'End': data = '\\x1b[F'; break;
      case 'Delete': data = '\\x1b[3~'; break;
      default:
        if (e.ctrlKey && e.key.length === 1) {
          data = String.fromCharCode(e.key.charCodeAt(0) - 96);
          e.preventDefault();
        }
        return; // let input event handle normal chars
    }
    if (data) {
      vscode.postMessage({ type: 'input', data });
      e.preventDefault();
    }
  });

  // Parse ANSI and convert to HTML
  function parseAnsiToHtml(text) {
    let result = '';
    let i = 0;

    while (i < text.length) {
      // ESC sequence
      if (text[i] === '\\x1b' && text[i + 1] === '[') {
        i += 2;
        let params = '';
        while (i < text.length && text[i] >= '0' && text[i] <= '9' || text[i] === ';') {
          params += text[i++];
        }
        const cmd = text[i++]; // command character

        if (cmd === 'm') {
          // SGR - Select Graphic Rendition
          const codes = params ? params.split(';').map(Number) : [0];
          result += processSGR(codes);
        }
        // Skip other escape sequences (cursor movement, clear, etc.)
        // They don't apply well to HTML rendering
        continue;
      }

      // Carriage return
      if (text[i] === '\\r') {
        i++;
        continue;
      }

      // Newline
      if (text[i] === '\\n') {
        result += '\\n';
        i++;
        continue;
      }

      // Backspace
      if (text[i] === '\\b' || text.charCodeAt(i) === 8) {
        i++;
        continue;
      }

      // Bell
      if (text.charCodeAt(i) === 7) {
        i++;
        continue;
      }

      // Regular character — escape HTML
      const ch = text[i];
      if (ch === '<') result += '&lt;';
      else if (ch === '>') result += '&gt;';
      else if (ch === '&') result += '&amp;';
      else result += ch;
      i++;
    }

    return result;
  }

  function processSGR(codes) {
    let closeSpan = '';
    let openSpan = '';

    for (const code of codes) {
      if (code === 0) {
        // Reset
        if (currentStyles.length > 0) {
          closeSpan += '</span>'.repeat(currentStyles.length);
          currentStyles = [];
        }
      } else {
        const cls = sgrToClass(code);
        if (cls) {
          currentStyles.push(cls);
          openSpan += '<span class="' + cls + '">';
        }
      }
    }

    return closeSpan + openSpan;
  }

  function sgrToClass(code) {
    const map = {
      1: 'ansi-bold', 2: 'ansi-dim', 3: 'ansi-italic',
      4: 'ansi-underline', 9: 'ansi-strikethrough',
      30: 'ansi-black', 31: 'ansi-red', 32: 'ansi-green',
      33: 'ansi-yellow', 34: 'ansi-blue', 35: 'ansi-magenta',
      36: 'ansi-cyan', 37: 'ansi-white',
      90: 'ansi-bright-black', 91: 'ansi-bright-red',
      92: 'ansi-bright-green', 93: 'ansi-bright-yellow',
      94: 'ansi-bright-blue', 95: 'ansi-bright-magenta',
      96: 'ansi-bright-cyan', 97: 'ansi-bright-white',
      40: 'ansi-bg-black', 41: 'ansi-bg-red', 42: 'ansi-bg-green',
      43: 'ansi-bg-yellow', 44: 'ansi-bg-blue', 45: 'ansi-bg-magenta',
      46: 'ansi-bg-cyan', 47: 'ansi-bg-white',
    };
    return map[code] || null;
  }

  // Handle messages from extension
  window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'output') {
      const html = parseAnsiToHtml(message.data);
      terminal.innerHTML += html;
      terminal.scrollTop = terminal.scrollHeight;
    } else if (message.type === 'exit') {
      terminal.innerHTML += '\\n[Process exited]';
    }
  });

  // Initial focus
  input.focus();

  // Report initial size
  const charWidth = 8.4;
  const charHeight = 19.6;
  const cols = Math.floor(terminal.clientWidth / charWidth);
  const rows = Math.floor(terminal.clientHeight / charHeight);
  vscode.postMessage({ type: 'resize', cols, rows });
})();
</script>
</body>
</html>`;
  }
}
