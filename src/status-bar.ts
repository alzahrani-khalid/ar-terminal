import * as vscode from 'vscode';
import type { RtlMode } from './rtl-pipeline';

const MODE_LABELS: Record<RtlMode, string> = {
  auto: 'RTL: Auto',
  on: 'RTL: On',
  off: 'RTL: Off',
};

const MODE_CYCLE: RtlMode[] = ['auto', 'on', 'off'];

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private currentMode: RtlMode;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'rtlTerminal.toggleMode';
    this.currentMode = vscode.workspace
      .getConfiguration('rtlTerminal')
      .get<RtlMode>('mode', 'auto');
    this.update();
  }

  getMode(): RtlMode {
    return this.currentMode;
  }

  setMode(mode: RtlMode): void {
    this.currentMode = mode;
    this.update();
  }

  toggle(): RtlMode {
    const currentIndex = MODE_CYCLE.indexOf(this.currentMode);
    const nextIndex = (currentIndex + 1) % MODE_CYCLE.length;
    this.currentMode = MODE_CYCLE[nextIndex];
    this.update();
    return this.currentMode;
  }

  show(): void {
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }

  private update(): void {
    this.item.text = MODE_LABELS[this.currentMode];
    this.item.tooltip = `RTL Terminal Mode: ${this.currentMode} (click to toggle)`;
  }
}
