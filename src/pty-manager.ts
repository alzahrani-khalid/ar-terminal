import * as os from 'node:os';
import * as pty from 'node-pty';

export interface PtyManagerOptions {
  shell?: string;
  shellArgs?: string[];
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export class PtyManager {
  private ptyProcess: pty.IPty | undefined;
  private dataBuffer = '';
  private bufferTimeout: ReturnType<typeof setTimeout> | undefined;
  private onDataCallback: ((data: string) => void) | undefined;
  private onExitCallback: ((code: number) => void) | undefined;
  private readonly BUFFER_DELAY_MS = 16;

  start(options: PtyManagerOptions = {}): void {
    const shell =
      options.shell ||
      (os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash');

    this.ptyProcess = pty.spawn(shell, options.shellArgs || [], {
      name: 'xterm-256color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 30,
      cwd: options.cwd || os.homedir(),
      env: options.env || (process.env as Record<string, string>),
    });

    this.ptyProcess.onData((data: string) => {
      this.bufferData(data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.flushBuffer();
      this.onExitCallback?.(exitCode);
    });
  }

  onData(callback: (data: string) => void): void {
    this.onDataCallback = callback;
  }

  onExit(callback: (code: number) => void): void {
    this.onExitCallback = callback;
  }

  write(data: string): void {
    this.ptyProcess?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.ptyProcess?.resize(cols, rows);
  }

  kill(): void {
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
      this.bufferTimeout = undefined;
    }
    this.flushBuffer();
    this.ptyProcess?.kill();
    this.ptyProcess = undefined;
  }

  private bufferData(data: string): void {
    this.dataBuffer += data;

    if (PtyManager.hasIncompleteSequence(this.dataBuffer)) {
      if (!this.bufferTimeout) {
        this.bufferTimeout = setTimeout(() => {
          this.flushBuffer();
        }, 50);
      }
      return;
    }

    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
    }
    this.bufferTimeout = setTimeout(() => {
      this.flushBuffer();
    }, this.BUFFER_DELAY_MS);
  }

  private flushBuffer(): void {
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
      this.bufferTimeout = undefined;
    }
    if (this.dataBuffer.length > 0) {
      const data = this.dataBuffer;
      this.dataBuffer = '';
      this.onDataCallback?.(data);
    }
  }

  static hasIncompleteSequence(data: string): boolean {
    if (data.length === 0) return false;

    // Check for incomplete ANSI escape at end
    const lastEsc = data.lastIndexOf('\x1b');
    if (lastEsc >= 0 && lastEsc >= data.length - 10) {
      const after = data.slice(lastEsc);
      if (after === '\x1b') return true;
      if (/^\x1b\[[0-9;]*$/.test(after)) return true;
    }

    // Check for incomplete UTF-16 surrogate at end
    const lastCharCode = data.charCodeAt(data.length - 1);
    if (lastCharCode >= 0xD800 && lastCharCode <= 0xDBFF) return true;

    return false;
  }
}
