# RTL Terminal Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that provides an RTL-aware terminal profile, making Arabic (and all RTL languages) readable in xterm.js-based terminals.

**Architecture:** Custom Pseudoterminal wrapping a real shell via node-pty. All output passes through an RTL pipeline (ANSI strip → Arabic reshape → BiDi reorder → ANSI restore) before reaching xterm.js. Auto-detects RTL text with manual override via status bar.

**Tech Stack:** TypeScript, VS Code Extension API, node-pty, bidi-js, custom Arabic reshaper, esbuild

**Spec:** `docs/superpowers/specs/2026-03-25-rtl-terminal-extension-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.mjs`
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`
- Create: `src/extension.ts`
- Create: `.vscodeignore`
- Create: `.gitignore`

- [ ] **Step 1: Initialize npm project and install dependencies**

Run:
```bash
npm init -y
npm install node-pty bidi-js
npm install -D @types/vscode @types/node typescript esbuild vitest
```

- [ ] **Step 2: Create package.json with extension manifest**

Replace the generated `package.json` with the full extension manifest including `contributes.commands`, `contributes.terminal.profiles`, and `contributes.configuration` for `rtlTerminal.mode`, `rtlTerminal.shell`, `rtlTerminal.shellArgs`, `rtlTerminal.reshapeInput`, and `rtlTerminal.logLevel`. Set `engines.vscode` to `^1.95.0`, `main` to `./dist/extension.js`.

Dependencies: `node-pty: ^1.1.0`, `bidi-js: ^1.0.3`
DevDependencies: `@types/vscode: ^1.95.0`, `@types/node: ^20.0.0`, `esbuild: ^0.24.0`, `typescript: ^5.6.0`, `vitest: ^3.0.0`

Commands to register:
- `rtlTerminal.newTerminal` → "RTL Terminal: New Terminal"
- `rtlTerminal.toggleMode` → "RTL Terminal: Toggle Mode"
- `rtlTerminal.setModeOn` → "RTL Terminal: Set Mode On"
- `rtlTerminal.setModeOff` → "RTL Terminal: Set Mode Off"
- `rtlTerminal.setModeAuto` → "RTL Terminal: Set Mode Auto"

Terminal profile: `id: "rtlTerminal.rtlTerminal"`, `title: "RTL Terminal"`

- [ ] **Step 3: Create tsconfig.json**

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
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 4: Create esbuild.mjs**

esbuild config bundling `src/extension.ts` → `dist/extension.js`, format `cjs`, platform `node`, with `vscode` and `node-pty` as externals.

- [ ] **Step 5: Create .vscode/launch.json and tasks.json**

`launch.json`: extensionHost config with `--extensionDevelopmentPath=${workspaceFolder}` and `preLaunchTask: "npm: watch"`.

`tasks.json`: npm watch task with `$esbuild-watch` problem matcher, background mode.

- [ ] **Step 6: Create minimal extension.ts stub**

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('rtlTerminal.newTerminal', () => {
      vscode.window.showInformationMessage('RTL Terminal: Coming soon');
    })
  );
}

export function deactivate() {}
```

- [ ] **Step 7: Create .vscodeignore**

Exclude: `.vscode/`, `src/`, `node_modules/`, `docs/`, `*.ts`, `tsconfig.json`, `esbuild.mjs`, `vitest.config.*`, `**/*.test.*`

- [ ] **Step 8: Create .gitignore**

```
node_modules/
dist/
*.vsix
.DS_Store
```

- [ ] **Step 9: Build and verify**

Run: `npm run build`
Expected: `dist/extension.js` created with no errors.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json esbuild.mjs .vscode/ src/extension.ts .vscodeignore .gitignore
git commit -m "feat: scaffold VS Code extension project"
```

---

### Task 2: ANSI Parser

**Files:**
- Create: `src/ansi-parser.ts`
- Create: `src/ansi-parser.test.ts`

- [ ] **Step 1: Write failing tests for ANSI stripping**

`src/ansi-parser.test.ts` — test cases:
- Plain text unchanged, no codes
- Strip SGR color codes (`\x1b[31m`), preserve position metadata
- Multiple adjacent codes at same position
- Round-trip: strip then restore produces original string
- Arabic text without escape codes passes through
- Codes at end of string

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ansi-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AnsiParser**

`src/ansi-parser.ts`:

```ts
export interface AnsiCode {
  position: number;
  code: string;
}

export interface StripResult {
  cleanText: string;
  codes: AnsiCode[];
}
```

Class `AnsiParser` with methods:
- `strip(input: string): StripResult` — Uses regex to match ANSI escape sequences (CSI, OSC, simple ESC). Iterates matches, records each code with its position in the clean text (length of clean text accumulated so far).
- `restore(text: string, codes: AnsiCode[]): string` — Sorts codes by position, inserts them back into the text at their recorded positions.
- `restoreWithMapping(text: string, codes: AnsiCode[], indexMap: Map<number, number>): string` — Remaps positions through an index map before restoring.

ANSI regex pattern: `/\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-9;]*m|[()][AB012]|[78DEHM])/g`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ansi-parser.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ansi-parser.ts src/ansi-parser.test.ts
git commit -m "feat: add ANSI parser with strip/restore and position mapping"
```

