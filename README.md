# RTL Terminal

A VS Code extension that makes Arabic and RTL languages readable in the terminal.

## The Problem

VS Code's terminal (xterm.js) doesn't support Arabic text shaping or the Unicode BiDi algorithm. Arabic text appears with disconnected letters and wrong reading order — making it impossible to read.

**Before:**
```
ه ذ ا م ث ا ل ع ر ب ي
```

**After (with RTL Terminal):**
```
هذا مثال عربي
```

## How It Works

RTL Terminal opens a full terminal emulator inside a VS Code WebView panel. It uses xterm.js for complete terminal functionality (cursor, scrollback, ANSI colors, selection) with a DOM overlay that lets the browser's native text engine render Arabic with proper letter joining.

- **xterm.js** handles terminal emulation
- **DOM overlay** covers lines containing Arabic text
- **Browser text engine** connects Arabic letters natively
- **Full ANSI color support** (16, 256, RGB)

## Features

- Connected Arabic letters in terminal output
- Works with Claude Code, git, npm, and all CLI tools
- Full terminal emulation (cursor, scrollback, selection)
- ANSI color preservation
- Auto-detects Arabic/RTL text
- Supports all RTL languages (Arabic, Hebrew, Persian, Urdu)
- Works offline — no internet required
- Keyboard shortcut: `Cmd+Shift+T` (Mac) / `Ctrl+Shift+T`

## Installation

### From .vsix file

```bash
code --install-extension ar-terminal-0.1.0.vsix
```

### From source

```bash
git clone <repo-url>
cd ar-terminal
npm install
npx @electron/rebuild -v 39.8.0 -m . --only node-pty
npm run build
npx @vscode/vsce package --allow-missing-repository
code --install-extension ar-terminal-0.1.0.vsix
```

> **Note:** The `electron-rebuild` step is required to compile `node-pty` for VS Code's Electron version. Check your VS Code's Electron version if `39.8.0` doesn't work.

## Usage

1. Press `Cmd+Shift+T` (Mac) / `Ctrl+Shift+T`
2. Or open Command Palette → "RTL Terminal: New Terminal"
3. Or click the RTL Terminal icon in the activity bar

Use it like a normal terminal — Arabic text will render with connected letters automatically.

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| RTL Terminal: New Terminal | `Cmd+Shift+T` | Open a new RTL Terminal |
| RTL Terminal: Toggle Mode | — | Cycle auto/on/off |
| RTL Terminal: Set Mode On | — | Force RTL processing |
| RTL Terminal: Set Mode Off | — | Disable RTL processing |
| RTL Terminal: Set Mode Auto | — | Auto-detect RTL text |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `rtlTerminal.mode` | `auto` | RTL processing mode (auto/on/off) |
| `rtlTerminal.shell` | — | Shell path (empty = VS Code default) |
| `rtlTerminal.shellArgs` | `[]` | Shell arguments |
| `rtlTerminal.reshapeInput` | `true` | Reshape Arabic while typing |
| `rtlTerminal.logLevel` | `off` | Debug logging level |

## Architecture

```
Shell (zsh/bash)
    ↓ raw output
node-pty (PTY process)
    ↓ raw data
xterm.js (canvas rendering)
    ↓ buffer content
DOM Overlay (browser text engine)
    ↓ connected Arabic letters
WebView Panel (VS Code)
```

## Requirements

- VS Code 1.95.0+
- macOS, Linux, or Windows
- Node.js 18+

## License

MIT
