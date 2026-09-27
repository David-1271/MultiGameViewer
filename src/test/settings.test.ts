import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultSettings, mergeSettings, normalizeSettings, safeHttpsUrl, SettingsStore } from '../core/settings';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mgv-settings-'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('normalizeSettings fills defaults and clamps values', () => {
  assert.deepEqual(normalizeSettings(undefined), defaultSettings());
  const s = normalizeSettings({ gap: 999, titleCropAdjust: -50, slotNames: ['A', 5], browser: 'firefox', sessionMode: 'separate', unknown: 1 });
  assert.equal(s.gap, 64);
  assert.equal(s.titleCropAdjust, -4);
  assert.deepEqual(s.slotNames, ['A', '', '', '']);
  assert.equal(s.browser, 'auto');
  assert.equal(s.sessionMode, 'separate');
  assert.equal((s as unknown as Record<string, unknown>).unknown, undefined);
});

test('only https URLs are accepted for navigation', () => {
  assert.equal(safeHttpsUrl('https://tv.youtube.com/live', 'x'), 'https://tv.youtube.com/live');
  assert.equal(safeHttpsUrl('javascript:alert(1)', 'x'), 'x');
  assert.equal(safeHttpsUrl('http://tv.youtube.com/', 'x'), 'x');
  assert.equal(safeHttpsUrl('file:///C:/Windows', 'x'), 'x');
  assert.equal(normalizeSettings({ startUrl: 'not a url' }).startUrl, 'https://tv.youtube.com/');
});

test('calibration entries are validated', () => {
  const s = normalizeSettings({ calibration: { 'chrome@153': 30, bad: 'x', huge: 5000 } });
  assert.deepEqual(s.calibration, { 'chrome@153': 30 });
});

test('merge keeps untouched keys', () => {
  const s = mergeSettings(defaultSettings(), { gap: 6 });
  assert.equal(s.gap, 6);
  assert.equal(s.startUrl, 'https://tv.youtube.com/');
});

test('SettingsStore persists, reloads and writes atomically', async () => {
  const dir = tmp();
  const file = path.join(dir, 'nested', 'settings.json');
  const a = new SettingsStore(file, () => {}, 10);
  a.update({ gap: 4, slotNames: ['Chiefs @ Bills', '', '', ''], layout: { mode: 'spotlight', order: [1, 0, 2, 3], focus: 1 } });
  await sleep(40);
  assert.ok(fs.existsSync(file));
  assert.ok(!fs.existsSync(file + '.tmp'), 'temp file renamed away');
  const b = new SettingsStore(file);
  assert.equal(b.get().gap, 4);
  assert.equal(b.get().slotNames[0], 'Chiefs @ Bills');
  assert.deepEqual(b.get().layout, { mode: 'spotlight', order: [1, 0, 2, 3], focus: 1 });
  b.update({ fullscreen: true });
  b.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).fullscreen, true);
});

test('a corrupt settings file is backed up and replaced by defaults', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ not json');
  const errors: string[] = [];
  const s = new SettingsStore(file, (m) => errors.push(m));
  assert.deepEqual(s.get(), defaultSettings());
  assert.equal(errors.length, 1);
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('settings.json.corrupt-')));
});
