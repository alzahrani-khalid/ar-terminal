# RTL Terminal — VS Code Extension Design Spec

**Date:** 2026-03-25
**Status:** Draft
**Author:** Khalid + Claude

## Problem

Terminal emulators in VS Code, Cursor, and Antigravity use xterm.js, which does not support:
- Arabic text shaping (letters render disconnected: ه ذ ا instead of هذا)
- Unicode BiDi algorithm (Arabic text appears in wrong order)
- Any RTL language rendering (Hebrew, Persian, Urdu affected too)

This makes Arabic output from CLI tools (including Claude Code) unreadable.

## Goal

Build a VS Code extension that provides an **RTL-capable terminal profile**. Arabic text must render with proper letter joining and correct reading order. All RTL languages supported (Arabic, Hebrew, Persian, Urdu). Mixed RTL/LTR content (BiDi) must display correctly.

## Non-Goals

- Mirroring the terminal layout (scrollbar position, cursor alignment)
- Replacing or patching xterm.js internally
- Supporting non-VS Code editors (standalone terminal emulator)

## Approach

**Custom Pseudoterminal** using VS Code's official `Pseudoterminal` API. The extension spawns a real shell process, intercepts all I/O, and applies text shaping + BiDi reordering before writing to the terminal. Since xterm.js receives pre-processed text, it renders correctly without needing native RTL support.

## Architecture

```
┌─────────────────────────────────────┐
│  VS Code Terminal Panel             │
│  (xterm.js — receives processed     │
│   text that renders correctly)      │
└──────────────┬──────────────────────┘
               │ processed text + ANSI codes
┌──────────────┴──────────────────────┐
│  RTL Processing Pipeline            │
│                                     │
│  1. ANSI Stripper                   │
│     Extract & preserve escape codes │
│     with positional mapping         │
│                                     │
│  2. Arabic Reshaper                 │
│     Join disconnected letters into  │
│     connected contextual forms      │
│     (isolated → initial/medial/     │
│      final forms)                   │
│                                     │
│  3. BiDi Engine                     │
│     Apply Unicode BiDi Algorithm    │
│     (UAX #9) for correct visual     │
│     ordering of mixed-direction     │
│     text                            │
│                                     │
│  4. ANSI Restorer                   │
│     Re-apply escape codes to the    │
│     reordered text at correct       │
│     positions                       │
└──────────────┬──────────────────────┘
               │ raw shell output
┌──────────────┴──────────────────────┐
│  PTY Manager                        │
│  - Spawns real shell (zsh/bash)     │
│  - Handles resize events            │
│  - Manages process lifecycle        │
│  - Pipes stdin from user to shell   │
└─────────────────────────────────────┘
```

## Components

### 1. Extension Entry Point (`extension.ts`)

- Registers the "RTL Terminal" terminal profile with VS Code
- Registers commands: `rtlTerminal.newTerminal`, `rtlTerminal.toggleMode`
- Creates status bar item showing current mode
- Manages settings

### 2. PTY Manager (`pty-manager.ts`)

- Spawns child shell process using `node-pty`
- Handles bidirectional data flow:
  - Shell stdout → RTL pipeline → Pseudoterminal `onDidWrite`
  - User keyboard input → Pseudoterminal `handleInput` → Shell stdin
- Handles terminal resize events (`setDimensions`)
- Manages process lifecycle (start, exit, dispose)

### 3. ANSI Parser (`ansi-parser.ts`)

- Strips ANSI escape sequences from text, preserving them with position metadata
- Returns: `{ cleanText: string, codes: Array<{ position: number, code: string }> }`
- Restores ANSI codes after text transformation, remapping positions to match reordered text
- Handles all common sequences: SGR (colors/styles), cursor movement, erase

### 4. Arabic Reshaper (`arabic-reshaper.ts`)

Converts Unicode Arabic characters from isolated forms to their correct contextual forms:

- **Isolated form** (ع) — character stands alone
- **Initial form** (عـ) — character starts a word
- **Medial form** (ـعـ) — character is mid-word
- **Final form** (ـع) — character ends a word

Implementation:
- Unicode character mapping table for all Arabic letters (U+0621–U+064A)
- Contextual analysis: check neighboring characters to determine form
- Handle lam-alef ligatures (لا)
- Support Arabic presentation forms (U+FB50–U+FDFF, U+FE70–U+FEFF)
- Extend to Persian (additional characters), Urdu (additional characters)

### 5. BiDi Engine (`bidi-engine.ts`)

