// High-level window operations on top-level windows of the viewer's browser processes.
import type { Rect } from '../../shared/types';
import type { FrameMetrics } from '../../core/frame';
import { C, W, makeEnumCallback, readWideString, unregisterCallback, type WinRect } from './native';

const CHROMIUM_WINDOW_CLASS = 'Chrome_WidgetWin_1';

function toRect(r: WinRect): Rect {
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

function toWinRect(r: Rect): WinRect {
  return { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
}

export function windowPid(hwnd: number): number {
  const pid = [0];
  W.GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
}

export function className(hwnd: number): string {
  const buf = Buffer.alloc(512);
  return readWideString(buf, W.GetClassNameW(hwnd, buf, 256));
}

export function windowTitle(hwnd: number): string {
  const buf = Buffer.alloc(1024);
  return readWideString(buf, W.GetWindowTextW(hwnd, buf, 512));
}

/**
 * Visible, captioned Chromium top-level windows owned by `pids` - i.e. browser/app windows,
 * excluding bubbles, menus and hidden helper windows.
 */
export function appWindowsOf(pids: ReadonlySet<number>): number[] {
  const found: number[] = [];
  const cb = makeEnumCallback((hwnd) => {
    if (W.IsWindowVisible(hwnd) !== 0 && pids.has(windowPid(hwnd)) && className(hwnd) === CHROMIUM_WINDOW_CLASS) {
      const style = Number(W.GetWindowLongPtrW(hwnd, C.GWL_STYLE));
      if ((style & C.WS_CAPTION) === C.WS_CAPTION) found.push(hwnd);
    }
    return true;
  });
  try {
    W.EnumWindows(cb, 0);
  } finally {
    unregisterCallback(cb);
  }
  return found;
}

export const isAlive = (hwnd: number): boolean => hwnd !== 0 && W.IsWindow(hwnd) !== 0;
export const isMinimized = (hwnd: number): boolean => W.IsIconic(hwnd) !== 0;
export const isMaximized = (hwnd: number): boolean => W.IsZoomed(hwnd) !== 0;
export const isHung = (hwnd: number): boolean => W.IsHungAppWindow(hwnd) !== 0;

export function windowRect(hwnd: number): Rect | null {
  const r = {} as WinRect;
  return W.GetWindowRect(hwnd, r) !== 0 ? toRect(r) : null;
}

export function frameMetrics(hwnd: number): FrameMetrics | null {
  const wr = {} as WinRect;
  const cr = {} as WinRect;
  const origin = { x: 0, y: 0 };
  if (!W.GetWindowRect(hwnd, wr) || !W.GetClientRect(hwnd, cr) || !W.ClientToScreen(hwnd, origin)) return null;
  if (cr.right <= 0 || cr.bottom <= 0) return null;
  return { window: toRect(wr), clientOrigin: origin, clientSize: { width: cr.right, height: cr.bottom }, dpi: W.GetDpiForWindow(hwnd) || 96 };
}

export interface MonitorInfo {
  bounds: Rect;
  work: Rect;
  dpi: number;
}

function monitorInfo(hmon: number): MonitorInfo | null {
  const info = { cbSize: 40, rcMonitor: {}, rcWork: {}, dwFlags: 0 } as unknown as { cbSize: number; rcMonitor: WinRect; rcWork: WinRect };
  if (!hmon || W.GetMonitorInfoW(hmon, info) === 0) return null;
  const dx = [0];
  const dy = [0];
  const dpi = W.GetDpiForMonitor(hmon, C.MDT_EFFECTIVE_DPI, dx, dy) === 0 ? dx[0] : 96;
  return { bounds: toRect(info.rcMonitor), work: toRect(info.rcWork), dpi };
}

export function monitorForRect(r: Rect): MonitorInfo | null {
  return monitorInfo(W.MonitorFromRect(toWinRect(r), C.MONITOR_DEFAULTTONEAREST));
}

export function monitorOfWindow(hwnd: number): MonitorInfo | null {
  return monitorInfo(W.MonitorFromWindow(hwnd, C.MONITOR_DEFAULTTONEAREST));
}

/** Move/resize without activating or changing z-order. Async so a busy browser can't block us. */
export function moveWindow(hwnd: number, r: Rect): boolean {
  const flags = C.SWP_NOZORDER | C.SWP_NOACTIVATE | C.SWP_NOOWNERZORDER | C.SWP_ASYNCWINDOWPOS;
  return W.SetWindowPos(hwnd, 0, r.x, r.y, r.width, r.height, flags) !== 0;
}

/** Clip the window to `region` (window-relative), or remove clipping with null. */
export function setRegion(hwnd: number, region: Rect | null): boolean {
  if (!region) return W.SetWindowRgn(hwnd, 0, 1) !== 0;
  const rgn = W.CreateRectRgn(region.x, region.y, region.x + region.width, region.y + region.height);
  if (!rgn) return false;
  if (W.SetWindowRgn(hwnd, rgn, 1) === 0) {
    W.DeleteObject(rgn); // on success the system owns the region
    return false;
  }
  return true;
}

/** Current clip region bounds, or null when the window has no region. */
export function regionBox(hwnd: number): Rect | null {
  const r = {} as WinRect;
  const kind = W.GetWindowRgnBox(hwnd, r);
  return kind === C.ERROR_REGION || kind === C.NULLREGION ? null : toRect(r);
}

/**
 * Put `hwnd` directly *below* `after` in z-order (Win32 semantics), or use HWND_TOP/HWND_TOPMOST.
 * Use `async` for another process's window: the request is queued to that window's thread
 * instead of waiting for it, so a busy browser can't stall the caller.
 */
export function setZOrder(hwnd: number, after: number, async = false): boolean {
  const flags = C.SWP_NOMOVE | C.SWP_NOSIZE | C.SWP_NOACTIVATE | C.SWP_NOOWNERZORDER | (async ? C.SWP_ASYNCWINDOWPOS : 0);
  return W.SetWindowPos(hwnd, after, 0, 0, 0, 0, flags) !== 0;
}

export function setTopmost(hwnd: number, topmost: boolean, async = false): boolean {
  return setZOrder(hwnd, topmost ? C.HWND_TOPMOST : C.HWND_NOTOPMOST, async);
}

export function isTopmost(hwnd: number): boolean {
  return (Number(W.GetWindowLongPtrW(hwnd, C.GWL_EXSTYLE)) & C.WS_EX_TOPMOST) !== 0;
}

export const minimize = (hwnd: number): boolean => W.ShowWindowAsync(hwnd, C.SW_SHOWMINNOACTIVE) !== 0;
export const restoreNoActivate = (hwnd: number): boolean => W.ShowWindowAsync(hwnd, C.SW_SHOWNOACTIVATE) !== 0;
export const restore = (hwnd: number): boolean => W.ShowWindowAsync(hwnd, C.SW_RESTORE) !== 0;
export const requestClose = (hwnd: number): boolean => W.PostMessageW(hwnd, C.WM_CLOSE, 0, 0) !== 0;
export const foregroundWindow = (): number => W.GetForegroundWindow();
export const focusWindow = (hwnd: number): boolean => W.SetForegroundWindow(hwnd) !== 0;

/**
 * The browser paints a 1px frame edge beside its content (left/right/bottom) that no clip
 * region can hide. Windows 11 draws its own border line over it; making that line black turns
 * every seam into a thin black separator instead of a light one. Best effort (Win11 only).
 */
export function blackBorder(hwnd: number): void {
  try {
    W.DwmSetWindowAttribute(hwnd, C.DWMWA_BORDER_COLOR, [0x000000], 4);
  } catch {
    /* not supported before Windows 11 */
  }
}

/** Square corners so adjacent games meet cleanly on Windows 11 (best effort; may be refused). */
export function squareCorners(hwnd: number): void {
  try {
    W.DwmSetWindowAttribute(hwnd, C.DWMWA_WINDOW_CORNER_PREFERENCE, [C.DWMWCP_DONOTROUND], 4);
  } catch {
    /* not supported before Windows 11 */
  }
}

/** Press and release a key in the foreground window (used for F5 = reload after focusing a game). */
export function tapKey(vk: number): void {
  W.keybd_event(vk, 0, 0, 0);
  W.keybd_event(vk, 0, C.KEYEVENTF_KEYUP, 0);
}
