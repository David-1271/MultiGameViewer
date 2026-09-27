// Pure layout-state transitions (what goes where), independent of any window system.
import type { LayoutMode, LayoutState, SlotId } from '../shared/types';
import { SLOT_IDS } from './geometry';

export function defaultLayout(): LayoutState {
  return { mode: 'grid', order: [0, 1, 2, 3], focus: 0 };
}

export function isSlotId(v: unknown): v is SlotId {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

/** Repair anything loaded from disk into a valid state (order must be a permutation of 0-3). */
export function normalizeLayout(raw: unknown): LayoutState {
  const d = defaultLayout();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<LayoutState>;
  const mode: LayoutMode = r.mode === 'grid' || r.mode === 'spotlight' || r.mode === 'solo' ? r.mode : d.mode;
  const order = Array.isArray(r.order) && r.order.length === 4 && SLOT_IDS.every((s) => r.order!.includes(s)) ? [...r.order] : d.order;
  const focus = isSlotId(r.focus) ? r.focus : d.focus;
  return { mode, order, focus };
}

export function setMode(state: LayoutState, mode: LayoutMode): LayoutState {
  return { ...state, mode };
}

/** Swap the grid positions of two games. Audio/mute state follows the game, not the position. */
export function swapSlots(state: LayoutState, a: SlotId, b: SlotId): LayoutState {
  if (a === b) return state;
  const order = [...state.order];
  const pa = order.indexOf(a);
  const pb = order.indexOf(b);
  order[pa] = b;
  order[pb] = a;
  return { ...state, order };
}

export function spotlight(state: LayoutState, slot: SlotId): LayoutState {
  return { ...state, mode: 'spotlight', focus: slot };
}

/** Solo a game; soloing the game that is already solo returns to `fallback`. */
export function toggleSolo(state: LayoutState, slot: SlotId, fallback: LayoutMode = 'grid'): LayoutState {
  if (state.mode === 'solo' && state.focus === slot) return { ...state, mode: fallback === 'solo' ? 'grid' : fallback };
  return { ...state, mode: 'solo', focus: slot };
}