Implements the Unicode Bidirectional Algorithm (UAX #9):

- **Character classification**: Assign BiDi types (L, R, AL, EN, AN, etc.)
- **Paragraph level**: Determine base direction (RTL if first strong char is RTL)
- **Explicit levels**: Handle directional overrides and embeddings
- **Weak type resolution**: Resolve number separators, terminators
- **Neutral resolution**: Resolve spaces and punctuation between same-direction runs
- **Visual reordering**: Reorder characters from logical to visual order for LTR display

For practical purposes, consider using an existing UAX #9 implementation if a suitable npm package exists, rather than implementing from scratch.

### 6. RTL Pipeline (`rtl-pipeline.ts`)

Orchestrates the full processing flow:

```typescript
function processOutput(raw: string, mode: RTLMode): string {
  if (mode === 'off') return raw;

  // 1. Strip ANSI codes
  const { cleanText, codes } = ansiParser.strip(raw);

  // 2. Check for RTL characters (auto-detect)
  if (mode === 'auto' && !containsRTL(cleanText)) return raw;

  // 3. Process line by line
  const lines = cleanText.split('\n');
  const processed = lines.map(line => {
    // 3a. Reshape Arabic characters
    const reshaped = arabicReshaper.reshape(line);
    // 3b. Apply BiDi algorithm
    const reordered = bidiEngine.reorder(reshaped);
    return reordered;
  });

  // 4. Restore ANSI codes
  return ansiParser.restore(processed.join('\n'), codes);
}
```

### 7. RTL Detector (`rtl-detector.ts`)

Detects whether text contains RTL characters:

- Check Unicode ranges: Arabic (U+0600–U+06FF), Hebrew (U+0590–U+05FF), Persian extensions, Urdu, Thaana, Syriac
- Configurable sensitivity threshold (e.g., activate if >5% of characters are RTL)
- Cache results for performance

### 8. Status Bar (`status-bar.ts`)

- Shows current RTL mode: `RTL: Auto`, `RTL: On`, `RTL: Off`
- Click to cycle through modes
- Visual indicator (e.g., icon changes) when RTL processing is active

## User Experience

### Opening an RTL Terminal

1. **Command palette**: `RTL Terminal: New Terminal`
2. **Terminal dropdown**: Click `+` dropdown → select "RTL Terminal" profile
3. **Default profile**: Set "RTL Terminal" as default in VS Code settings

### Settings

```jsonc
{
  // RTL processing mode: "auto" | "on" | "off"
  "rtlTerminal.mode": "auto",

  // Shell to use (defaults to VS Code's default shell)
  "rtlTerminal.shell": "",

  // Shell arguments
  "rtlTerminal.shellArgs": [],

  // Additional RTL Unicode ranges to detect (beyond defaults)
  "rtlTerminal.additionalRTLRanges": [],

  // Enable input reshaping (reshape Arabic as you type)
  "rtlTerminal.reshapeInput": true,

  // Log level for debugging
  "rtlTerminal.logLevel": "off"
}
```

### Status Bar

```
┌──────────────────────────────────────────────┐
│ [other items]                    RTL: Auto   │
└──────────────────────────────────────────────┘
```

Click cycles: Auto → On → Off → Auto

### Commands

| Command | ID | Description |
|---------|-----|-------------|
| New RTL Terminal | `rtlTerminal.newTerminal` | Open a new terminal with RTL support |
| Toggle RTL Mode | `rtlTerminal.toggleMode` | Cycle through auto/on/off |
| Set RTL On | `rtlTerminal.setModeOn` | Force RTL processing on |
| Set RTL Off | `rtlTerminal.setModeOff` | Force RTL processing off |
| Set RTL Auto | `rtlTerminal.setModeAuto` | Auto-detect RTL text |

## Technical Decisions

### Why Pseudoterminal over xterm.js patching?
VS Code extensions cannot access xterm.js internals, inject addons, or modify the terminal DOM. The Pseudoterminal API is the only official way to customize terminal behavior.

### Why process text instead of using a WebView?
A WebView terminal would need to reimplement scrollback, selection, ANSI rendering, and all terminal features from scratch. The Pseudoterminal approach reuses xterm.js for rendering — we only transform the text data.

### Why line-by-line processing?
Terminal output is line-oriented. BiDi reordering within a single line is well-defined. Cross-line BiDi is not meaningful in a terminal context.

### node-pty for shell spawning
`node-pty` is the standard library for spawning PTY processes in Node.js. It's used by VS Code itself internally and handles platform-specific PTY creation (macOS, Linux, Windows).

## Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `node-pty` | Spawn PTY shell processes | Native module |
| TBD: BiDi library or custom | Unicode BiDi Algorithm (UAX #9) | ~20KB |
| None (custom) | Arabic reshaper | Custom, ~10KB |

Prefer minimal dependencies. Arabic reshaper will be custom (it's a lookup table + context analysis). BiDi engine: evaluate `bidi-js` or similar, otherwise implement a simplified version.

## Performance Considerations

- **Buffering**: Buffer output for 16ms (one frame) before processing to batch rapid writes
- **Pass-through fast path**: If mode is "auto" and no RTL characters detected, return raw text immediately (zero overhead)
- **Caching**: Cache reshaped words (LRU cache) since terminal output often repeats
- **ANSI parsing**: Use a state machine parser, not regex, for performance

## Testing Strategy

- **Unit tests**: Arabic reshaper (all letter forms, ligatures, edge cases), BiDi engine (UAX #9 conformance), ANSI parser (strip + restore round-trip)
- **Integration tests**: Full pipeline with real Arabic text samples, mixed Arabic/English, ANSI-colored Arabic text
- **Manual testing**: Claude Code output, `echo` Arabic text, `cat` Arabic files, Arabic filenames in `ls`

## Success Criteria

1. Arabic text from Claude Code renders with connected letters in correct reading order
2. Mixed Arabic/English text displays with correct directional ordering
3. ANSI colors/styles are preserved through the pipeline
4. No noticeable latency for typical terminal output
5. Auto-detection correctly activates for RTL text and stays inactive for LTR-only text
6. Works in VS Code, Cursor, and Antigravity (any VS Code fork)

## Future Considerations (not in scope)

- Publishing to VS Code Marketplace
- Full RTL layout mirroring (scrollbar, cursor position)
- Custom font rendering for better Arabic typography
- Standalone terminal emulator outside VS Code
