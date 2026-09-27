// Pure layout geometry. All rectangles here are in one coordinate space (the caller uses
// physical screen pixels for window placement and converts to DIPs only for Electron UI).
import type { Insets, LayoutState, Rect, SlotId } from '../shared/types';

export const SLOT_IDS: readonly SlotId[] = [0, 1, 2, 3];

export interface Placement {
  slot: SlotId;
  rect: Rect;
  /** false when the slot is kept playing but hidden behind another (solo mode). */
  visible: boolean;
  /** Stacking order hint: higher is closer to the viewer. */
  z: number;
}

export function makeRect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}

export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function rectsEqual(a: Rect | null | undefined, b: Rect | null | undefined, tolerance = 0): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

/**
 * Split [start, start+length) into weighted integer segments separated by `gap`.
 * Segments tile the span exactly: no overlap, no leftover pixels, rounding spread evenly.
 */
export function splitSpan(start: number, length: number, weights: readonly number[], gap: number): { start: number; length: number }[] {
  const count = weights.length;
  if (count === 0) return [];
  let g = Math.max(0, Math.floor(gap));
  if (length - g * (count - 1) < count) g = 0; // not enough room for the gaps
  const usable = length - g * (count - 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: { start: number; length: number }[] = [];
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const from = Math.round((acc / total) * usable);
    acc += weights[i];
    const to = i === count - 1 ? usable : Math.round((acc / total) * usable);
    out.push({ start: start + from + i * g, length: to - from });
  }
  return out;
}

/** Rectangles for the four 2x2 grid positions (0 TL, 1 TR, 2 BL, 3 BR). */
export function gridCells(area: Rect, gap: number): Rect[] {
  const cols = splitSpan(area.x, area.width, [1, 1], gap);
  const rows = splitSpan(area.y, area.height, [1, 1], gap);
  const cells: Rect[] = [];
  for (let p = 0; p < 4; p++) {
    const c = cols[p % 2];
    const r = rows[Math.floor(p / 2)];
    cells.push(makeRect(c.start, r.start, c.length, r.length));
  }
  return cells;
}

export function computeLayout(area: Rect, state: LayoutState, gap: number): Placement[] {
  const cells = gridCells(area, gap);
  switch (state.mode) {
    case 'grid':
      return state.order.map((slot, pos) => ({ slot, rect: cells[pos], visible: true, z: 1 }));
    case 'solo':
      // The focused game fills the area; the others stay at their grid cells underneath so
      // they keep playing and can be brought back instantly.
      return state.order.map((slot, pos) =>
        slot === state.focus
          ? { slot, rect: { ...area }, visible: true, z: 2 }
          : { slot, rect: cells[pos], visible: false, z: 1 },
      );
    case 'spotlight': {
      const cols = splitSpan(area.x, area.width, [3, 1], gap);
      const rows = splitSpan(area.y, area.height, [1, 1, 1], gap);
      const main = makeRect(cols[0].start, area.y, cols[0].length, area.height);
      const others = state.order.filter((s) => s !== state.focus);
      const placements: Placement[] = [{ slot: state.focus, rect: main, visible: true, z: 1 }];
      others.forEach((slot, i) => {
        placements.push({ slot, rect: makeRect(cols[1].start, rows[i].start, cols[1].length, rows[i].length), visible: true, z: 1 });
      });
      return placements;
    }
  }
}

/**
 * Strips that must be covered when there is a gap between rows. Every game window keeps its
 * title bar just above its content; stacking tucks that bar under the game above, but the
 * part inside the gap has nothing on top of it, so we cover it with a black mask.
 */
export function gapMasks(placements: readonly Placement[], gap: number): Rect[] {
  if (gap <= 0) return [];
  const visible = placements.filter((p) => p.visible);
  const masks: Rect[] = [];
  for (const p of visible) {
    const hasTileAbove = visible.some(
      (q) =>
        q !== p &&
        rectBottom(q.rect) <= p.rect.y &&
        rectBottom(q.rect) >= p.rect.y - gap - 1 &&
        q.rect.x < rectRight(p.rect) &&
        rectRight(q.rect) > p.rect.x,
    );
    if (hasTileAbove) masks.push(makeRect(p.rect.x, p.rect.y - gap, p.rect.width, gap));
  }
  return masks;
}

/** Outer window rectangle whose content area lands exactly on `target`. */
export function expandByInsets(target: Rect, insets: Insets): Rect {
  return makeRect(
    target.x - insets.left,
    target.y - insets.top,
    target.width + insets.left + insets.right,
    target.height + insets.top + insets.bottom,
  );
}

/** Region (relative to the outer window's top-left) that keeps only the content area visible. */
export function contentRegion(target: Rect, insets: Insets): Rect {
  return makeRect(insets.left, insets.top, target.width, target.height);
}

/** Convert a physical rect into DIPs relative to `origin` (the physical top-left of the area). */
export function physicalToLocalDip(r: Rect, origin: { x: number; y: number }, scale: number): Rect {
  const x = Math.round((r.x - origin.x) / scale);
  const y = Math.round((r.y - origin.y) / scale);
  return makeRect(x, y, Math.round((rectRight(r) - origin.x) / scale) - x, Math.round((rectBottom(r) - origin.y) / scale) - y);
}
