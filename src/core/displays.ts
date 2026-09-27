// Monitor selection and area calculation. Electron reports displays in DIPs; windows are
// placed in physical pixels, so the caller supplies each display's physical bounds.
import type { DisplayView, Rect } from '../shared/types';
import { rectsEqual } from './geometry';

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: Rect; // DIP
  workArea: Rect; // DIP
  scaleFactor: number;
  primary: boolean;
}

export interface DisplayPreference {
  id: number | null;
  bounds: Rect | null;
}

/**
 * Pick the monitor for the layout: the saved id, else a monitor at the saved position
 * (ids can change across reboots/driver updates), else the primary monitor.
 */
export function pickDisplay(displays: readonly DisplayInfo[], pref: DisplayPreference): DisplayInfo {
  if (displays.length === 0) throw new Error('No displays available');
  if (pref.id !== null) {
    const byId = displays.find((d) => d.id === pref.id);
    if (byId) return byId;
  }
  if (pref.bounds) {
    const byBounds = displays.find((d) => rectsEqual(d.bounds, pref.bounds));
    if (byBounds) return byBounds;
  }
  return displays.find((d) => d.primary) ?? displays[0];
}

/**
 * Physical rectangle for the layout on `display`.
 * @param physicalBounds physical pixel bounds of the whole display
 * @param fullscreen use the whole display (covering the taskbar) instead of the work area
 */
export function physicalArea(display: DisplayInfo, physicalBounds: Rect, fullscreen: boolean): Rect {
  if (fullscreen) return { ...physicalBounds };
  const s = display.scaleFactor;
  const left = physicalBounds.x + Math.round((display.workArea.x - display.bounds.x) * s);
  const top = physicalBounds.y + Math.round((display.workArea.y - display.bounds.y) * s);
  const right = physicalBounds.x + Math.round((display.workArea.x + display.workArea.width - display.bounds.x) * s);
  const bottom = physicalBounds.y + Math.round((display.workArea.y + display.workArea.height - display.bounds.y) * s);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** @param physicalSize exact pixel size from the OS, when known (DIP x scale can be off by one). */
export function describeDisplays(displays: readonly DisplayInfo[], physicalSize?: (d: DisplayInfo) => { width: number; height: number } | null): DisplayView[] {
  return displays.map((d, i) => {
    const exact = physicalSize?.(d);
    const w = exact?.width ?? Math.round(d.bounds.width * d.scaleFactor);
    const h = exact?.height ?? Math.round(d.bounds.height * d.scaleFactor);
    return {
      id: d.id,
      label: d.label || `Display ${i + 1}`,
      primary: d.primary,
      detail: `${w}×${h} @ ${Math.round(d.scaleFactor * 100)}%${d.primary ? ' · primary' : ''}`,
    };
  });
}
