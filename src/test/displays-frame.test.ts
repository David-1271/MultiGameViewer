import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeDisplays, physicalArea, pickDisplay, type DisplayInfo } from '../core/displays';
import { calibrationPageUrl, computeInsets, insetsValid, parseCalibrationTitle, titleDipFromCalibration } from '../core/frame';

// The two monitors of the development machine: a 2560x1440 primary and a 1920x1080
// secondary to its right, both at 125% scaling (DIP coordinates as Electron reports them).
const primary: DisplayInfo = {
  id: 1,
  label: 'MAG 27CQ6F',
  bounds: { x: 0, y: 0, width: 2048, height: 1152 },
  workArea: { x: 0, y: 0, width: 2048, height: 1104 },
  scaleFactor: 1.25,
  primary: true,
};
const secondary: DisplayInfo = {
  id: 2,
  label: '',
  bounds: { x: 2048, y: 451, width: 1536, height: 864 },
  workArea: { x: 2048, y: 451, width: 1536, height: 816 },
  scaleFactor: 1.25,
  primary: false,
};

test('pickDisplay prefers saved id, then saved position, then primary', () => {
  const list = [secondary, primary];
  assert.equal(pickDisplay(list, { id: 2, bounds: null }), secondary);
  assert.equal(pickDisplay(list, { id: 99, bounds: secondary.bounds }), secondary, 'id changed after reboot');
  assert.equal(pickDisplay(list, { id: 99, bounds: { x: 5, y: 5, width: 5, height: 5 } }), primary, 'monitor gone');
  assert.equal(pickDisplay(list, { id: null, bounds: null }), primary);
  assert.throws(() => pickDisplay([], { id: null, bounds: null }));
});

test('physical area: work area excludes the taskbar; fullscreen uses the whole monitor', () => {
  const phys = { x: 0, y: 0, width: 2560, height: 1440 };
  assert.deepEqual(physicalArea(primary, phys, false), { x: 0, y: 0, width: 2560, height: 1380 });
  assert.deepEqual(physicalArea(primary, phys, true), phys);
  const physSecondary = { x: 2560, y: 564, width: 1920, height: 1080 };
  assert.deepEqual(physicalArea(secondary, physSecondary, false), { x: 2560, y: 564, width: 1920, height: 1020 });
});

test('physical area at 100% and 150% scaling, taskbar on the left', () => {
  const d: DisplayInfo = { ...primary, bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 32, y: 0, width: 1248, height: 720 }, scaleFactor: 1.5 };
  assert.deepEqual(physicalArea(d, { x: 0, y: 0, width: 1920, height: 1080 }, false), { x: 48, y: 0, width: 1872, height: 1080 });
  const one: DisplayInfo = { ...primary, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
  assert.deepEqual(physicalArea(one, { x: 0, y: 0, width: 1920, height: 1080 }, false), { x: 0, y: 0, width: 1920, height: 1040 });
});

test('describeDisplays labels unnamed monitors and marks the primary', () => {
  const v = describeDisplays([primary, secondary]);
  assert.equal(v[0].label, 'MAG 27CQ6F');
  assert.equal(v[1].label, 'Display 2');
  assert.match(v[0].detail, /2560×1440 @ 125% · primary/);
});

test('computeInsets reproduces the measured Chrome 153 app-window frame at 125%', () => {
  // Measured with GetWindowRect / ClientToScreen / GetClientRect on this machine.
  const insets = computeInsets(
    { window: { x: 125, y: 125, width: 1000, height: 625 }, clientOrigin: { x: 134, y: 125 }, clientSize: { width: 982, height: 616 }, dpi: 120 },
    30,
  );
  assert.deepEqual(insets, { left: 9, top: 38, right: 9, bottom: 9 });
  assert.equal(insetsValid(insets), true);
  assert.equal(computeInsets({ window: { x: 0, y: 0, width: 100, height: 100 }, clientOrigin: { x: 8, y: 0 }, clientSize: { width: 84, height: 92 }, dpi: 96 }, 30, 2).top, 32);
  assert.equal(insetsValid({ left: -1, top: 0, right: 0, bottom: 0 }), false);
});

test('title bar height from calibration readings (rounding at fractional scales)', () => {
  // 125%: client 616 px, viewport 463 CSS px -> 616/1.25 - 463 = 29.8 -> 30 DIP.
  assert.equal(titleDipFromCalibration(616, 463, 120), 30);
  assert.equal(titleDipFromCalibration(727, 552, 120), 30);
  assert.equal(titleDipFromCalibration(630, 600, 96), 30);
  assert.equal(titleDipFromCalibration(100, 400, 96), null, 'implausible');
  assert.deepEqual(parseCalibrationTitle('MGVCAL 786x463@1.25'), { innerWidth: 786, innerHeight: 463, dpr: 1.25 });
  assert.equal(parseCalibrationTitle('YouTube TV'), null);
  assert.ok(calibrationPageUrl().startsWith('data:text/html'));
});