---

### Task 3: RTL Detector

**Files:**
- Create: `src/rtl-detector.ts`
- Create: `src/rtl-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- Detects Arabic, Hebrew, Persian text
- Returns false for English, empty string, numbers/symbols
- Detects RTL in mixed text
- `getRTLRatio()` returns correct proportions

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/rtl-detector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement RTL detector**

`src/rtl-detector.ts`:

Define RTL Unicode ranges array covering: Hebrew (U+0590–U+05FF), Arabic (U+0600–U+06FF), Syriac, Arabic Supplement, Thaana, NKo, Arabic Extended-A, Hebrew/Arabic Presentation Forms.

Functions:
- `containsRTL(text: string): boolean` — Iterate codepoints, return true on first RTL char.
- `getRTLRatio(text: string): number` — Count RTL chars vs total non-whitespace chars.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/rtl-detector.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rtl-detector.ts src/rtl-detector.test.ts
git commit -m "feat: add RTL character detector with Unicode range support"
```

---

### Task 4: Arabic Reshaper

**Files:**
- Create: `src/arabic-reshaper.ts`
- Create: `src/arabic-data.ts`
- Create: `src/arabic-reshaper.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- Single isolated character (ع → U+FEC9)
- Two-letter word reshaping
- Full word "مرحبا" produces presentation forms
- Lam-alef ligature (لا → U+FEFB)
- Non-Arabic text preserved
- Spaces between Arabic words preserved
- Mixed Arabic/English
- Empty string
- Diacritics preserved
- `reshapeWithMap()` returns index map

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/arabic-reshaper.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create Arabic character data table**

`src/arabic-data.ts`:

Contains:
- `ARABIC_FORMS: Record<number, [number, number, number, number]>` — Maps each Arabic char (U+0621–U+064A) to `[isolated, final, initial, medial]` presentation form codepoints. 0 means form doesn't exist.
- `JOINING_TYPES: Record<number, JoiningType>` — Maps each Arabic char to R/D/U/C joining type.
- `LAM_ALEF_LIGATURES: Record<number, [number, number]>` — Maps alef variants to `[isolated, final]` ligature forms.
- `isDiacritic(cp: number): boolean` — Returns true for Arabic combining marks (U+064B–U+065F, etc.)
- `isArabicChar(cp: number): boolean` — Returns true for U+0621–U+064A.

Reference the research doc for the full mapping table.

- [ ] **Step 4: Implement Arabic reshaper**

`src/arabic-reshaper.ts`:

Class `ArabicReshaper` with:
- `reshape(text: string): string` — Calls `reshapeWithMap` and returns just the reshaped text.
- `reshapeWithMap(text: string): ReshapeResult` — Processes codepoints left to right:
  1. Check for lam-alef ligature (lam followed by alef variant, skipping diacritics)
  2. Skip non-Arabic characters (pass through)
  3. Skip diacritics (pass through)
  4. For each Arabic char, determine form based on joining type and neighbors:
     - R (right-joining): final if prev can join, else isolated
     - D (dual-joining): medial if both neighbors join, final if only prev, initial if only next, else isolated
  5. Build index map tracking original → reshaped positions

Private helpers:
- `prevCanJoinRight(cps, index)` — Look backward (skip diacritics), check if prev char has D or C joining type.
- `nextCanJoinLeft(cps, index)` — Look forward (skip diacritics), check if next char has R, D, or C joining type.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/arabic-reshaper.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/arabic-reshaper.ts src/arabic-data.ts src/arabic-reshaper.test.ts
git commit -m "feat: add Arabic reshaper with contextual forms and lam-alef ligatures"
```

---

### Task 5: BiDi Engine Wrapper

