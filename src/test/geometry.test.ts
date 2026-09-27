import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LayoutState, Rect } from '../shared/types';
import {
  computeLayout,
  contentRegion,
  expandByInsets,
  gapMasks,
  gridCells,
  physicalToLocalDip,
  rectBottom,
  rectRight,
  splitSpan,
} from '../core/geometry';

const grid: LayoutState = { mode: 'grid', order: [0, 1, 2, 3], focus: 0 };
const area = (width: number, height: number, x = 0, y = 0): Rect => ({ x, y, width, height });

function assertTiles(rects: Rect[], a: Rect): void {
  // Tiles stay inside the area and never overlap.
  for (const r of rects) {
    assert.ok(r.x >= a.x && r.y >= a.y && rectRight(r) <= rectRight(a) && rectBottom(r) <= rectBottom(a), `inside: ${JSON.stringify(r)}`);
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const p = rects[i], q = rects[j];
      const overlap = p.x < rectRight(q) && q.x < rectRight(p) && p.y < rectBottom(q) && q.y < rectBottom(p);
      assert.equal(overlap, false, `overlap ${JSON.stringify(p)} ${JSON.stringify(q)}`);
    }
}

test('1920x1080 splits into four 960x540 quadrants', () => {
  const cells = gridCells(area(1920, 1080), 0);
  assert.deepEqual(cells, [
    { x: 0, y: 0, width: 960, height: 540 },
    { x: 960, y: 0, width: 960, height: 540 },
    { x: 0, y: 540, width: 960, height: 540 },
    { x: 960, y: 540, width: 960, height: 540 },
  ]);
});

test('odd sizes and offsets are covered exactly with no leftover pixels', () => {
  for (const a of [area(2561, 1379, 7, 3), area(1366, 728), area(3440, 1400, -3440, 0), area(1920, 1020, 2560, 564)]) {
    const cells = gridCells(a, 0);
    assertTiles(cells, a);
    const areaSum = cells.reduce((s, r) => s + r.width * r.height, 0);
    assert.equal(areaSum, a.width * a.height, `full coverage for ${JSON.stringify(a)}`);
    assert.ok(Math.abs(cells[0].width - cells[1].width) <= 1, 'columns differ by at most 1px');
  }
});

test('splitSpan with a gap keeps segments separated by exactly the gap', () => {
  const segs = splitSpan(0, 1000, [1, 1], 10);
  assert.deepEqual(segs, [
    { start: 0, length: 495 },
    { start: 505, length: 495 },
  ]);
  // Gap larger than the span collapses to zero rather than producing negative sizes.
  const tiny = splitSpan(0, 3, [1, 1, 1], 50);
  assert.deepEqual(tiny.map((s) => s.length), [1, 1, 1]);
});

test('grid follows the order array (swapped games move)', () => {
  const p = computeLayout(area(1920, 1080), { ...grid, order: [3, 1, 2, 0] }, 0);
  assert.deepEqual(p.find((x) => x.slot === 3)!.rect, { x: 0, y: 0, width: 960, height: 540 });
  assert.deepEqual(p.find((x) => x.slot === 0)!.rect, { x: 960, y: 540, width: 960, height: 540 });
});

test('spotlight: focused game gets 3/4 width, others stack in order on the right', () => {
  const a = area(1920, 1080);
  const p = computeLayout(a, { mode: 'spotlight', order: [0, 1, 2, 3], focus: 2 }, 0);
  const main = p.find((x) => x.slot === 2)!;
  assert.deepEqual(main.rect, { x: 0, y: 0, width: 1440, height: 1080 });
  const side = p.filter((x) => x.slot !== 2).map((x) => [x.slot, x.rect.y]);
  assert.deepEqual(side, [
    [0, 0],
    [1, 360],
    [3, 720],
  ]);
  assertTiles(p.map((x) => x.rect), a);
});

test('solo: focused game fills the area on top; others stay placed but hidden', () => {
  const a = area(2560, 1380);
  const p = computeLayout(a, { mode: 'solo', order: [0, 1, 2, 3], focus: 1 }, 0);
  const solo = p.find((x) => x.slot === 1)!;
  assert.deepEqual(solo.rect, a);
  assert.equal(solo.visible, true);
  assert.ok(p.filter((x) => x.slot !== 1).every((x) => !x.visible && x.z < solo.z));
});

test('gap masks cover only the strips between rows', () => {
  const gap = 10;
  const p = computeLayout(area(2560, 1380), grid, gap);
  const masks = gapMasks(p, gap);
  assert.equal(masks.length, 2);
  for (const m of masks) assert.deepEqual([m.y, m.height], [685, 10]);
  assert.deepEqual(gapMasks(p, 0), []);
  const solo = computeLayout(area(2560, 1380), { mode: 'solo', order: [0, 1, 2, 3], focus: 0 }, gap);
  assert.deepEqual(gapMasks(solo, gap), [], 'nothing to mask when one game fills the area');
  const spot = computeLayout(area(1920, 1080), { mode: 'spotlight', order: [0, 1, 2, 3], focus: 0 }, gap);
  assert.equal(gapMasks(spot, gap).length, 2, 'two gaps in the side column');
});

test('insets expand the window around the target and the region maps back to it', () => {
  const target = { x: 1280, y: 690, width: 1280, height: 690 };
  const insets = { left: 9, top: 38, right: 9, bottom: 9 };
  const outer = expandByInsets(target, insets);
  assert.deepEqual(outer, { x: 1271, y: 652, width: 1298, height: 737 });
  const region = contentRegion(target, insets);
  assert.deepEqual({ x: outer.x + region.x, y: outer.y + region.y, width: region.width, height: region.height }, target);
});

test('physical rects convert to DIPs relative to the area origin', () => {
  const r = physicalToLocalDip({ x: 1280, y: 690, width: 1280, height: 690 }, { x: 0, y: 0 }, 1.25);
  assert.deepEqual(r, { x: 1024, y: 552, width: 1024, height: 552 });
  const off = physicalToLocalDip({ x: 3520, y: 1074, width: 960, height: 510 }, { x: 2560, y: 564 }, 1);
  assert.deepEqual(off, { x: 960, y: 510, width: 960, height: 510 });
});
