import * as vscode from 'vscode';
import { PtyManager } from './pty-manager';
import { RtlPipeline, type RtlMode } from './rtl-pipeline';
import { StatusBarManager } from './status-bar';
import { WebviewTerminal } from './webview-terminal';

let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
  try {
    statusBar = new StatusBarManager();
    statusBar.show();
    context.subscriptions.push({ dispose: () => statusBar.dispose() });
  } catch (err) {
    console.error('[RTL Terminal] StatusBar init error:', err);
  }

  // Register empty tree data provider for sidebar view (makes the icon show)
  try {
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider('rtlTerminal.welcome', {
        getTreeItem: () => new vscode.TreeItem(''),
        getChildren: () => [],
      })
    );
  } catch (err) {
    console.error('[RTL Terminal] TreeDataProvider error:', err);
  }

  // Register terminal profile provider (Pseudoterminal fallback)
  try {
    const profileProvider = vscode.window.registerTerminalProfileProvider(
      'rtlTerminal.rtlTerminal',
      {
        provideTerminalProfile(): vscode.ProviderResult<vscode.TerminalProfile> {
          return new vscode.TerminalProfile({
            name: 'RTL Terminal',
            pty: createRtlPseudoterminal(),
          });
        },
      }
    );
    context.subscriptions.push(profileProvider);
  } catch (err) {
    console.error('[RTL Terminal] Profile provider error:', err);
  }

  // Track active terminal instances
  const terminals: WebviewTerminal[] = [];
  let activeTerminal: WebviewTerminal | undefined;

  // Register commands — each wrapped in try/catch to avoid blocking others
  context.subscriptions.push(
    // Primary: WebView terminal with native Arabic rendering
    vscode.commands.registerCommand('rtlTerminal.newTerminal', () => {
      const term = new WebviewTerminal(context);
      terminals.push(term);
      activeTerminal = term;
      term.onDidFocus(() => { activeTerminal = term; });
      term.onDidDispose(() => {
        const idx = terminals.indexOf(term);
        if (idx >= 0) terminals.splice(idx, 1);
        if (activeTerminal === term) activeTerminal = terminals[terminals.length - 1];
      });
    }),
    // Keybinding passthrough — sends escape sequences to the active PTY
    vscode.commands.registerCommand('rtlTerminal.sendSequence', (args: { data: string }) => {
      if (activeTerminal && args?.data) {
        activeTerminal.writeToPty(args.data);
      }
    }),
    vscode.commands.registerCommand('rtlTerminal.toggleMode', () => {
      const newMode = statusBar?.toggle();
      if (newMode) vscode.window.showInformationMessage(`RTL Terminal: ${newMode}`);
    }),
    vscode.commands.registerCommand('rtlTerminal.setModeOn', () => {
      statusBar?.setMode('on');
    }),
    vscode.commands.registerCommand('rtlTerminal.setModeOff', () => {
      statusBar?.setMode('off');
    }),
    vscode.commands.registerCommand('rtlTerminal.setModeAuto', () => {
      statusBar?.setMode('auto');
    })
  );

  console.log('[RTL Terminal] Extension activated successfully');
}

function createRtlPseudoterminal(): vscode.Pseudoterminal {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number | void>();

  const ptyManager = new PtyManager();
  const pipeline = new RtlPipeline();

  const config = vscode.workspace.getConfiguration('rtlTerminal');

  const pseudoterminal: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
      ptyManager.onData((data: string) => {
        try {
          const mode = statusBar.getMode();
          const processed = pipeline.process(data, mode);
          writeEmitter.fire(processed);
        } catch (err) {
          // Fallback: write raw data on error
          writeEmitter.fire(data);
          console.error('[RTL Terminal] Pipeline error:', err);
        }
      });

      ptyManager.onExit((code: number) => {
        closeEmitter.fire(code);
      });

      try {
        ptyManager.start({
          shell: config.get<string>('shell') || undefined,
          shellArgs: config.get<string[]>('shellArgs') || undefined,
          cols: initialDimensions?.columns,
          rows: initialDimensions?.rows,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[RTL Terminal] Failed to start PTY:', message);
        writeEmitter.fire(`\r\n[RTL Terminal] Error: ${message}\r\n`);
        writeEmitter.fire('If node-pty failed to load, try: npm rebuild node-pty\r\n');
      }
    },

    close(): void {
      pipeline.reset();
      ptyManager.kill();
    },

    handleInput(data: string): void {
      ptyManager.write(data);
    },

    setDimensions(dimensions: vscode.TerminalDimensions): void {
      ptyManager.resize(dimensions.columns, dimensions.rows);
    },
  };

  return pseudoterminal;
}

export function deactivate() {
  statusBar?.dispose();
}
