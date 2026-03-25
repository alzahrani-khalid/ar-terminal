import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('rtlTerminal.newTerminal', () => {
      vscode.window.showInformationMessage('RTL Terminal: Coming soon');
    })
  );
}

export function deactivate() {}
