// Browser app-window frame math. Chrome/Edge app windows draw a title bar inside their client
// area, so the web content starts `titleDip` DIPs below the client top. We keep the window
// slightly larger than its quadrant and clip it with a window region so only content shows.
import type { Insets, Rect } from '../shared/types';

/** Chrome 153 / Edge 154 app-window title bar height. Re-measured at runtime by calibration. */
export const DEFAULT_TITLE_DIP = 30;

export interface FrameMetrics {
  /** GetWindowRect (includes invisible resize borders). */
  window: Rect;
  /** ClientToScreen(0,0). */
  clientOrigin: { x: number; y: number };
  /** GetClientRect size. */
  clientSize: { width: number; height: number };
  /** GetDpiForWindow. */
  dpi: number;
}

export function computeInsets(m: FrameMetrics, titleDip: number, cropAdjust = 0): Insets {
  const scale = m.dpi / 96;
  const titlePx = Math.round(titleDip * scale);
  return {
    left: m.clientOrigin.x - m.window.x,
    top: m.clientOrigin.y - m.window.y + titlePx + cropAdjust,
    right: m.window.x + m.window.width - (m.clientOrigin.x + m.clientSize.width),
    bottom: m.window.y + m.window.height - (m.clientOrigin.y + m.clientSize.height),
  };
}

export function insetsValid(i: Insets): boolean {
  return [i.left, i.top, i.right, i.bottom].every((v) => Number.isFinite(v) && v >= 0 && v < 400);
}

// ---- Calibration -----------------------------------------------------------------------
// A tiny local page reports its own viewport size through document.title, which we read
// with GetWindowText. No debugging protocol or page injection is involved.

export const CALIBRATION_TITLE_PREFIX = 'MGVCAL';

export function calibrationPageUrl(): string {
  const html =
    '<!doctype html><meta charset="utf-8"><title>MultiGame Viewer</title>' +
    '<style>html,body{margin:0;height:100%;background:#000;color:#9aa;font:16px system-ui;display:grid;place-items:center}</style>' +
    '<body>Preparing game window…<script>' +
    `const u=()=>{document.title="${CALIBRATION_TITLE_PREFIX} "+innerWidth+"x"+innerHeight+"@"+devicePixelRatio};` +
    'addEventListener("resize",u);u();</script>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

export function parseCalibrationTitle(title: string): { innerWidth: number; innerHeight: number; dpr: number } | null {
  const m = new RegExp(`^${CALIBRATION_TITLE_PREFIX} (\\d+)x(\\d+)@([\\d.]+)`).exec(title.trim());
  if (!m) return null;
  return { innerWidth: Number(m[1]), innerHeight: Number(m[2]), dpr: Number(m[3]) };
}

/** Title-bar height in DIPs from a calibration reading. Returns null if the reading is implausible. */
export function titleDipFromCalibration(clientHeightPx: number, innerHeightCss: number, dpi: number): number | null {
  const scale = dpi / 96;
  const title = Math.round(clientHeightPx / scale - innerHeightCss);
  return title >= 0 && title <= 120 ? title : null;
}
