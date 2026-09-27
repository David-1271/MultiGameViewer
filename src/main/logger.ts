// Small file + console logger with size-based rotation. Logs never contain page content,
// cookies or credentials - only window/process events and errors.
import * as fs from 'node:fs';
import * as path from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private stream: fs.WriteStream | null = null;

  constructor(
    readonly filePath: string,
    private readonly minLevel: Level = 'info',
    maxBytes = 2_000_000,
  ) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > maxBytes) {
        fs.renameSync(filePath, `${filePath}.1`);
      }
      this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    } catch {
      this.stream = null; // console only
    }
  }

  private write(level: Level, msg: string, err?: unknown): void {
    const order: Level[] = ['debug', 'info', 'warn', 'error'];
    if (order.indexOf(level) < order.indexOf(this.minLevel)) return;
    const detail = err instanceof Error ? ` :: ${err.stack ?? err.message}` : err !== undefined ? ` :: ${String(err)}` : '';
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}${detail}`;
    (level === 'error' ? console.error : console.log)(line);
    this.stream?.write(line + '\n');
  }

  debug(msg: string): void {
    this.write('debug', msg);
  }
  info(msg: string): void {
    this.write('info', msg);
  }
  warn(msg: string, err?: unknown): void {
    this.write('warn', msg, err);
  }
  error(msg: string, err?: unknown): void {
    this.write('error', msg, err);
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}
