// Settings schema, validation and persistence. Nothing secret is ever stored here: sign-in
// lives only inside the browser's own profile, managed by the browser itself.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BrowserChoice, Rect, SessionMode, Settings } from '../shared/types';
import { normalizeAudio, defaultAudio } from './audio';
import { defaultLayout, normalizeLayout } from './layout';

export const YOUTUBE_TV_HOME = 'https://tv.youtube.com/';
export const YOUTUBE_TV_LIVE_GUIDE = 'https://tv.youtube.com/live';

export function defaultSettings(): Settings {
  return {
    version: 1,
    browser: 'auto',
    browserPath: '',
    sessionMode: 'shared',
    startUrl: YOUTUBE_TV_HOME,
    guideUrl: YOUTUBE_TV_LIVE_GUIDE,
    display: { id: null, bounds: null },
    layout: defaultLayout(),
    fullscreen: false,
    gap: 0,
    showLabels: false,
    slotNames: ['', '', '', ''],
    audio: defaultAudio(),
    toolbarAutoHide: true,
    hotkeys: true,
    lockLayout: true,
    titleCropAdjust: 0,
    autoRestartBrowser: true,
    signInCompleted: false,
    calibration: {},
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Only plain https URLs are accepted as navigation targets. */
export function safeHttpsUrl(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : fallback;
  } catch {
    return fallback;
  }
}

function rectOrNull(v: unknown): Rect | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k] as number))
    ? { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number }
    : null;
}

/** Validate/repair an arbitrary JSON value into complete Settings. Unknown keys are dropped. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const browser: BrowserChoice = r.browser === 'chrome' || r.browser === 'edge' || r.browser === 'auto' ? r.browser : d.browser;
  const sessionMode: SessionMode = r.sessionMode === 'separate' ? 'separate' : 'shared';
  const disp = (r.display ?? {}) as Record<string, unknown>;
  const names = Array.isArray(r.slotNames) ? r.slotNames : [];
  const calibration: Record<string, number> = {};
  if (r.calibration && typeof r.calibration === 'object') {
    for (const [k, v] of Object.entries(r.calibration as Record<string, unknown>)) {
      if (typeof v === 'number' && v >= 0 && v <= 120) calibration[k] = v;
    }
  }
  return {
    version: 1,
    browser,
    browserPath: typeof r.browserPath === 'string' ? r.browserPath.trim() : '',
    sessionMode,
    startUrl: safeHttpsUrl(r.startUrl, d.startUrl),
    guideUrl: safeHttpsUrl(r.guideUrl, d.guideUrl),
    display: { id: typeof disp.id === 'number' ? disp.id : null, bounds: rectOrNull(disp.bounds) },
    layout: normalizeLayout(r.layout),
    fullscreen: bool(r.fullscreen, d.fullscreen),
    gap: clampInt(r.gap, 0, 64, d.gap),
    showLabels: bool(r.showLabels, d.showLabels),
    slotNames: [0, 1, 2, 3].map((i) => (typeof names[i] === 'string' ? (names[i] as string).slice(0, 60) : '')),
    audio: normalizeAudio(r.audio),
    toolbarAutoHide: bool(r.toolbarAutoHide, d.toolbarAutoHide),
    hotkeys: bool(r.hotkeys, d.hotkeys),
    lockLayout: bool(r.lockLayout, d.lockLayout),
    titleCropAdjust: clampInt(r.titleCropAdjust, -4, 12, d.titleCropAdjust),
    autoRestartBrowser: bool(r.autoRestartBrowser, d.autoRestartBrowser),
    signInCompleted: bool(r.signInCompleted, d.signInCompleted),
    calibration,
  };
}

/** Apply a partial update coming from the UI, re-validating the result. */
export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  return normalizeSettings({ ...current, ...patch });
}

export class SettingsStore {
  private current: Settings;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly filePath: string,
    private readonly onError: (msg: string, err: unknown) => void = () => {},
    private readonly debounceMs = 400,
  ) {
    this.current = this.load();
  }

  get(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings>): Settings {
    this.current = mergeSettings(this.current, patch);
    this.scheduleSave();
    return this.current;
  }

  replace(next: Settings): void {
    this.current = normalizeSettings(next);
    this.scheduleSave();
  }

  /** Write immediately (used on shutdown). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.write();
  }

  private load(): Settings {
    try {
      const text = fs.readFileSync(this.filePath, 'utf8');
      return normalizeSettings(JSON.parse(text));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.onError('Settings file unreadable; using defaults', err);
        this.backupCorrupt();
      }
      return defaultSettings();
    }
  }

  private backupCorrupt(): void {
    try {
      fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
    } catch {
      /* nothing to back up */
    }
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, this.debounceMs);
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.current, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath); // atomic replace: never leaves a half-written file
    } catch (err) {
      this.onError('Could not save settings', err);
    }
  }
}
