// One browser instance (= one --user-data-dir). Opening a window starts the browser the first
// time and afterwards hands off to the running instance through Chromium's normal
// process-singleton, so all windows of a profile share one browser process and one sign-in.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { launchArgs, processTypeOf, type BrowserInstall } from '../../core/browsers';
import type { Logger } from '../logger';
import { appWindowsOf, isAlive, requestClose } from '../win32/windows';
import { ProcessWatch, commandLineOf, findBrowserProcesses, isProcessAlive, processTree, pruneCaches, snapshotProcesses, terminateProcess, type ProcInfo } from '../win32/processes';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface HostProcesses {
  browserPid: number | null;
  /** browser + all child processes (renderers, GPU, audio service...). */
  tree: (ProcInfo & { type: string })[];
}

export class BrowserHost {
  private browserPid: number | null = null;
  private watch: ProcessWatch | null = null;
  /** Exit code of the last browser process that went away (null = none seen yet). */
  lastExitCode: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly browser: BrowserInstall,
    readonly userDataDir: string,
    private readonly log: Logger,
    readonly label: string,
  ) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  private get exeName(): string {
    return path.win32.basename(this.browser.exe);
  }

  /** Locate the browser process for our profile (it may predate us, e.g. after a controller crash). */
  refreshPid(procs?: readonly ProcInfo[]): number | null {
    if (this.browserPid !== null && this.watch) {
      // Ask the process handle, not the process list: an exited process can linger in
      // snapshots while any handle (including ours) is still open.
      const code = this.watch.exitCode();
      if (code === null) return this.browserPid;
      this.lastExitCode = code;
      this.watch.close();
      this.watch = null;
      this.browserPid = null;
      this.log.info(`[${this.label}] browser process exited (code 0x${(code >>> 0).toString(16)})`);
    }
    const pids = findBrowserProcesses(procs ?? snapshotProcesses(), this.exeName, this.userDataDir).filter(isProcessAlive);
    this.browserPid = pids[0] ?? null;
    if (this.browserPid !== null) {
      this.watch = new ProcessWatch(this.browserPid);
      this.log.info(`[${this.label}] browser process ${this.browserPid}`);
    }
    return this.browserPid;
  }

  isRunning(): boolean {
    return this.refreshPid() !== null;
  }

  pids(): Set<number> {
    const pid = this.refreshPid();
    return new Set(pid === null ? [] : [pid]);
  }

  /** Current top-level app windows of this browser instance. */
  windows(): number[] {
    const pids = this.pids();
    return pids.size ? appWindowsOf(pids) : [];
  }

  processes(procs: readonly ProcInfo[]): HostProcesses {
    const pid = this.refreshPid(procs);
    if (pid === null) return { browserPid: null, tree: [] };
    const tree = processTree(procs, pid).map((p) => ({ ...p, type: processTypeOf(commandLineOf(p.pid) ?? '--type=unknown') }));
    pruneCaches(new Set(procs.map((p) => p.pid)));
    return { browserPid: pid, tree };
  }

  /**
   * Open an app window at `url` and resolve with its HWND. Calls are serialised so each new
   * window can be told apart from the ones that already exist.
   */
  openWindow(url: string, exclude: ReadonlySet<number> = new Set(), timeoutMs = 25000): Promise<number> {
    const run = async () => {
      const before = new Set([...this.windows(), ...exclude]);
      const args = launchArgs(this.userDataDir, url);
      this.log.info(`[${this.label}] launching ${this.exeName} (${this.browserPid === null ? 'start' : 'new window'})`);
      const child = spawn(this.browser.exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', (err) => this.log.error(`[${this.label}] failed to start browser`, err));
      child.unref();
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(120);
        const fresh = this.windows().filter((h) => !before.has(h));
        if (fresh.length) return fresh[0];
      }
      throw new Error(`${this.browser.name} did not open a window within ${Math.round(timeoutMs / 1000)}s`);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Politely close every window, then make sure the process tree is gone. */
  async shutdown(graceMs = 6000): Promise<void> {
    const pid = this.refreshPid();
    if (pid === null) return;
    for (const hwnd of this.windows()) requestClose(hwnd);
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && isProcessAlive(pid)) await sleep(150);
    if (isProcessAlive(pid)) {
      this.log.warn(`[${this.label}] browser did not exit in time; terminating`);
      const procs = snapshotProcesses();
      for (const p of processTree(procs, pid).reverse()) terminateProcess(p.pid);
    }
    this.browserPid = null;
  }

  /** Close one window (used for "reopen"/"guide"). */
  async closeWindow(hwnd: number, timeoutMs = 4000): Promise<void> {
    if (!isAlive(hwnd)) return;
    requestClose(hwnd);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && isAlive(hwnd)) await sleep(100);
  }
}
