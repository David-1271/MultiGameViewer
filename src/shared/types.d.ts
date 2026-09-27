// Type-only declarations shared by the main process and the renderer pages.
// Kept as a .d.ts so neither build emits a runtime module for it.

export type SlotId = 0 | 1 | 2 | 3;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** grid = 2x2; spotlight = one large + three stacked; solo = one fills the area, others keep playing behind it. */
export type LayoutMode = 'grid' | 'spotlight' | 'solo';

export interface LayoutState {
  mode: LayoutMode;
  /** order[position] = slot shown at that grid position (positions: 0 TL, 1 TR, 2 BL, 3 BR). */
  order: SlotId[];
  /** Slot enlarged by spotlight/solo. */
  focus: SlotId;
}

/** shared = one browser + one sign-in; separate = one browser per game (per-game audio control, sign in once per game). */
export type SessionMode = 'shared' | 'separate';
export type BrowserChoice = 'auto' | 'chrome' | 'edge';
/** What a game opens when it has no saved link. */
export type Service = 'youtubetv' | 'youtube';


export interface Settings {
  version: 1;
  browser: BrowserChoice;
  /** Optional explicit browser executable; empty = auto-detect. */
  browserPath: string;
  sessionMode: SessionMode;
  /** YouTube TV home page. */
  startUrl: string;
  guideUrl: string;
  defaultService: Service;
  /** Per-game saved link (canonical URL) or '' for the default service's home page. */
  slotLinks: string[];
  /** Play regular YouTube videos in the player-only page instead of the full watch page. */
  youtubeCleanPlayer: boolean;
  /** When you pick a video on a YouTube page, switch the tile to the player-only view. */
  youtubeAutoFill: boolean;
  display: { id: number | null; bounds: Rect | null };
  layout: LayoutState;
  fullscreen: boolean;
  /** Gap between games in DIPs (0 = seamless). */
  gap: number;
  showLabels: boolean;
  slotNames: string[];
  /** muted[] is per game (separate mode); masterMuted silences the viewer entirely. */
  audio: { muted: boolean[]; masterMuted: boolean; exclusive: boolean; followFocus: boolean };
  toolbarAutoHide: boolean;
  hotkeys: boolean;
  /** Snap game windows back if something moves or resizes them. */
  lockLayout: boolean;
  /** Extra physical pixels cropped from the top of each game (fine-tunes title-bar hiding). */
  titleCropAdjust: number;
  autoRestartBrowser: boolean;
  signInCompleted: boolean;
  /** Measured app-window title bar height (DIP), keyed by "<browser>@<version>". */
  calibration: Record<string, number>;
}

export type SlotPhase =
  | 'starting' // window being opened
  | 'open' // window present and placed
  | 'signin' // page title suggests a Google sign-in page
  | 'closed' // user closed the window, or it vanished
  | 'fullscreen' // the page itself went fullscreen (e.g. player fullscreen button)
  | 'unresponsive' // Windows reports the window as hung
  | 'browser-down'; // the browser process for this game exited

export interface SlotView {
  id: SlotId;
  /** 1-based number shown to the user. */
  number: number;
  name: string;
  title: string;
  /** Saved link for this game ('' = default home page). */
  link: string;
  phase: SlotPhase;
  muted: boolean;
  /** Grid position this slot currently occupies (0-3). */
  position: number;
  /** Visible rectangle relative to the layout area, in DIPs (for backdrop/labels). */
  rect: Rect | null;
  /** Whether the slot is visible (false for games hidden behind a solo game). */
  visible: boolean;
}

export interface DisplayView {
  id: number;
  label: string;
  primary: boolean;
  detail: string;
}

export interface StatsView {
  cpuPercent: number;
  memoryMB: number;
  processes: number;
  gpuVideoDecodePercent: number | null;
  gpu3dPercent: number | null;
  perGame: { number: number; cpuPercent: number; memoryMB: number }[] | null;
  warnings: string[];
}

export interface HotkeyView {
  keys: string;
  action: string;
}

export interface UiState {
  layout: LayoutState;
  fullscreen: boolean;
  swapFrom: SlotId | null;
  slots: SlotView[];
  displays: DisplayView[];
  displayId: number;
  settings: Settings;
  browser: { name: string; version: string; path: string } | null;
  /** 'per-game' in separate mode, 'master' in shared mode (one audio stream for the whole browser). */
  audioScope: 'per-game' | 'master';
  masterMuted: boolean;
  online: boolean;
  banner: { text: string; kind: 'info' | 'warn' | 'error'; action?: { label: string; command: UiCommand } } | null;
  stats: StatsView | null;
  hotkeys: HotkeyView[];
  areaDip: Rect;
  signInMode: boolean;
}

export type UiCommand =
  | { type: 'setMode'; mode: LayoutMode }
  | { type: 'spotlight'; slot: SlotId }
  | { type: 'toggleSolo'; slot: SlotId }
  | { type: 'beginSwap'; slot: SlotId }
  | { type: 'swap'; a: SlotId; b: SlotId }
  | { type: 'cancelSwap' }
  | { type: 'toggleMute'; slot: SlotId }
  | { type: 'audioOnly'; slot: SlotId }
  | { type: 'toggleMasterMute' }
  | { type: 'reload'; slot: SlotId }
  | { type: 'guide'; slot: SlotId }
  | { type: 'openLink'; slot: SlotId; link: string }
  | { type: 'openHome'; slot: SlotId; service: Service }
  | { type: 'openWatchPage'; slot: SlotId }
  | { type: 'fillTile'; slot: SlotId }
  | { type: 'reopen'; slot: SlotId }
  | { type: 'reloadAll' }
  | { type: 'activate'; slot: SlotId }
  | { type: 'setDisplay'; id: number }
  | { type: 'toggleFullscreen' }
  | { type: 'minimize' }
  | { type: 'resnap' }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'rename'; slot: SlotId; name: string }
  | { type: 'toolbarPinned'; pinned: boolean }
  | { type: 'toolbarSize'; width: number; height: number }
  | { type: 'statsVisible'; visible: boolean }
  | { type: 'signInDone' }
  | { type: 'openLogs' }
  | { type: 'resetSettings' }
  | { type: 'restartBrowser' }
  | { type: 'quit' };
