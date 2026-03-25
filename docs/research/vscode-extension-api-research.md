# VS Code Extension API Research — Concrete Code Examples

> Generated 2026-03-25. All APIs verified against current npm/VS Code versions.

---

## 1. node-pty (v1.1.0)

```ts
import * as os from 'node:os';
import * as pty from 'node-pty';

// --- Spawn a shell ---
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.env.HOME,
  env: process.env as Record<string, string>,
});

// --- Read output ---
ptyProcess.onData((data: string) => {
  // `data` is raw terminal output (includes ANSI escape sequences)
  process.stdout.write(data);
});

// --- Handle exit ---
ptyProcess.onExit(({ exitCode, signal }) => {
  console.log(`Process exited: code=${exitCode}, signal=${signal}`);
});

// --- Write input ---
ptyProcess.write('ls -la\r');

// --- Resize ---
ptyProcess.resize(120, 40); // cols, rows

// --- Kill ---
ptyProcess.kill();
```

### Key Types (from node-pty typings)

```ts
interface IPtyForkOptions {
  name?: string;       // TERM env variable (e.g., 'xterm-256color')
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: { [key: string]: string };
  encoding?: string | null; // null for binary
}

interface IPty {
  pid: number;
  cols: number;
  rows: number;
  process: string;      // current process name
  onData: IEvent<string>;
  onExit: IEvent<{ exitCode: number; signal?: number }>;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  pause(): void;
  resume(): void;
}
```

---

## 2. bidi-js (v1.0.3)

```ts
import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

// --- Step 1: Get embedding levels ---
const text = 'Hello مرحبا World عالم';
const embeddingLevels = bidi.getEmbeddingLevels(text, 'ltr');
// embeddingLevels.levels  → Uint8Array, one level per char
// embeddingLevels.paragraphs → [{ start, end, level }]
// Odd level = RTL, Even level = LTR

// --- Step 2: Get reorder segments (for a line) ---
const flips = bidi.getReorderSegments(
  text,
  embeddingLevels,
  0,            // start index (optional, for substring)
  text.length - 1  // end index inclusive (optional)
);

// Apply reordering: each flip is [start, end] range to reverse in-place
const chars = [...text];
flips.forEach(([start, end]) => {
  // Reverse characters from start to end (inclusive)
  while (start < end) {
    [chars[start], chars[end]] = [chars[end], chars[start]];
    start++;
    end--;
  }
});
const visualOrder = chars.join('');

// --- Step 3: Handle mirrored characters (e.g., parentheses) ---
const mirroredMap = bidi.getMirroredCharactersMap(text, embeddingLevels);
// Map<number, string> — index → replacement char
mirroredMap.forEach((replacement, index) => {
  chars[index] = replacement;
});

// --- Single character mirror check ---
const charIndex = 5;
const mirroredChar = (embeddingLevels.levels[charIndex] & 1)
  ? bidi.getMirroredCharacter(text[charIndex])
  : null; // null if no mirror exists
```

### Full API Surface

```ts
interface BidiResult {
  levels: Uint8Array;
  paragraphs: Array<{ start: number; end: number; level: number }>;
}

interface Bidi {
  getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): BidiResult;
  getReorderSegments(text: string, result: BidiResult, start?: number, end?: number): [number, number][];
  getMirroredCharactersMap(text: string, result: BidiResult, start?: number, end?: number): Map<number, string>;
  getMirroredCharacter(char: string): string | null;
}
```

---

## 3. VS Code Pseudoterminal API — Complete Minimal Example

```ts
import * as vscode from 'vscode';
import * as pty from 'node-pty';
import * as os from 'node:os';

export function activate(context: vscode.ExtensionContext) {
  // Register a terminal profile provider
  const provider = vscode.window.registerTerminalProfileProvider(
    'ar-terminal.rtlTerminal',
    {
      provideTerminalProfile(
        token: vscode.CancellationToken
      ): vscode.ProviderResult<vscode.TerminalProfile> {
        return new vscode.TerminalProfile({
          name: 'Arabic RTL Terminal',
          pty: createRtlPty(),
        });
      },
    }
  );
  context.subscriptions.push(provider);

  // Also register a command to open it
  context.subscriptions.push(
    vscode.commands.registerCommand('ar-terminal.open', () => {
      vscode.window.createTerminal({
        name: 'Arabic RTL Terminal',
        pty: createRtlPty(),
      });
    })
  );
}

function createRtlPty(): vscode.Pseudoterminal {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number | void>();
  const changeNameEmitter = new vscode.EventEmitter<string>();

  let ptyProcess: pty.IPty | undefined;

  const pseudoterminal: vscode.Pseudoterminal = {
    // --- Events ---
    onDidWrite: writeEmitter.event,       // fires data to terminal display
    onDidClose: closeEmitter.event,       // signals terminal closure
    onDidChangeName: changeNameEmitter.event,

    // --- Called when terminal is ready ---
    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: initialDimensions?.columns ?? 80,
        rows: initialDimensions?.rows ?? 30,
        cwd: os.homedir(),
        env: process.env as Record<string, string>,
      });

      // Shell output → process through RTL pipeline → terminal display
      ptyProcess.onData((data: string) => {
        // TODO: Insert RTL processing pipeline here
        const processedData = data; // placeholder
        writeEmitter.fire(processedData);
      });

      ptyProcess.onExit(({ exitCode }) => {
        closeEmitter.fire(exitCode);
      });
    },

    // --- Called when terminal is closed by user ---
    close(): void {
      ptyProcess?.kill();
      ptyProcess = undefined;
    },

    // --- Called when user types in terminal ---
    handleInput(data: string): void {
      ptyProcess?.write(data);
    },

    // --- Called when terminal is resized ---
    setDimensions(dimensions: vscode.TerminalDimensions): void {
      ptyProcess?.resize(dimensions.columns, dimensions.rows);
    },
  };

  return pseudoterminal;
}

export function deactivate() {}
```

