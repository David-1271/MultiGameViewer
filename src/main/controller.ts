// Orchestrates everything: which game goes where, keeping the browser windows placed,
// audio, the viewer's own UI, and recovery when a game window or browser goes away.
import { app, dialog, net, screen, shell, type Display, type Tray } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LayoutMode, LayoutState, Rect, SlotId, SlotPhase, SlotView, StatsView, UiCommand, UiState } from '../shared/types';
import { audioOnly, cycleAudio, effectiveMuted, onGameFocused, toggleMaster, toggleMute } from '../core/audio';
import { browserKey, locateBrowser, type BrowserInstall } from '../core/browsers';
import { describeDisplays, pickDisplay, type DisplayInfo } from '../core/displays';
import { calibrationPageUrl, DEFAULT_TITLE_DIP, parseCalibrationTitle, titleDipFromCalibration } from '../core/frame';
import { computeLayout, gapMasks, gridCells, physicalToLocalDip, SLOT_IDS, type Placement } from '../core/geometry';
import { setMode, spotlight, swapSlots, toggleSolo } from '../core/layout';
import { stackingOrder, type StackItem } from '../core/stacking';
import { defaultSettings, SettingsStore } from '../core/settings';
import { resolveLink, YOUTUBE_HOME, type YouTubeTarget } from '../core/links';
import { cleanTitle, looksLikeSignIn } from '../core/titles';
import { BrowserHost } from './browser/host';
import { Hotkeys, hotkeyViews, type Hotkey } from './hotkeys';
import type { Logger } from './logger';
import { appPaths, profileDir } from './paths';
import { WindowPlacer } from './placer';
import { startDevControl } from './devControl';
import { createTray } from './tray';
import { Overlays } from './ui/overlays';
import { UrlReader } from './urlReader';
import { YouTubePlayerServer } from './youtubePlayer';
import { AudioSessionController } from './win32/audio';
import { C } from './win32/native';
import { privateBytes, sampleCpuPercent, snapshotProcesses, type ProcInfo } from './win32/processes';
import { GpuSampler } from './win32/gpu';
import { GapMasks } from './win32/masks';
import { EVENT_SYSTEM_FOREGROUND, watchWinEvents } from './win32/winEvents';
import * as win from './win32/windows';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Slot {
  id: SlotId;
  hwnd: number | null;
  phase: SlotPhase;
  title: string;
  expected: { outer: Rect; region: Rect | null } | null;
  needsPlace: boolean;
  placedAt: number;
  opening: boolean;
  /** The user chose "Open on YouTube page": don't auto-fill this window. */
  watchPageOptOut: boolean;
  fillTimer: NodeJS.Timeout | null;
}

type Banner = NonNullable<UiState['banner']> & { sticky?: boolean };

export class Controller {
  private readonly paths = appPaths();
  private readonly store: SettingsStore;
  private readonly overlays: Overlays;
  private readonly placer: WindowPlacer;
  private readonly audio: AudioSessionController;
  private readonly hotkeys: Hotkeys;
  private tray: Tray | null = null;
  private browser: BrowserInstall | null = null;
  private hosts: BrowserHost[] = [];
  private readonly slots: Slot[] = SLOT_IDS.map((id) => ({ id, hwnd: null, phase: 'closed', title: '', expected: null, needsPlace: false, placedAt: 0, opening: false, watchPageOptOut: false, fillTimer: null }));
  private display!: DisplayInfo;
  private areaPhys: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private areaDip: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private placements = new Map<SlotId, Placement>();
  private titleDip = DEFAULT_TITLE_DIP;
  private calibrationHwnd: number | null = null;
  private layoutOverride: LayoutState | null = null;
  private soloReturnMode: LayoutMode = 'grid';
  private active = false;
  private minimized = false;
  private swapFrom: SlotId | null = null;
  private banner: Banner | null = null;
  private bannerTimer: NodeJS.Timeout | null = null;
  private toolbarPinned = false;
  private toolbarHideAt: number | null = null;
  private statsVisible = false;
  private stats: StatsView | null = null;
  private online = true;
  private starting = false;
  private quitting = false;
  private lastFg = 0;
  private lastFgSlot: SlotId | null = null;
  private browserPids = new Set<number>();
  private lastProcs: ProcInfo[] = [];
  /** Until this time a minimize/restore of the whole set is still being applied. */
  private transitionUntil = 0;
  private signInMode = false;
  private forceAudio = true;
  private restartLog: number[] = [];
  private pushTimer: NodeJS.Timeout | null = null;
  private displayTimer: NodeJS.Timeout | null = null;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly gapMasks = new GapMasks();
  private readonly player: YouTubePlayerServer;
  private readonly urls: UrlReader;
  private readonly gpu: GpuSampler;
  private maskWindows: { hwnd: number; rect: Rect }[] = [];
  private unhookWinEvents: (() => void) | null = null;
  private devServer: ReturnType<typeof startDevControl> = null;

  constructor(private readonly log: Logger) {
    this.store = new SettingsStore(this.paths.settings, (m, e) => log.warn(m, e));
    this.overlays = new Overlays((cmd) => this.command(cmd), log);
    this.placer = new WindowPlacer({
      titleDip: () => this.titleDip,
      cropAdjust: () => this.settings.titleCropAdjust,
      onRegionRejected: (h) => log.info(`Window ${h} no longer accepts a clip region (it was fullscreen); edges stay mouse-active`),
    });
    this.audio = new AudioSessionController((m, e) => log.warn(m, e));
    this.hotkeys = new Hotkeys((h) => this.runHotkey(h), log);
    this.gpu = new GpuSampler((m) => log.warn(m));
    this.player = new YouTubePlayerServer(log);
    this.urls = new UrlReader(log);
  }

  private get settings() {
    return this.store.get();
  }

  private get layout(): LayoutState {
    return this.layoutOverride ?? this.settings.layout;
  }

  private hostFor(slot: SlotId): BrowserHost {
    return this.hosts[this.settings.sessionMode === 'shared' ? 0 : slot];
  }

  // ---------------------------------------------------------------------------------------
  // Startup / shutdown
  // ---------------------------------------------------------------------------------------

