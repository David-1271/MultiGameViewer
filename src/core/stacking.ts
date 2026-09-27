// Z-order policy for the game windows and gap masks (pure, so it can be tested).
//
// Every game window keeps its title bar just above its visible content (clip regions only
// affect mouse hit-testing for the browser's GPU-composited output, not painting). So:
//   - a solo game goes on top of everything,
//   - visible games above hidden ones,
//   - higher rows above lower rows (a lower game's title bar ends up under the game above),
//   - each gap mask directly above the tile whose title bar it covers.
import type { Rect, SlotId } from '../shared/types';

export type StackItem = { kind: 'game'; slot: SlotId } | { kind: 'mask'; index: number };

export interface StackInput {
  games: { slot: SlotId; rect: Rect; visible: boolean }[];
  soloFocus: SlotId | null;
  masks: Rect[];
}

/** Returns items ordered top (closest to the viewer) to bottom. */
export function stackingOrder(input: StackInput): StackItem[] {
  const keyed: { item: StackItem; key: number[] }[] = [];
  for (const g of input.games) {
    keyed.push({ item: { kind: 'game', slot: g.slot }, key: [g.slot === input.soloFocus ? 0 : 1, g.visible ? 0 : 1, g.rect.y, g.rect.x] });
  }
  input.masks.forEach((m, index) => {
    // Sort just before the tile below the gap (whose top is m.y + m.height).
    keyed.push({ item: { kind: 'mask', index }, key: [1, 0, m.y + m.height - 0.5, m.x] });
  });
  keyed.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    return 0;
  });
  return keyed.map((k) => k.item);
}