**Files:**
- Create: `src/bidi-engine.ts`
- Create: `src/bidi-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- Pure Arabic reorders (reverses for LTR display): 'ابت' → 'تبا'
- Pure English preserved
- Mixed Arabic/English segments
- Empty string
- Numbers in Arabic context stay LTR
- `reorderWithMap()` returns index map

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/bidi-engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement BiDi engine**

`src/bidi-engine.ts`:

Class `BidiEngine` with:
- `private bidi = bidiFactory()` — Initialize bidi-js.
- `reorder(text: string): string` — Calls `reorderWithMap`, returns just the text.
- `reorderWithMap(text: string): ReorderResult` — Steps:
  1. `bidi.getEmbeddingLevels(text)` → get levels
  2. `bidi.getReorderSegments(text, levels, 0, text.length - 1)` → get flip ranges
  3. `bidi.getMirroredCharactersMap(text, levels)` → get mirrored chars (parentheses etc.)
  4. Apply mirroring to char array
  5. Apply flips (reverse each `[start, end]` range)
  6. Track index movements for position mapping
  7. Return `{ reordered, indexMap }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/bidi-engine.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bidi-engine.ts src/bidi-engine.test.ts
git commit -m "feat: add BiDi engine wrapper around bidi-js"
```

---

### Task 6: RTL Processing Pipeline

**Files:**
- Create: `src/rtl-pipeline.ts`
- Create: `src/rtl-pipeline.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- Mode `off`: passes through unchanged
- Mode `on`: reshapes and reorders Arabic
- Mode `on`: English text unchanged
- Mode `auto`: processes Arabic, passes through English
- ANSI color codes preserved through pipeline
- ANSI codes with Arabic text preserved
- Multiline: each line processed independently
- Alternate screen buffer: enters passthrough on `\x1b[?1049h`, resumes on `\x1b[?1049l`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/rtl-pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement RTL pipeline**

`src/rtl-pipeline.ts`:

Class `RtlPipeline` with:
- Private instances of `AnsiParser`, `ArabicReshaper`, `BidiEngine`
- `private inAlternateScreen = false`
- `process(raw: string, mode: RtlMode): string` — Steps:
  1. Check for alternate screen buffer escape sequences, toggle `inAlternateScreen`
  2. If `mode === 'off'` or `inAlternateScreen`: return raw
  3. `ansiParser.strip(raw)` → get clean text and codes
  4. If `mode === 'auto'` and no RTL detected: return raw
  5. Split by `\n`, process each line:
     - Skip empty lines and lines without RTL
     - `reshaper.reshapeWithMap(line)` → reshaped text + index map
     - `bidiEngine.reorderWithMap(reshaped)` → reordered text + index map
  6. `ansiParser.restore(processedText, codes)` → reinsert ANSI codes
  7. Return result
- `reset(): void` — Reset `inAlternateScreen` state

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/rtl-pipeline.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rtl-pipeline.ts src/rtl-pipeline.test.ts
git commit -m "feat: add RTL processing pipeline with ANSI preservation and TUI passthrough"
```

---

### Task 7: PTY Manager

**Files:**
- Create: `src/pty-manager.ts`
- Create: `src/pty-manager.test.ts`

- [ ] **Step 1: Write failing tests for buffering and incomplete sequence detection**

`src/pty-manager.test.ts` — test cases for the internal helpers (extract `hasIncompleteSequence` and buffering logic as testable units):
- `hasIncompleteSequence` returns true for unterminated ANSI: `'\x1b'`, `'\x1b['`, `'\x1b[31'`
- `hasIncompleteSequence` returns false for complete ANSI: `'\x1b[31m'`, `'\x1b[0m'`
- `hasIncompleteSequence` returns true for high surrogate without low: `'\uD83D'`
- `hasIncompleteSequence` returns false for complete text: `'hello'`, `'مرحبا'`
- `hasIncompleteSequence` returns false for empty string
- Buffering batches rapid writes (use `vi.useFakeTimers`): fire 3 data events in quick succession, verify callback fires once after 16ms with concatenated data

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pty-manager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement PTY manager**

`src/pty-manager.ts`:

Class `PtyManager` with:
- `private ptyProcess: IPty | undefined`
- `private dataBuffer = ''` and `bufferTimeout` for 16ms frame batching
- `start(options)` — Spawn shell via `pty.spawn()` with `xterm-256color` term, homedir cwd, process.env. Wire `onData` to buffer, `onExit` to callback.
- `onData(callback)` / `onExit(callback)` — Register listeners
- `write(data)` — Forward to PTY
- `resize(cols, rows)` — Forward to PTY
- `kill()` — Flush buffer, kill PTY process
- `bufferData(data)` — Append to buffer, check for incomplete UTF-8/ANSI at end. If incomplete, wait up to 50ms. Otherwise flush at 16ms frame boundary.
- `flushBuffer()` — Fire accumulated data to callback, clear buffer.
- `hasIncompleteSequence(data)` — Export as public static for testing. Check for unterminated ANSI escapes or high surrogates at end.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pty-manager.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pty-manager.ts src/pty-manager.test.ts
git commit -m "feat: add PTY manager with frame buffering and incomplete sequence detection"
```