  async start(): Promise<void> {
    await this.overlays.create();
    this.tray = createTray((cmd) => (cmd === 'showToolbar' ? this.showControls() : this.command(cmd)));
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed'] as const) {
      screen.on(ev as 'display-added', () => this.onDisplaysChanged());
    }
    await this.player.start();
    this.computeArea();
    this.overlays.showBackdrop();
    this.startTimers();
    this.unhookWinEvents = watchWinEvents((event) => (event === EVENT_SYSTEM_FOREGROUND ? this.trackForeground() : this.watchdog()));
    this.devServer = startDevControl((cmd) => this.command(cmd), () => this.buildState(), this.log);

    this.browser = locateBrowser(this.settings.browser, this.settings.browserPath, process.env, {
      exists: (p) => fs.existsSync(p),
      readdir: (p) => fs.readdirSync(p),
    });
    if (!this.browser) {
      this.log.error('No supported browser found (Chrome or Edge)');
      this.setBanner({ text: 'Google Chrome or Microsoft Edge is required. Install one (or set a browser path in Settings), then restart.', kind: 'error', sticky: true });
      this.showControls(true);
      void dialog.showMessageBox({
        type: 'error',
        title: 'MultiGame Viewer',
        message: 'No supported browser found',
        detail: 'MultiGame Viewer plays YouTube TV in Google Chrome or Microsoft Edge (they include the Widevine DRM that YouTube TV requires). Install one and start the viewer again.',
      });
      return;
    }
    this.log.info(`Using ${this.browser.name} ${this.browser.version} at ${this.browser.exe}`);
    this.titleDip = this.settings.calibration[browserKey(this.browser)] ?? DEFAULT_TITLE_DIP;
    this.buildHosts();
    await this.startGames();
  }

  private buildHosts(): void {
    const b = this.browser!;
    const mode = this.settings.sessionMode;
    const count = mode === 'shared' ? 1 : 4;
    this.hosts = Array.from({ length: count }, (_, i) =>
      new BrowserHost(b, profileDir(this.paths.profilesRoot, b.kind, mode, i as SlotId), this.log, mode === 'shared' ? 'browser' : `game ${i + 1}`),
    );
  }

  private async startGames(): Promise<void> {
    this.starting = true;
    try {
      const adopted = this.adoptExistingWindows();
      const needCalibration = this.settings.calibration[browserKey(this.browser!)] === undefined;
      if (needCalibration && adopted === 0) await this.calibrate();

      const wantsTv = this.settings.defaultService === 'youtubetv' && !this.settings.slotLinks[0];
      this.signInMode = wantsTv && this.settings.sessionMode === 'shared' && !this.settings.signInCompleted && adopted === 0;
      if (this.signInMode) {
        this.layoutOverride = { ...this.settings.layout, mode: 'solo', focus: 0 };
        this.setBanner({
          text: 'Sign in to YouTube TV in this window (normal Google sign-in). When you can see the YouTube TV home screen, press Continue. Only watching regular YouTube? Just press Continue.',
          kind: 'info',
          sticky: true,
          action: { label: 'Continue → open all four games', command: { type: 'signInDone' } },
        });
        this.showControls(true);
      } else if (this.settings.sessionMode === 'separate' && !this.settings.signInCompleted) {
        this.setBanner({ text: 'Separate sessions: sign in to YouTube TV once in each game window. The browser remembers each sign-in.', kind: 'info' });
      }
      this.applyLayout();

      const toOpen = this.signInMode ? [this.slots[0]] : this.slots;
      for (const slot of toOpen) if (!slot.hwnd) await this.openSlot(slot, this.launchUrlFor(slot.id));
      if (this.calibrationHwnd) {
        win.requestClose(this.calibrationHwnd);
        this.calibrationHwnd = null;
      }
    } finally {
      this.starting = false;
    }
    this.applyLayout();
  }

  /** A browser already running with our profile (e.g. after the viewer itself crashed): reuse its windows. */
  private adoptExistingWindows(): number {
    let adopted = 0;
    const claimed = new Set<number>();
    for (const slot of this.slots) {
      const host = this.hostFor(slot.id);
      const hwnd = host.windows().find((h) => !claimed.has(h));
      if (hwnd) {
        claimed.add(hwnd);
        this.attachWindow(slot, hwnd);
        adopted++;
      }
    }
    if (adopted) this.log.info(`Adopted ${adopted} existing game window(s)`);
    return adopted;
  }

  /**
   * Measure the browser's app-window title bar once per browser version: a local page reports
   * its viewport size in its title, and we compare that with the window's client area.
   */
  private async calibrate(): Promise<void> {
    const host = this.hosts[0];
    const cell = gridCells(this.areaPhys, 0)[0];
    try {
      const hwnd = await host.openWindow(calibrationPageUrl());
      this.calibrationHwnd = hwnd;
      win.moveWindow(hwnd, cell);
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        await sleep(150);
        const m = win.frameMetrics(hwnd);
        const mon = win.monitorForRect(cell);
        const t = parseCalibrationTitle(win.windowTitle(hwnd));
        if (!m || !mon || !t || m.dpi !== mon.dpi) continue;
        const scale = m.dpi / 96;
        if (Math.abs(t.dpr - scale) > 0.01) continue; // page zoom != 100%: reading unusable
        if (Math.abs(t.innerWidth * scale - m.clientSize.width) > 2) continue; // title not updated after move yet
        const dip = titleDipFromCalibration(m.clientSize.height, t.innerHeight, m.dpi);
        if (dip === null) break;
        this.titleDip = dip;
        this.store.update({ calibration: { ...this.settings.calibration, [browserKey(this.browser!)]: dip } });
        this.log.info(`Calibrated title bar: ${dip} DIP at ${m.dpi} dpi`);
        return;
      }
      this.log.warn(`Calibration inconclusive; using ${this.titleDip} DIP`);
    } catch (err) {
      this.log.warn('Calibration window failed to open', err);
    }
  }

  async shutdown(): Promise<void> {
    if (this.quitting) return;
    this.quitting = true;
    this.log.info('Shutting down');
    for (const t of this.timers) clearInterval(t);
    this.unhookWinEvents?.();
    this.hotkeys.setActive(false);
    this.store.flush();
    this.overlays.hideToolbar();
    this.overlays.hideLabels();
    await Promise.all(this.hosts.map((h) => h.shutdown()));
    this.audio.dispose();
    this.devServer?.close();
    this.gapMasks.dispose();
    this.gpu.dispose();
    this.player.stop();
    this.urls.dispose();
    this.overlays.destroy();
    this.tray?.destroy();
  }

  // ---------------------------------------------------------------------------------------
  // What each game opens
  // ---------------------------------------------------------------------------------------

  private homeUrl(service: 'youtubetv' | 'youtube'): string {
    return service === 'youtube' ? YOUTUBE_HOME : this.settings.startUrl;
  }

  /** A game's saved link (YouTube videos via the clean player page), else its home page. */
  private launchUrlFor(slot: SlotId): string {
    const link = this.settings.slotLinks[slot];
    if (!link) return this.homeUrl(this.settings.defaultService);
    const r = resolveLink(link);
    if ('error' in r) return this.homeUrl(this.settings.defaultService);
    if (r.youtube && this.settings.youtubeCleanPlayer && this.player.available) return this.player.urlFor(r.youtube);
    return r.link;
  }

  private saveLink(slot: SlotId, link: string): void {
    const links = [...this.settings.slotLinks];
    links[slot] = link;
    this.store.update({ slotLinks: links });
  }

  /** YouTube watch pages are titled "<video> - YouTube"; check shortly after the title settles. */
  private maybeAutoFill(slot: Slot): void {
    if (!this.settings.youtubeAutoFill || !this.settings.youtubeCleanPlayer || !this.player.available) return;
    if (slot.watchPageOptOut || slot.opening || !/\S - YouTube$/.test(slot.title)) return;
    if (slot.fillTimer) clearTimeout(slot.fillTimer);
    slot.fillTimer = setTimeout(() => {
      slot.fillTimer = null;
      void this.fillTile(slot, true);
    }, 1200);
  }

  /**
   * Switch a tile showing a YouTube watch page to the player-only view of the same video.
   * The page address is read through UI Automation (accessibility); nothing is scripted.
   */
  private async fillTile(slot: Slot, auto: boolean): Promise<void> {
    const hwnd = slot.hwnd;
    if (!hwnd || slot.opening) return;
    const url = await this.urls.read(hwnd, auto ? 3 : 4);
    if (slot.hwnd !== hwnd || slot.opening) return; // replaced meanwhile
    const r = url ? resolveLink(url) : null;
    if (!r || 'error' in r || !r.youtube) {
      if (!auto) this.setBanner({ text: url ? 'This tile isn\u2019t showing a YouTube video.' : 'Couldn\u2019t tell which page this tile is showing.', kind: 'info' });
      return;
    }
    const keyOf = (t: YouTubeTarget | null) => (t ? (t.kind === 'video' ? t.id : t.list) : null);
    const saved = this.settings.slotLinks[slot.id] ? resolveLink(this.settings.slotLinks[slot.id]) : null;
    const savedKey = saved && !('error' in saved) ? keyOf(saved.youtube) : null;
    if (auto && slot.watchPageOptOut) return;
    if (keyOf(r.youtube) === savedKey && !slot.watchPageOptOut) {
      // The player-only view was already tried for this video and we're on its watch page:
      // the owner doesn't allow it to be embedded.
      if (!auto) this.setBanner({ text: 'This video\u2019s owner doesn\u2019t allow it to play outside YouTube, so it stays on the YouTube page.', kind: 'info' });
      return;
    }
    this.log.info(`Game ${slot.id + 1}: showing ${r.link} in the player-only view`);
    slot.watchPageOptOut = false;
    this.saveLink(slot.id, r.link);
    await this.replaceSlot(slot, this.launchUrlFor(slot.id));
  }

  // ---------------------------------------------------------------------------------------
  // Game windows
  // ---------------------------------------------------------------------------------------

  private claimedWindows(): Set<number> {
    const set = new Set<number>();
    for (const s of this.slots) if (s.hwnd) set.add(s.hwnd);
    if (this.calibrationHwnd) set.add(this.calibrationHwnd);
    return set;
  }

  private attachWindow(slot: Slot, hwnd: number): void {
    slot.hwnd = hwnd;
    slot.phase = 'open';
    slot.title = win.windowTitle(hwnd);
    slot.expected = null;
    slot.needsPlace = true;
    win.squareCorners(hwnd);
    win.blackBorder(hwnd);
  }

  private async openSlot(slot: Slot, url: string): Promise<void> {
    if (slot.opening || !this.browser) return;
    slot.opening = true;
    slot.phase = 'starting';
    this.push();
    try {
      const hwnd = await this.hostFor(slot.id).openWindow(url, this.claimedWindows());
      this.attachWindow(slot, hwnd);
      if (!this.minimized) {
        this.placeSlot(slot);
        this.applyZOrder();
      } else {
        win.minimize(hwnd);
      }
      this.log.info(`Game ${slot.id + 1} window opened`);
    } catch (err) {
      slot.phase = 'closed';
      this.log.error(`Game ${slot.id + 1} could not be opened`, err);
      this.setBanner({ text: `Game ${slot.id + 1} could not be opened: ${(err as Error).message}`, kind: 'error', action: { label: 'Retry', command: { type: 'reopen', slot: slot.id } } });
    } finally {
      slot.opening = false;
      this.updateLabels();
      this.push();
    }
  }

  /** Replace a game's window with a fresh one at `url` (the old one closes after the new one is up). */
  private async replaceSlot(slot: Slot, url: string): Promise<void> {
    const old = slot.hwnd;
    slot.hwnd = null;
    slot.expected = null;
    const host = this.hostFor(slot.id);
    await this.openSlot(slot, url);
    if (old) {
      win.setRegion(old, null);
      await host.closeWindow(old);
    }
  }

  private placeSlot(slot: Slot): void {
    if (!slot.hwnd || this.minimized || slot.phase === 'fullscreen') return;
    const p = this.placements.get(slot.id);
    if (!p) return;
    const res = this.placer.place(slot.hwnd, p.rect);
    switch (res.status) {
      case 'placed':
        slot.expected = { outer: res.outer, region: res.region };
        slot.needsPlace = false;
        slot.placedAt = Date.now();
        break;
      case 'pending':
        slot.needsPlace = true;
        break;
      case 'hung':
        slot.needsPlace = true;
        this.setPhase(slot, 'unresponsive');
        break;
      case 'gone':
        this.onWindowsGone([slot]);
        break;
    }
  }

  private setPhase(slot: Slot, phase: SlotPhase): void {
    if (slot.phase === phase) return;
    slot.phase = phase;
    this.updateLabels();
    this.push();
  }

  /** One or more game windows disappeared. Decide between "closed by the user" and "browser crashed". */
  private onWindowsGone(gone: Slot[]): void {
    if (this.quitting) return;
    const byHost = new Map<BrowserHost, Slot[]>();
    for (const s of gone) {
      if (s.hwnd) this.placer.forget(s.hwnd);
      s.hwnd = null;
      s.expected = null;
      const h = this.hostFor(s.id);
      byHost.set(h, [...(byHost.get(h) ?? []), s]);
    }
    for (const [host, slots] of byHost) {
      const running = host.isRunning();
      const crashed = !running && host.lastExitCode !== null && host.lastExitCode !== 0;
      for (const s of slots) s.phase = crashed ? 'browser-down' : 'closed';
      if (crashed) {
        this.log.error(`${host.label}: browser exited unexpectedly (code 0x${(host.lastExitCode! >>> 0).toString(16)})`);
        this.onBrowserCrashed(host);
      } else {
        this.log.info(`Game window(s) closed: ${slots.map((s) => s.id + 1).join(', ')}`);
      }
    }
    if (this.slots.every((s) => !s.hwnd && !s.opening) && !this.slots.some((s) => s.phase === 'browser-down')) {
      this.setBanner({ text: 'All games are closed.', kind: 'info', sticky: true, action: { label: 'Reopen all games', command: { type: 'reloadAll' } } });
      this.showControls(true);
    }
    this.updateLabels();
    this.push();
  }

  private onBrowserCrashed(host: BrowserHost): void {
    const now = Date.now();
    this.restartLog = this.restartLog.filter((t) => now - t < 5 * 60_000);
    const slots = this.slots.filter((s) => this.hostFor(s.id) === host);
    if (this.settings.autoRestartBrowser && this.restartLog.length < 3) {
      this.restartLog.push(now);
      this.setBanner({ text: `${host.browser.name} stopped unexpectedly — restarting the affected game(s)…`, kind: 'warn' });
      setTimeout(() => {
        for (const s of slots) if (!s.hwnd) void this.openSlot(s, this.launchUrlFor(s.id));
      }, 1500);
    } else {
      this.setBanner({
        text: `${host.browser.name} stopped unexpectedly. Other games are unaffected.`,
        kind: 'error',
        sticky: true,
        action: { label: 'Restart games', command: { type: 'reloadAll' } },
      });
      this.showControls(true);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------------------

  private toDisplayInfo(d: Display, i: number): DisplayInfo {
    return { id: d.id, label: d.label || `Display ${i + 1}`, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id };
  }

  private computeArea(): void {
    const displays = screen.getAllDisplays().map((d, i) => this.toDisplayInfo(d, i));
    this.display = pickDisplay(displays, this.settings.display);
    const fs_ = this.settings.fullscreen;
    this.areaDip = fs_ ? { ...this.display.bounds } : { ...this.display.workArea };
    // Use the monitor's exact physical rectangles from Win32 (no DIP rounding).
    const approx = screen.dipToScreenRect(null, this.display.bounds);
    const mon = win.monitorForRect(approx);
    this.areaPhys = mon ? (fs_ ? mon.bounds : mon.work) : screen.dipToScreenRect(null, this.areaDip);
  }

  private applyLayout(): void {
    this.computeArea();
    this.overlays.setArea(this.areaDip);
    const gapPx = Math.round(this.settings.gap * this.display.scaleFactor);
    this.placements = new Map(computeLayout(this.areaPhys, this.layout, gapPx).map((p) => [p.slot, p]));
    for (const slot of this.slots) {
      slot.needsPlace = true;
      this.placeSlot(slot);
    }
    const masks = this.minimized ? [] : gapMasks([...this.placements.values()], gapPx);
    this.maskWindows = this.gapMasks.place(masks).map((hwnd, i) => ({ hwnd, rect: masks[i] }));
    this.applyZOrder();
    this.updateLabels();
    this.push();
  }

  private isVisible(slot: SlotId): boolean {
    return this.placements.get(slot)?.visible ?? false;
  }

  /**
   * Desired stack, top to bottom: overlays, the "top" game (solo game, else the foreground
   * game), the other visible games, games hidden behind a solo game, then the backdrop.
   *
   * Windows only lets a process bring another app's window to the very top when it has
   * foreground rights, but inserting a window *directly behind* a given window always works.
   * So we try to raise the top game (succeeds for toolbar/hotkey/tray actions) and then chain
   * every other window behind it, which keeps the group together either way.
   * In full-screen mode the group is topmost (above the taskbar) while the viewer is active.
   */
  private applyZOrder(): void {
    const topmost = this.settings.fullscreen && this.active && !this.minimized;
    const fg = win.foregroundWindow();
    // Order policy lives in core/stacking.ts (solo on top, rows top-down, masks over gaps).
    const games = this.slots.filter((s) => s.hwnd && !win.isHung(s.hwnd) && this.placements.has(s.id));
    const order = stackingOrder({
      games: games.map((s) => ({ slot: s.id, rect: this.placements.get(s.id)!.rect, visible: this.isVisible(s.id) })),
      // A game the page itself made fullscreen (player button) must stay above everything.
      soloFocus: this.slots.find((s) => s.phase === 'fullscreen' && s.hwnd)?.id ?? (this.layout.mode === 'solo' ? this.layout.focus : null),
      masks: this.maskWindows.map((m) => m.rect),
    });
    const hwndOf = (i: StackItem) => (i.kind === 'game' ? this.slots[i.slot].hwnd! : this.maskWindows[i.index].hwnd);
    const stack = [...order.map(hwndOf), this.overlays.backdropHwnd()]; // top -> bottom
    for (const h of stack) if (win.isTopmost(h) !== topmost) win.setTopmost(h, topmost);
    // Only pull the group in front of other apps while the user is working with the viewer;
    // this succeeds when we hold foreground rights (toolbar, hotkey, tray), otherwise the
    // chain below still keeps the group correctly ordered beneath the top window.
    if ((this.active || this.starting) && stack[0] !== fg) win.setZOrder(stack[0], topmost ? C.HWND_TOPMOST : C.HWND_TOP);
    for (let i = 1; i < stack.length; i++) win.setZOrder(stack[i], stack[i - 1]);
    this.overlays.raiseOverlays();
  }

  private setLayout(next: LayoutState): void {
    if (this.layoutOverride) this.layoutOverride = next;
    else this.store.update({ layout: next });
    this.applyLayout();
  }

  private minimizeAll(): void {
    if (this.minimized) return;
    this.log.info('Minimizing all games');
    this.minimized = true;
    this.transitionUntil = Date.now() + 1500;
    for (const s of this.slots) if (s.hwnd) win.minimize(s.hwnd);
    this.overlays.hideToolbar();
    this.overlays.hideLabels();
    this.gapMasks.hideAll();
    this.overlays.hideBackdrop();
    this.push();
  }

  private restoreAll(): void {
    if (!this.minimized) return;
    this.log.info('Restoring all games');
    this.minimized = false;
    this.transitionUntil = Date.now() + 1500;
    this.overlays.showBackdrop();
    for (const s of this.slots) if (s.hwnd && win.isMinimized(s.hwnd)) win.restoreNoActivate(s.hwnd);
    setTimeout(() => this.applyLayout(), 250); // also re-stacks: showing the backdrop may put it above the games
    this.push();
  }

  private onDisplaysChanged(): void {
    if (this.displayTimer) clearTimeout(this.displayTimer);
    this.displayTimer = setTimeout(() => {
      this.log.info('Display configuration changed; re-laying out');
      this.applyLayout();
    }, 600);
  }

  // ---------------------------------------------------------------------------------------
  // Periodic work
  // ---------------------------------------------------------------------------------------

  private startTimers(): void {
    const every = (ms: number, fn: () => void) => {
      const t = setInterval(() => {
        try {
          fn();
        } catch (err) {
          this.log.error(`Timer task failed`, err);
        }
      }, ms);
      this.timers.push(t);
    };
    every(400, () => this.watchdog());
    every(150, () => this.trackForeground());
    every(80, () => this.trackCursor());
    every(1500, () => this.syncProcessesAndAudio());
    every(2000, () => this.sampleStats());
    every(4000, () => this.checkNetwork());
  }

  /** Keep every game window alive, placed and clipped; notice closes, hangs, fullscreen and minimize. */
  private watchdog(): void {
    if (this.quitting) return;
    const gone: Slot[] = [];
    let restack = false;
    for (const slot of this.slots) {
      const h = slot.hwnd;
      if (!h) continue;
      if (!win.isAlive(h)) {
        gone.push(slot);
        continue;
      }
      const title = win.windowTitle(h);
      if (title !== slot.title) {
        slot.title = title;
        this.maybeAutoFill(slot);
        this.push();
      }
      if (win.isHung(h)) {
        this.setPhase(slot, 'unresponsive');
        continue;
      }
      // Minimize/restore apply asynchronously; during a transition, finish it instead of
      // reading a window that hasn't caught up yet as a new user action.
      const inTransition = Date.now() < this.transitionUntil;
      if (win.isMinimized(h)) {
        if (!this.minimized && inTransition) win.restoreNoActivate(h);
        else if (!this.minimized && !slot.opening) this.minimizeAll(); // user minimized a game: minimize the set
        continue;
      }
      if (this.minimized) {
        if (inTransition) win.minimize(h);
        else this.restoreAll(); // user restored a game from the taskbar: bring everything back
        if (!inTransition) return;
        continue;
      }
      if (this.placer.isNativeFullscreen(h)) {
        if (slot.phase !== 'fullscreen') {
          this.placer.releaseForFullscreen(h);
          this.setPhase(slot, 'fullscreen');
          this.overlays.hideToolbar();
        }
        continue;
      }
      const phase: SlotPhase = looksLikeSignIn(title) ? 'signin' : 'open';
      if (slot.phase === 'fullscreen' || slot.phase === 'unresponsive' || slot.phase !== phase) {
        if (slot.phase === 'fullscreen') {
          // Back from the page's own fullscreen: re-place and re-stack (it is on top now).
          slot.needsPlace = true;
          restack = true;
        }
        this.setPhase(slot, phase);
      }
      if (slot.needsPlace) this.placeSlot(slot);
      else if (this.settings.lockLayout && slot.expected && Date.now() - slot.placedAt > 800 && !this.placer.matches(h, slot.expected.outer, slot.expected.region)) {
        this.log.debug(`Re-snapping game ${slot.id + 1}`);
        this.placeSlot(slot);
      }
    }
    if (restack) this.applyZOrder();
    if (gone.length) this.onWindowsGone(gone);
  }

  private trackForeground(): void {
    if (this.quitting) return;
    const fg = win.foregroundWindow();
    const slot = this.slots.find((s) => s.hwnd === fg) ?? null;
    // Re-evaluated every tick, not only when the foreground window changes: a game window can
    // be focused before it has been attached to its slot (e.g. while the games are opening).
    const ours = !!slot || this.overlays.ownHwnds().has(fg) || this.gapMasks.owns(fg) || (fg !== 0 && this.browserPids.has(win.windowPid(fg)));
    this.setActive(ours);
    if (fg === this.lastFg) return;
    this.lastFg = fg;
    // Activating a game puts it on top of the stack; re-stack so its hidden title bar goes
    // back under the game above it.
    if (slot) this.applyZOrder();
    if (slot && slot.id !== this.lastFgSlot) {
      this.lastFgSlot = slot.id;
      this.onGameFocused(slot);
    }
  }

  private onGameFocused(slot: Slot): void {
    const a = this.settings.audio;
    const next = onGameFocused(a, slot.id);
    if (next !== a && this.settings.sessionMode === 'separate') this.setAudio(next);
    // Alt-Tab to a game hidden behind a solo game: make it the solo game.
    if (this.layout.mode === 'solo' && this.layout.focus !== slot.id) this.setLayout({ ...this.layout, focus: slot.id });
  }

  private setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.hotkeys.setActive(active && this.settings.hotkeys);
    if (active) {
      this.applyZOrder();
      if (this.toolbarPinned || !this.settings.toolbarAutoHide || this.banner?.sticky) this.showControls();
    } else {
      this.overlays.hideToolbar();
      if (this.settings.fullscreen) this.applyZOrder(); // drop "topmost" so the other app is visible
    }
    this.updateLabels();
  }

  /** Reveal the toolbar when the pointer touches the top edge of the layout area. */
  private trackCursor(): void {
    if (!this.active || this.minimized || this.quitting) return;
    const p = screen.getCursorScreenPoint();
    const a = this.areaDip;
    if (!this.overlays.toolbarVisible()) {
      if (p.y <= a.y + 2 && p.x >= a.x && p.x < a.x + a.width && !this.slots.some((s) => s.phase === 'fullscreen')) this.showControls();
      return;
    }
    if (this.toolbarPinned || !this.settings.toolbarAutoHide || this.banner?.sticky || this.swapFrom !== null) {
      this.toolbarHideAt = null;
      return;
    }
    const b = this.overlays.toolbarBounds();
    const m = 24;
    const inside = p.x >= b.x - m && p.x < b.x + b.width + m && p.y >= b.y - m && p.y < b.y + b.height + m;
    if (inside) this.toolbarHideAt = null;
    else if (this.toolbarHideAt === null) this.toolbarHideAt = Date.now() + 900;
    else if (Date.now() >= this.toolbarHideAt) {
      this.toolbarHideAt = null;
      this.overlays.hideToolbar();
    }
  }

  private showControls(pin = false): void {
    if (pin) this.toolbarPinned = true;
    this.toolbarHideAt = null;
    this.overlays.showToolbar();
  }

  /** Map browser processes to games and apply mute states through the Windows mixer. */
  private syncProcessesAndAudio(): void {
    if (!this.hosts.length || this.quitting) return;
    const procs = snapshotProcesses();
    const pidToSlot = new Map<number, SlotId | 'all'>();
    const browserPids = new Set<number>();
    this.hosts.forEach((host, i) => {
      const { browserPid, tree } = host.processes(procs);
      if (browserPid !== null) browserPids.add(browserPid);
      for (const p of tree) pidToSlot.set(p.pid, this.settings.sessionMode === 'shared' ? 'all' : (i as SlotId));
    });
    this.browserPids = browserPids;
    const a = this.settings.audio;
    this.audio.apply((pid) => {
      const s = pidToSlot.get(pid);
      if (s === undefined) return undefined; // not ours: never touched
      return s === 'all' ? a.masterMuted : effectiveMuted(a, s);
    }, this.forceAudio);
    this.forceAudio = false;
    this.lastProcs = procs;
  }

  private sampleStats(): void {
    if (!this.statsVisible || !this.hosts.length) return;
    const cores = os.cpus().length || 1;
    let cpu = 0;
    let mem = 0;
    const perGame: StatsView['perGame'] = this.settings.sessionMode === 'separate' ? [] : null;
    const counted = new Set<number>();
    const gpuPids = new Set<number>();
    this.hosts.forEach((host, i) => {
      let hostCpu = 0;
      let hostMem = 0;
      for (const p of host.processes(this.lastProcs).tree) {
        if (counted.has(p.pid)) continue;
        counted.add(p.pid);
        if (p.type === 'gpu-process') gpuPids.add(p.pid);
        hostCpu += sampleCpuPercent(p.pid);
        hostMem += privateBytes(p.pid);
      }
      cpu += hostCpu;
      mem += hostMem;
      perGame?.push({ number: i + 1, cpuPercent: hostCpu / cores, memoryMB: hostMem / 1048576 });
    });
    // GPU engines are attributed to the browser's GPU process(es).
    let decode: number | null = null;
    let threeD: number | null = null;
    if (this.gpu.available) {
      decode = 0;
      threeD = 0;
      for (const u of this.gpu.sample(gpuPids).values()) {
        decode += u.byType.get('videodecode') ?? 0;
        threeD += u.byType.get('3d') ?? 0;
      }
      decode = Math.min(100, decode);
      threeD = Math.min(100, threeD);
    }
    const warnings: string[] = [];
    const total = cpu / cores;
    if (gpuPids.size === 0 && counted.size > 0) warnings.push('The viewer browser has no GPU process: hardware acceleration may be unavailable, so video is rendered on the CPU.');
    if (threeD !== null && threeD > 90) warnings.push('The GPU is nearly saturated; games may drop frames.');
    if (total > 85) warnings.push('CPU is nearly saturated; games may stutter. Close other apps, or check that hardware acceleration is on.');
    if (this.hardwareAccelerationDisabled()) warnings.push('Hardware acceleration is turned off in the viewer browser (Settings → System). Turn it on for smooth playback.');
    this.stats = { cpuPercent: total, memoryMB: mem / 1048576, processes: counted.size, gpuVideoDecodePercent: decode, gpu3dPercent: threeD, perGame, warnings };
    this.push();
  }

  /** Reads the browser's own "Use graphics acceleration" preference from its profile. */
  private hardwareAccelerationDisabled(): boolean {
    try {
      const localState = JSON.parse(fs.readFileSync(path.join(this.hosts[0].userDataDir, 'Local State'), 'utf8'));
      return localState?.hardware_acceleration_mode?.enabled === false;
    } catch {
      return false;
    }
  }

  private checkNetwork(): void {
    const online = net.isOnline();
    if (online === this.online) return;
    this.online = online;
    this.log.warn(`Network ${online ? 'restored' : 'lost'}`);
    if (!online) this.setBanner({ text: 'Network connection lost. YouTube TV will try to resume on its own when it returns.', kind: 'warn', sticky: true });
    else this.setBanner({ text: 'Network connection restored. Reload any game that does not resume.', kind: 'info', action: { label: 'Reload all games', command: { type: 'reloadAll' } } });
  }

  // ---------------------------------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------------------------------

  private setAudio(next: typeof this.settings.audio): void {
    this.store.update({ audio: next });
    this.forceAudio = true;
    this.syncProcessesAndAudio();
    this.updateLabels();
    this.push();
  }

  // ---------------------------------------------------------------------------------------
  // Commands (toolbar, tray, hotkeys)
  // ---------------------------------------------------------------------------------------

  private runHotkey(h: Hotkey): void {
    if (h.command === 'cycleAudio') return this.setAudio(cycleAudio(this.settings.audio));
    if (h.command === 'toggleToolbar') {
      if (this.overlays.toolbarVisible()) {
        this.toolbarPinned = false;
        this.overlays.hideToolbar();
      } else this.showControls(true);
      return;
    }
    if (h.command === 'fillFocused') {
      const s = this.slots.find((x) => x.hwnd === win.foregroundWindow());
      if (s) void this.fillTile(s, false);
      return;
    }
    if (h.command === 'toggleLabels') return this.command({ type: 'updateSettings', patch: { showLabels: !this.settings.showLabels } });
    if (h.command.type === 'setMode' && h.command.mode === 'spotlight') {
      const fgSlot = this.slots.find((s) => s.hwnd === win.foregroundWindow());
      return this.command({ type: 'spotlight', slot: fgSlot?.id ?? this.layout.focus });
    }
    this.command(h.command);
  }

  command(cmd: UiCommand): void {
    try {
      this.handle(cmd);
    } catch (err) {
      this.log.error(`Command ${cmd.type} failed`, err);
    }
  }

  private handle(cmd: UiCommand): void {
    const slotOf = (id: SlotId) => this.slots[id];
    switch (cmd.type) {
      case 'setMode':
        if (cmd.mode !== 'solo') this.soloReturnMode = cmd.mode;
        return this.setLayout(setMode(this.layout, cmd.mode));
      case 'spotlight':
        this.soloReturnMode = 'spotlight';
        return this.setLayout(spotlight(this.layout, cmd.slot));
      case 'toggleSolo':
        if (this.layout.mode !== 'solo') this.soloReturnMode = this.layout.mode;
        return this.setLayout(toggleSolo(this.layout, cmd.slot, this.soloReturnMode));
      case 'beginSwap':
        this.swapFrom = cmd.slot;
        return this.push();
      case 'cancelSwap':
        this.swapFrom = null;
        return this.push();
      case 'swap':
        this.swapFrom = null;
        return this.setLayout(swapSlots(this.layout, cmd.a, cmd.b));
      case 'toggleMute':
        return this.setAudio(toggleMute(this.settings.audio, cmd.slot));
      case 'audioOnly':
        return this.setAudio({ ...audioOnly(this.settings.audio, cmd.slot), masterMuted: false });
      case 'toggleMasterMute':
        return this.setAudio(toggleMaster(this.settings.audio));
      case 'activate': {
        const h = slotOf(cmd.slot).hwnd;
        if (h) win.focusWindow(h);
        return;
      }
      case 'reload': {
        const h = slotOf(cmd.slot).hwnd;
        if (!h) return void this.openSlot(slotOf(cmd.slot), this.launchUrlFor(cmd.slot));
        // Reload exactly like the user pressing F5 in that game.
        win.focusWindow(h);
        setTimeout(() => win.foregroundWindow() === h && win.tapKey(C.VK_F5), 150);
        return;
      }
      case 'guide':
        this.saveLink(cmd.slot, '');
        return void this.replaceSlot(slotOf(cmd.slot), this.settings.guideUrl);
      case 'fillTile':
        return void this.fillTile(slotOf(cmd.slot), false);
      case 'openLink': {
        slotOf(cmd.slot).watchPageOptOut = false;
        const r = resolveLink(cmd.link);
        if ('error' in r) return this.setBanner({ text: r.error, kind: 'warn' });
        this.saveLink(cmd.slot, r.link);
        return void this.replaceSlot(slotOf(cmd.slot), this.launchUrlFor(cmd.slot));
      }
      case 'openHome':
        slotOf(cmd.slot).watchPageOptOut = false;
        // Remember the choice, unless it is simply the default service's home page.
        this.saveLink(cmd.slot, cmd.service === this.settings.defaultService ? '' : this.homeUrl(cmd.service));
        return void this.replaceSlot(slotOf(cmd.slot), this.homeUrl(cmd.service));
      case 'openWatchPage': {
        // The owner may block embedding, or the user wants comments/chat: full YouTube page.
        const link = this.settings.slotLinks[cmd.slot];
        if (!link) return;
        return void this.replaceSlot(slotOf(cmd.slot), link).then(() => (slotOf(cmd.slot).watchPageOptOut = true));
      }
      case 'reopen':
        return void this.replaceSlot(slotOf(cmd.slot), this.launchUrlFor(cmd.slot));
      case 'reloadAll':
        this.clearBanner();
        this.toolbarPinned = false;
        return void this.reloadAll();
      case 'setDisplay': {
        const d = screen.getAllDisplays().find((x) => x.id === cmd.id);
        if (!d) return;
        this.store.update({ display: { id: d.id, bounds: d.bounds } });
        return this.applyLayout();
      }
      case 'toggleFullscreen':
        this.store.update({ fullscreen: !this.settings.fullscreen });
        return this.applyLayout();
      case 'minimize':
        return this.minimizeAll();
      case 'resnap':
        this.restoreAll();
        for (const s of this.slots) if (s.hwnd && s.phase === 'fullscreen') s.phase = 'open';
        return this.applyLayout();
      case 'updateSettings':
        return this.updateSettings(cmd.patch);
      case 'rename': {
        const names = [...this.settings.slotNames];
        names[cmd.slot] = cmd.name;
        this.store.update({ slotNames: names });
        return this.push();
      }
      case 'toolbarPinned':
        this.toolbarPinned = cmd.pinned;
        return;
      case 'toolbarSize':
        return this.overlays.setToolbarSize(cmd.width, cmd.height);
      case 'statsVisible':
        this.statsVisible = cmd.visible;
        if (cmd.visible) this.sampleStats();
        return;
      case 'signInDone':
        return void this.finishSignIn();
      case 'openLogs':
        return void shell.openPath(this.paths.logDir);
      case 'resetSettings': {
        const keep = this.settings;
        this.store.replace({ ...defaultSettings(), calibration: keep.calibration, signInCompleted: keep.signInCompleted, sessionMode: keep.sessionMode, browser: keep.browser, browserPath: keep.browserPath });
        this.forceAudio = true;
        return this.applyLayout();
      }
      case 'restartBrowser':
        return void this.restartBrowsers();
      case 'quit':
        return void this.shutdown().then(() => app.quit());
    }
  }

  private updateSettings(patch: Partial<typeof this.settings>): void {
    const before = this.settings;
    const after = this.store.update(patch);
    if (after.hotkeys !== before.hotkeys) this.hotkeys.setActive(this.active && after.hotkeys);
    if (after.sessionMode !== before.sessionMode || after.browser !== before.browser || after.browserPath !== before.browserPath) {
      void this.restartBrowsers(true);
      return;
    }
    if (after.gap !== before.gap || after.fullscreen !== before.fullscreen || after.titleCropAdjust !== before.titleCropAdjust) this.applyLayout();
    if (after.audio !== before.audio) this.forceAudio = true;
    if (after.toolbarAutoHide && !before.toolbarAutoHide) this.toolbarPinned = false;
    this.updateLabels();
    this.push();
  }

  private async finishSignIn(): Promise<void> {
    this.signInMode = false;
    this.layoutOverride = null;
    this.toolbarPinned = false;
    this.clearBanner();
    this.store.update({ signInCompleted: true });
    this.applyLayout();
    for (const s of this.slots) if (!s.hwnd) await this.openSlot(s, this.launchUrlFor(s.id));
    this.applyLayout();
  }

  private async reloadAll(): Promise<void> {
    for (const s of this.slots) {
      if (!s.hwnd) await this.openSlot(s, this.launchUrlFor(s.id));
      else {
        this.handle({ type: 'reload', slot: s.id });
        await sleep(400);
      }
    }
  }

  /** Close every browser and start again (after changing browser or session mode). */
  private async restartBrowsers(rebuild = false): Promise<void> {
    this.setBanner({ text: 'Restarting the browser…', kind: 'info' });
    this.starting = true;
    for (const s of this.slots) {
      s.hwnd = null;
      s.expected = null;
      s.phase = 'starting';
    }
    this.push();
    await Promise.all(this.hosts.map((h) => h.shutdown()));
    if (rebuild) {
      this.browser = locateBrowser(this.settings.browser, this.settings.browserPath, process.env, { exists: (p) => fs.existsSync(p), readdir: (p) => fs.readdirSync(p) });
      if (!this.browser) {
        this.setBanner({ text: 'The selected browser was not found.', kind: 'error', sticky: true });
        this.starting = false;
        return;
      }
      this.titleDip = this.settings.calibration[browserKey(this.browser)] ?? DEFAULT_TITLE_DIP;
      this.buildHosts();
    }
    this.clearBanner();
    await this.startGames();
  }

  // ---------------------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------------------

  private setBanner(b: Banner): void {
    this.banner = b;
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = null;
    if (!b.sticky) this.bannerTimer = setTimeout(() => this.clearBanner(), 10_000);
    if (this.active || b.kind !== 'info') this.showControls();
    this.push();
  }

  private clearBanner(): void {
    this.banner = null;
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = null;
    this.push();
  }

  private slotView(slot: Slot): SlotView {
    const p = this.placements.get(slot.id);
    const rect = p ? physicalToLocalDip(p.rect, this.areaPhys, this.display.scaleFactor) : null;
    return {
      id: slot.id,
      number: slot.id + 1,
      name: this.settings.slotNames[slot.id],
      link: this.settings.slotLinks[slot.id],
      title: slot.phase === 'starting' ? '' : cleanTitle(slot.title),
      phase: slot.phase,
      muted: this.settings.sessionMode === 'shared' ? this.settings.audio.masterMuted : effectiveMuted(this.settings.audio, slot.id),
      position: this.layout.order.indexOf(slot.id),
      rect,
      visible: p?.visible ?? false,
    };
  }

  private updateLabels(): void {
    for (const slot of this.slots) {
      const p = this.placements.get(slot.id);
      const attention = slot.phase === 'signin' || slot.phase === 'unresponsive';
      const show = this.active && !this.minimized && !!p?.visible && !!slot.hwnd && slot.phase !== 'fullscreen' && (this.settings.showLabels || attention);
      if (!show || !p) {
        this.overlays.placeLabel(slot.id, null);
        continue;
      }
      const r = physicalToLocalDip(p.rect, this.areaPhys, this.display.scaleFactor);
      this.overlays.placeLabel(slot.id, { x: this.areaDip.x + r.x + 8, y: this.areaDip.y + r.y + 8 });
    }
  }

  private push(): void {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      if (!this.quitting) this.overlays.send(this.buildState());
    }, 16);
  }

  private buildState(): UiState {
    const s = this.settings;
    return {
      layout: this.layout,
      fullscreen: s.fullscreen,
      swapFrom: this.swapFrom,
      slots: this.slots.map((sl) => this.slotView(sl)),
      displays: describeDisplays(
        screen.getAllDisplays().map((d, i) => this.toDisplayInfo(d, i)),
        (d) => win.monitorForRect(screen.dipToScreenRect(null, d.bounds))?.bounds ?? null,
      ),
      displayId: this.display.id,
      settings: s,
      browser: this.browser ? { name: this.browser.name, version: this.browser.version, path: this.browser.exe } : null,
      audioScope: s.sessionMode === 'separate' ? 'per-game' : 'master',
      masterMuted: s.audio.masterMuted,
      online: this.online,
      banner: this.banner ? { text: this.banner.text, kind: this.banner.kind, action: this.banner.action } : null,
      stats: this.statsVisible ? this.stats : null,
      hotkeys: hotkeyViews(),
      areaDip: this.areaDip,
      signInMode: this.signInMode,
    };
  }

  /** Second launch of the app: bring the viewer back instead of starting another copy. */
  onSecondInstance(): void {
    this.restoreAll();
    this.showControls();
    this.applyLayout();
  }
}
