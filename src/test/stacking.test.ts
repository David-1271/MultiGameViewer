import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LayoutState } from '../shared/types';
import { computeLayout, gapMasks } from '../core/geometry';
import { stackingOrder, type StackItem } from '../core/stacking';
import { parseEngineInstance } from '../main/win32/gpu';

const area = { x: 0, y: 0, width: 2560, height: 1380 };
const label = (i: StackItem) => (i.kind === 'game' ? `g${i.slot + 1}` : `m${i.index}`);

function orderFor(layout: LayoutState, gap = 0): string[] {
  const placements = computeLayout(area, layout, gap);
  const masks = gapMasks(placements, gap);
  return stackingOrder({
    games: placements.map((p) => ({ slot: p.slot, rect: p.rect, visible: p.visible })),
    soloFocus: layout.mode === 'solo' ? layout.focus : null,
    masks,
  }).map(label);
}

test('grid: top row above bottom row so hidden title bars sit under the game above', () => {
  assert.deepEqual(orderFor({ mode: 'grid', order: [0, 1, 2, 3], focus: 0 }), ['g1', 'g2', 'g3', 'g4']);
  assert.deepEqual(orderFor({ mode: 'grid', order: [3, 2, 1, 0], focus: 0 }), ['g4', 'g3', 'g2', 'g1']);
});

test('gap masks sit directly above the tiles whose title bars they cover', () => {
  assert.deepEqual(orderFor({ mode: 'grid', order: [0, 1, 2, 3], focus: 0 }, 10), ['g1', 'g2', 'm0', 'm1', 'g3', 'g4']);
});

test('solo game is on top; hidden games below it', () => {
  const o = orderFor({ mode: 'solo', order: [0, 1, 2, 3], focus: 3 });
  assert.equal(o[0], 'g4');
  assert.deepEqual(o.slice(1), ['g1', 'g2', 'g3']);
});

test('spotlight: side column stacks top-down', () => {
  assert.deepEqual(orderFor({ mode: 'spotlight', order: [0, 1, 2, 3], focus: 2 }, 8), ['g3', 'g1', 'm0', 'g2', 'm1', 'g4']);
});

test('GPU engine counter instance names', () => {
  assert.deepEqual(parseEngineInstance('pid_1234_luid_0x00000000_0x0000D1E2_phys_0_eng_3_engtype_VideoDecode'), { pid: 1234, type: 'videodecode' });
  assert.deepEqual(parseEngineInstance('pid_9_luid_0x0_0x1_phys_0_eng_0_engtype_3D'), { pid: 9, type: '3d' });
  assert.equal(parseEngineInstance('_Total'), null);
});