---

### Task 8: Extension Entry Point & Status Bar

**Files:**
- Modify: `src/extension.ts`
- Create: `src/status-bar.ts`

- [ ] **Step 1: Create status bar manager**

`src/status-bar.ts`:

Class `StatusBarManager` with:
- Creates `StatusBarItem` on Right alignment, command `rtlTerminal.toggleMode`
- `getMode(): RtlMode` — Return current mode
- `setMode(mode): void` — Update mode and display
- `toggle(): RtlMode` — Cycle auto → on → off → auto
- `show() / hide() / dispose()` — Manage visibility
- Display text: `RTL: Auto` / `RTL: On` / `RTL: Off`

- [ ] **Step 2: Implement full extension.ts with Pseudoterminal**

Wire everything together in `activate()`:
1. Create `StatusBarManager`, show it
2. Register terminal profile provider (`rtlTerminal.rtlTerminal`) that creates `Pseudoterminal` instances
3. Register all 5 commands
4. `createRtlPseudoterminal()` function:
   - Create `EventEmitter<string>` for write and `EventEmitter<number|void>` for close
   - Create `PtyManager` and `RtlPipeline` instances
   - `open()`: wire PTY data → pipeline.process(data, statusBar.getMode()) → writeEmitter.fire(). Wrap in try-catch, fallback to raw on error.
   - `close()`: pipeline.reset(), pty.kill()
   - `handleInput(data)`: pty.write(data)
   - `setDimensions(dims)`: pty.resize(cols, rows)

- [ ] **Step 3: Build and verify compilation**

Run: `npm run build`
Expected: `dist/extension.js` built with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts src/status-bar.ts
git commit -m "feat: wire up Pseudoterminal with RTL pipeline, status bar, and commands"
```

---

### Task 9: Integration Testing

**Files:**
- Create: `src/integration.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create vitest config**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
```

- [ ] **Step 2: Write integration tests**

`src/integration.test.ts` — test cases:
- "هذا مثال عربي" processed into presentation forms
- ANSI-colored Arabic output preserves colors
- Mixed Arabic/English with numbers
- Rapid sequential chunk processing
- TUI passthrough (alternate screen enter/exit)
- Pipeline error recovery: invalid input doesn't crash (try-catch fallback to raw)

- [ ] **Step 3: Write edge case tests**

`src/edge-cases.test.ts` — test cases from spec Edge Cases table:
- Zero-width joiner (ZWJ U+200D) between Arabic chars preserves joining
- Zero-width non-joiner (ZWNJ U+200C) forces separation
- Emoji within Arabic text: `'مرحبا 😀 عالم'` — emoji passes through untouched
- Tab character expansion: `'\tمرحبا'` — tab preserved, Arabic reshaped
- Diacritics/tashkeel: `'بِسْمِ'` — combining marks attach to base characters
- Arabic-Indic numerals: `'١٢٣'` — classified as AN in BiDi, no reshaping
- Nested BiDi: `'Arabic English عربي text'` — correct segment ordering
- Very long line (1000+ chars): processes without error or timeout
- Empty lines and whitespace-only lines pass through

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 5: Build final extension**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/integration.test.ts src/edge-cases.test.ts
git commit -m "feat: add integration and edge case tests"
```

---

### Task 10: Manual Testing in VS Code

- [ ] **Step 1: Press F5 in VS Code to launch Extension Development Host**

- [ ] **Step 2: Open RTL Terminal via command palette**

Run "RTL Terminal: New Terminal". Verify terminal opens.

- [ ] **Step 3: Test Arabic text output**

Run in the RTL Terminal:
```bash
echo "مرحبا بالعالم"
echo "هذا مثال عربي"
echo "Hello مرحبا World عالم"
```

Verify: Arabic text renders with connected letters in correct reading order.

- [ ] **Step 4: Test mode toggle**

Click status bar "RTL: Auto" button. Verify it cycles through modes.

- [ ] **Step 5: Test with Claude Code**

Run `claude` in the RTL Terminal and ask it to respond in Arabic. Verify readable output.

- [ ] **Step 6: Fix any issues found, commit**

```bash
git add src/ package.json
git commit -m "fix: address issues found during manual testing"
```
