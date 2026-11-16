import * as vscode from 'vscode';
import { disposeRunner, registerDeck } from './deck';

export function activate(context: vscode.ExtensionContext): void {
  registerDeck(context);

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = '$(layout) Agents';
  item.tooltip = 'Open Vibe Studio';
  item.command = 'vibeStudio.open';
  const sync = () => (vscode.workspace.getConfiguration('vibeStudio').get('showStatusBar', true) ? item.show() : item.hide());
  sync();
  context.subscriptions.push(
    item,
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vibeStudio.showStatusBar') && sync()),
  );
}

export function deactivate(): void {
  disposeRunner();
}
