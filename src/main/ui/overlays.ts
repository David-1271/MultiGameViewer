// The viewer's own (tiny) windows:
//  - backdrop: black surface behind the games (gaps, placeholders for closed games)
//  - toolbar:  auto-hiding control strip at the top edge
//  - labels:   optional click-through name tags, created by the backdrop page with
//              window.open so they share its renderer process instead of adding four more.
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import * as path from 'node:path';
import type { Rect, SlotId, UiCommand, UiState } from '../../shared/types';
import type { Logger } from '../logger';

const RENDERER_DIR = path.join(__dirname, '..', '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', '..', 'preload', 'preload.js');
const LABEL_FRAME_PREFIX = 'mgv-label-';
export const LABEL_SIZE = { width: 420, height: 34 };

function hwndOf(win: BrowserWindow): number {
  const buf = win.getNativeWindowHandle();
  return Number(buf.length >= 8 ? buf.readBigUInt64LE(0) : buf.readUInt32LE(0));
}

function lockDown(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.removeMenu();
}

export class Overlays {
  backdrop!: BrowserWindow;
  toolbar!: BrowserWindow;
  readonly labels: (BrowserWindow | null)[] = [null, null, null, null];
  private toolbarSize = { width: 980, height: 46 };
  private areaDip: Rect = { x: 0, y: 0, width: 800, height: 600 };
  private lastState: UiState | null = null;
  private readonly onIpc: (e: IpcMainEvent, cmd: unknown) => void;

  constructor(
    private readonly onCommand: (cmd: UiCommand) => void,
    private readonly log: Logger,
  ) {
    this.onIpc = (e, cmd) => {
      const ours = [this.toolbar?.webContents, this.backdrop?.webContents];
      if (!ours.includes(e.sender)) return; // only our own pages may send commands
      if (cmd && typeof cmd === 'object' && typeof (cmd as { type?: unknown }).type === 'string') this.onCommand(cmd as UiCommand);
    };
  }

  async create(): Promise<void> {
    const common = {
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    } as const;

    this.backdrop = new BrowserWindow({ ...common, title: 'MultiGame Viewer', backgroundColor: '#000000', focusable: false, movable: false });
    lockDown(this.backdrop);
    this.backdrop.webContents.setWindowOpenHandler(({ frameName }) => {
      if (!frameName.startsWith(LABEL_FRAME_PREFIX)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          resizable: false,
          thickFrame: false,
          focusable: false,
          skipTaskbar: true,
          hasShadow: false,
          alwaysOnTop: true,
          width: LABEL_SIZE.width,
          height: LABEL_SIZE.height,
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      };
    });
    this.backdrop.webContents.on('did-create-window', (child, details) => {
      const slot = Number(details.frameName.slice(LABEL_FRAME_PREFIX.length));
      if (!(slot >= 0 && slot <= 3)) return;
      child.setIgnoreMouseEvents(true);
      child.setAlwaysOnTop(true, 'pop-up-menu');
      child.removeMenu();
      this.labels[slot] = child;
      child.on('closed', () => (this.labels[slot] = null));
    });

    this.toolbar = new BrowserWindow({
      ...common,
      title: 'MultiGame Viewer controls',
      width: this.toolbarSize.width,
      height: this.toolbarSize.height,
      backgroundColor: '#15171c',
      alwaysOnTop: true,
    });
    lockDown(this.toolbar);
    this.toolbar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.toolbar.setAlwaysOnTop(true, 'screen-saver');

    ipcMain.on('mgv:command', this.onIpc);
    await Promise.all([
      this.backdrop.loadFile(path.join(RENDERER_DIR, 'backdrop.html')),
      this.toolbar.loadFile(path.join(RENDERER_DIR, 'toolbar.html')),
    ]);
    for (const w of [this.backdrop, this.toolbar]) {
      w.webContents.on('render-process-gone', (_e, d) => {
        this.log.error(`Viewer UI renderer exited (${d.reason}); reloading`);
        w.reload();
      });
      w.webContents.on('did-finish-load', () => this.lastState && w.webContents.send('mgv:state', this.lastState));
    }
  }

  ownHwnds(): Set<number> {
    const set = new Set<number>();
    for (const w of [this.backdrop, this.toolbar, ...this.labels]) if (w && !w.isDestroyed()) set.add(hwndOf(w));
    return set;
  }

  backdropHwnd(): number {
    return hwndOf(this.backdrop);
  }

  setArea(areaDip: Rect): void {
    this.areaDip = areaDip;
    this.backdrop.setBounds(areaDip);
    if (this.toolbar.isVisible()) this.positionToolbar();
  }

  showBackdrop(): void {
    if (!this.backdrop.isVisible()) this.backdrop.showInactive();
  }

  hideBackdrop(): void {
    this.backdrop.hide();
  }

  // ---- toolbar ----------------------------------------------------------------------

  private positionToolbar(): void {
    const width = Math.min(this.toolbarSize.width, this.areaDip.width - 16);
    const height = Math.min(this.toolbarSize.height, this.areaDip.height - 16);
    const x = Math.round(this.areaDip.x + (this.areaDip.width - width) / 2);
    this.toolbar.setBounds({ x, y: this.areaDip.y, width, height });
  }

  setToolbarSize(width: number, height: number): void {
    const w = Math.max(320, Math.min(1600, Math.round(width)));
    const h = Math.max(36, Math.min(900, Math.round(height)));
    if (w === this.toolbarSize.width && h === this.toolbarSize.height) return;
    this.toolbarSize = { width: w, height: h };
    this.positionToolbar();
  }

  showToolbar(): void {
    this.positionToolbar();
    if (!this.toolbar.isVisible()) this.toolbar.showInactive();
    this.toolbar.moveTop();
  }

  hideToolbar(): void {
    if (this.toolbar.isVisible()) this.toolbar.hide();
  }

  toolbarVisible(): boolean {
    return this.toolbar.isVisible();
  }

  toolbarBounds(): Rect {
    return this.toolbar.getBounds();
  }

  // ---- labels -----------------------------------------------------------------------

  placeLabel(slot: SlotId, at: { x: number; y: number } | null): void {
    const w = this.labels[slot];
    if (!w || w.isDestroyed()) return;
    if (!at) {
      if (w.isVisible()) w.hide();
      return;
    }
    w.setBounds({ x: Math.round(at.x), y: Math.round(at.y), width: LABEL_SIZE.width, height: LABEL_SIZE.height });
    if (!w.isVisible()) w.showInactive();
    w.moveTop();
  }

  hideLabels(): void {
    for (const w of this.labels) if (w && !w.isDestroyed() && w.isVisible()) w.hide();
  }

  /** Re-assert the overlays above the games after z-order changes. */
  raiseOverlays(): void {
    for (const w of this.labels) if (w && !w.isDestroyed() && w.isVisible()) w.moveTop();
    if (this.toolbar.isVisible()) this.toolbar.moveTop();
  }

  send(state: UiState): void {
    this.lastState = state;
    for (const w of [this.toolbar, this.backdrop]) if (w && !w.isDestroyed()) w.webContents.send('mgv:state', state);
  }

  destroy(): void {
    ipcMain.removeListener('mgv:command', this.onIpc);
    for (const w of [...this.labels, this.toolbar, this.backdrop]) if (w && !w.isDestroyed()) w.destroy();
  }
}
