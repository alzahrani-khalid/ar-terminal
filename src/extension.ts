import * as vscode from 'vscode';
import { PtyManager } from './pty-manager';
import { RtlPipeline, type RtlMode } from './rtl-pipeline';
import { StatusBarManager } from './status-bar';
import { WebviewTerminal } from './webview-terminal';

let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
  statusBar = new StatusBarManager();
  statusBar.show();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // Register empty tree data provider for sidebar view (makes the icon show)
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('rtlTerminal.welcome', {
      getTreeItem: () => new vscode.TreeItem(''),
      getChildren: () => [],
    })
  );

  // Register terminal profile provider (Pseudoterminal fallback)
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

  // Register commands
  context.subscriptions.push(
    // Primary: WebView terminal with native Arabic rendering
    vscode.commands.registerCommand('rtlTerminal.newTerminal', () => {
      new WebviewTerminal(context);
    }),
    vscode.commands.registerCommand('rtlTerminal.toggleMode', () => {
      const newMode = statusBar.toggle();
      vscode.window.showInformationMessage(`RTL Terminal: ${newMode}`);
    }),
    vscode.commands.registerCommand('rtlTerminal.setModeOn', () => {
      statusBar.setMode('on');
    }),
    vscode.commands.registerCommand('rtlTerminal.setModeOff', () => {
      statusBar.setMode('off');
    }),
    vscode.commands.registerCommand('rtlTerminal.setModeAuto', () => {
      statusBar.setMode('auto');
    })
  );
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
