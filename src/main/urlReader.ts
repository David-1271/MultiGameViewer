// Asks the UI Automation worker which page a game window is showing. Retries briefly because
// the browser only builds its accessibility tree once it is first asked; restarts the worker
// if a call ever hangs, so a stuck browser can't block anything else.
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Logger } from './logger';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class UrlReader {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly pending = new Map<number, (url: string | null) => void>();

  constructor(private readonly log: Logger) {}

  private ensure(): Worker {
    if (this.worker) return this.worker;
    // Packaged builds keep the worker unpacked next to app.asar (see asarUnpack in package.json).
    const file = path.join(__dirname, 'win32', 'uiaWorker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const w = new Worker(file);
    w.on('message', (m: { id: number; url: string | null }) => {
      this.pending.get(m.id)?.(m.url);
      this.pending.delete(m.id);
    });
    w.on('error', (err) => {
      this.log.warn('URL reader worker failed', err);
      this.reset();
    });
    w.unref();
    this.worker = w;
    return w;
  }

  private reset(): void {
    void this.worker?.terminate();
    this.worker = null;
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }

  private once(hwnd: number, timeoutMs: number): Promise<string | null> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.log.warn('URL lookup timed out; restarting the reader');
        this.reset();
        resolve(null);
      }, timeoutMs);
      this.pending.set(id, (url) => {
        clearTimeout(timer);
        resolve(url);
      });
      this.ensure().postMessage({ id, hwnd });
    });
  }

  /** URL shown in `hwnd`, or null. */
  async read(hwnd: number, attempts = 4): Promise<string | null> {
    for (let i = 0; i < attempts; i++) {
      const url = await this.once(hwnd, 4000);
      if (url) return url;
      await sleep(700);
    }
    return null;
  }

  dispose(): void {
    this.reset();
  }
}
