// Positions a browser app window so its *web content* exactly covers a target rectangle.
// The window is larger than the target: its title bar sits just above it (hidden off-screen or
// under the game above, see core/stacking.ts) and its invisible resize borders around it. A clip
// region limits mouse hit-testing to the target, so those borders don't grab clicks meant for
// neighbouring games. (Chrome's GPU-composited output is not clipped by the region.)
import type { Rect } from '../shared/types';
import { computeInsets, insetsValid } from '../core/frame';
import { contentRegion, expandByInsets, rectsEqual } from '../core/geometry';
import * as win from './win32/windows';

export type PlaceResult =
  | { status: 'placed'; outer: Rect; region: Rect | null }
  | { status: 'pending'; reason: string }
  | { status: 'gone' }
  | { status: 'hung' };

export interface PlacerOptions {
  titleDip: () => number;
  cropAdjust: () => number;
  onRegionRejected?: (hwnd: number) => void;
}

export class WindowPlacer {
  /**
   * Windows whose browser refuses a clip region (Chromium drops it on every change after the
   * window has been fullscreen once). The region only limits mouse hit-testing at the edges,
   * so we stop retrying instead of re-snapping in a loop.
   */
  private readonly noRegion = new Set<number>();

  constructor(private readonly opts: PlacerOptions) {}

  place(hwnd: number, target: Rect): PlaceResult {
    if (!win.isAlive(hwnd)) return { status: 'gone' };
    if (win.isHung(hwnd)) return { status: 'hung' };
    if (win.isMinimized(hwnd) || win.isMaximized(hwnd)) {
      win.restoreNoActivate(hwnd);
      return { status: 'pending', reason: 'restoring' };
    }
    const monitor = win.monitorForRect(target);
    const metrics = win.frameMetrics(hwnd);
    if (!monitor || !metrics) return { status: 'pending', reason: 'no metrics' };
    if (metrics.dpi !== monitor.dpi) {
      // Moving across monitors with different scaling: let the browser adopt the new DPI
      // first (its frame size changes), then place precisely on a later pass.
      win.setRegion(hwnd, null);
      win.moveWindow(hwnd, target);
      return { status: 'pending', reason: `dpi ${metrics.dpi}->${monitor.dpi}` };
    }
    const insets = computeInsets(metrics, this.opts.titleDip(), this.opts.cropAdjust());
    if (!insetsValid(insets)) return { status: 'pending', reason: 'implausible frame' };
    const outer = expandByInsets(target, insets);
    const region = contentRegion(target, insets);
    if (!rectsEqual(win.windowRect(hwnd), outer)) win.moveWindow(hwnd, outer);
    if (!this.noRegion.has(hwnd) && !rectsEqual(win.regionBox(hwnd), region)) {
      win.setRegion(hwnd, region);
      if (win.regionBox(hwnd) === null) {
        this.noRegion.add(hwnd);
        this.opts.onRegionRejected?.(hwnd);
      }
    }
    return { status: 'placed', outer, region: this.noRegion.has(hwnd) ? null : region };
  }

  /** True if the window still matches what we last placed (used by the watchdog). */
  matches(hwnd: number, outer: Rect, region: Rect | null): boolean {
    return rectsEqual(win.windowRect(hwnd), outer) && (region === null || rectsEqual(win.regionBox(hwnd), region));
  }

  /**
   * The page (e.g. the video player's fullscreen button) made the window cover its monitor.
   * Our placements are always larger than their target, so an exact monitor-sized window
   * can only come from the browser's own fullscreen.
   */
  isNativeFullscreen(hwnd: number): boolean {
    const r = win.windowRect(hwnd);
    const m = win.monitorOfWindow(hwnd);
    return !!r && !!m && rectsEqual(r, m.bounds);
  }

  /** Let a fullscreen page show fully (our clip region would otherwise crop it). */
  releaseForFullscreen(hwnd: number): void {
    if (win.regionBox(hwnd) !== null) win.setRegion(hwnd, null);
  }

  forget(hwnd: number): void {
    this.noRegion.delete(hwnd);
  }
}
