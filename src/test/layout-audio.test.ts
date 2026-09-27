import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioOnly, cycleAudio, defaultAudio, effectiveMuted, normalizeAudio, onGameFocused, toggleMaster, toggleMute } from '../core/audio';
import { defaultLayout, normalizeLayout, setMode, spotlight, swapSlots, toggleSolo } from '../core/layout';

test('normalizeLayout repairs invalid persisted state', () => {
  assert.deepEqual(normalizeLayout(null), defaultLayout());
  assert.deepEqual(normalizeLayout({ mode: 'bogus', order: [0, 0, 1, 2], focus: 9 }), defaultLayout());
  assert.deepEqual(normalizeLayout({ mode: 'spotlight', order: [3, 2, 1, 0], focus: 2 }), { mode: 'spotlight', order: [3, 2, 1, 0], focus: 2 });
});

test('swap exchanges positions and is its own inverse', () => {
  const s = defaultLayout();
  const swapped = swapSlots(s, 0, 3);
  assert.deepEqual(swapped.order, [3, 1, 2, 0]);
  assert.deepEqual(swapSlots(swapped, 0, 3).order, s.order);
  assert.equal(swapSlots(s, 2, 2), s);
});

test('solo toggles on and back to the previous mode', () => {
  const s = setMode(defaultLayout(), 'spotlight');
  const solo = toggleSolo(s, 2, 'spotlight');
  assert.deepEqual([solo.mode, solo.focus], ['solo', 2]);
  assert.equal(toggleSolo(solo, 2, 'spotlight').mode, 'spotlight');
  assert.deepEqual([toggleSolo(solo, 1).mode, toggleSolo(solo, 1).focus], ['solo', 1], 'solo another game switches focus');
  assert.equal(toggleSolo(solo, 2, 'solo').mode, 'grid', 'never "returns" to solo');
  assert.deepEqual([spotlight(s, 3).mode, spotlight(s, 3).focus], ['spotlight', 3]);
});

test('exclusive audio: unmuting one game mutes the rest', () => {
  const a = defaultAudio();
  assert.deepEqual(a.muted, [false, true, true, true]);
  assert.deepEqual(toggleMute(a, 2).muted, [true, true, false, true]);
  assert.deepEqual(toggleMute(a, 0).muted, [true, true, true, true], 'muting the audible game');
  const shared = { ...a, exclusive: false };
  assert.deepEqual(toggleMute(shared, 2).muted, [false, true, false, true], 'non-exclusive keeps others');
  assert.deepEqual(audioOnly(a, 3).muted, [true, true, true, false]);
  assert.deepEqual(cycleAudio(a).muted, [true, false, true, true]);
  assert.deepEqual(cycleAudio(audioOnly(a, 3)).muted, [false, true, true, true], 'cycle wraps');
});

test('follow-focus and master mute', () => {
  const a = defaultAudio();
  assert.equal(onGameFocused(a, 2), a, 'off by default');
  assert.deepEqual(onGameFocused({ ...a, followFocus: true }, 2).muted, [true, true, false, true]);
  const m = toggleMaster(a);
  assert.equal(effectiveMuted(m, 0), true);
  assert.equal(effectiveMuted(toggleMaster(m), 0), false);
  assert.deepEqual(normalizeAudio({ muted: [1, 'x'], masterMuted: 'yes' }), defaultAudio());
});