---

## 4. VS Code Extension Scaffolding — Project Structure

### Directory Layout

```
ar-terminal/
├── .vscode/
│   ├── launch.json          # F5 debug config
│   └── tasks.json           # build tasks
├── src/
│   ├── extension.ts         # activate/deactivate entry point
│   ├── rtl-pseudoterminal.ts
│   ├── bidi-processor.ts
│   └── arabic-reshaper.ts
├── package.json
├── tsconfig.json
└── esbuild.mjs              # bundler config
```

### package.json (key fields)

```json
{
  "name": "ar-terminal",
  "displayName": "Arabic RTL Terminal",
  "description": "RTL-aware terminal for Arabic text",
  "version": "0.0.1",
  "publisher": "your-publisher-id",
  "engines": {
    "vscode": "^1.95.0"
  },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "ar-terminal.open",
        "title": "Open Arabic RTL Terminal",
        "category": "Terminal"
      }
    ],
    "terminal": {
      "profiles": [
        {
          "id": "ar-terminal.rtlTerminal",
          "title": "Arabic RTL Terminal",
          "icon": "terminal"
        }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "node esbuild.mjs --production",
    "watch": "node esbuild.mjs --watch",
    "lint": "eslint src"
  },
  "devDependencies": {
    "@types/vscode": "^1.95.0",
    "@types/node": "^20.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0"
  },
  "dependencies": {
    "node-pty": "^1.1.0",
    "bidi-js": "^1.0.3"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true
  },
  "exclude": ["node_modules", "dist"]
}
```

### esbuild.mjs

```js
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode', 'node-pty'], // node-pty is native, can't bundle
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

### .vscode/launch.json

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: watch"
    }
  ]
}
```

---

## 5. Arabic Reshaping

### npm package: `arabic-reshaper` (v1.1.0)

Exists and works. Converts Arabic characters to their Presentation Forms-B glyphs (joined forms).

```ts
import ArabicReshaper from 'arabic-reshaper';

// Converts logical Arabic characters → presentation forms (joined glyphs)
const reshaped = ArabicReshaper.convertArabic('السلام عليكم');
// Output: ﺍﻟﺴﻼﻡ ﻋﻠﻴﻜﻢ  (Unicode Presentation Forms-B)
```

**What it does:**
- Converts characters in the Arabic Unicode block (U+0600–U+06FF) to Arabic Presentation Forms-A (U+FB50–U+FDFF) and Forms-B (U+FE70–U+FEFF)
- Handles contextual shaping: isolated, initial, medial, final forms
- Handles lam-alef ligatures

**Caveat:** Last published 9 years ago (v1.1.0). GPL-3.0 license. Works but may need a custom implementation for production use.

### If building custom: Unicode joining rules

Arabic characters have 4 contextual forms based on position:

| Position | Description | Example: ع |
|----------|-------------|------------|
| Isolated | Not connected | U+0639 → U+FEC9 |
| Initial  | Start of word | U+0639 → U+FECB |
| Medial   | Middle of word | U+0639 → U+FECC |
| Final    | End of word | U+0639 → U+FECA |

**Key Unicode ranges:**
- Arabic block: U+0600 – U+06FF (logical characters)
- Arabic Supplement: U+0750 – U+077F
- Arabic Presentation Forms-A: U+FB50 – U+FDFF
- Arabic Presentation Forms-B: U+FE70 – U+FEFF

**Joining types** (from Unicode `ArabicJoining.txt`):
- **R** (Right-Joining): Alef, Dal, Thal, Ra, Zain, Waw — connect only to the right
- **D** (Dual-Joining): Ba, Ta, Tha, Jim, Ha, Kha, Sin, Shin, Sad, Dad, Ain, Ghain, Fa, Qaf, Kaf, Lam, Mim, Nun, Ha, Ya — connect both sides
- **U** (Non-Joining): Hamza — never connects
- **C** (Join-Causing): Tatweel (kashida) — causes joining

**Algorithm for form selection:**
```
for each character C at index i:
  prev = nearest joining character before i (skip transparent/non-joining)
  next = nearest joining character after i (skip transparent/non-joining)

  if C is non-joining: use isolated form
  if C is right-joining:
    if prev can connect right: use final form
    else: use isolated form
  if C is dual-joining:
    canConnectPrev = prev exists and can connect to the right
    canConnectNext = next exists and can connect to the left
    if canConnectPrev and canConnectNext: use medial form
    if canConnectPrev: use final form
    if canConnectNext: use initial form
    else: use isolated form
```

**Lam-Alef ligatures** (special case):
When Lam (U+0644) is followed by an Alef variant, they merge:
- Lam + Alef (U+0627) → U+FEFB/U+FEFC
- Lam + Alef-Madda (U+0622) → U+FEF5/U+FEF6
- Lam + Alef-Hamza-Above (U+0623) → U+FEF7/U+FEF8
- Lam + Alef-Hamza-Below (U+0625) → U+FEF9/U+FEFA
