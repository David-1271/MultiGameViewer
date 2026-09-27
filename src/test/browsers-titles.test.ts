import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserKey, candidatePaths, detectVersion, launchArgs, locateBrowser, processTypeOf, userDataDirMatches, type FsProbe } from '../core/browsers';
import { cleanTitle, looksLikeSignIn } from '../core/titles';

const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function fakeFs(files: string[], dirs: Record<string, string[]> = {}): FsProbe {
  return {
    exists: (p) => files.includes(p),
    readdir: (p) => {
      if (!(p in dirs)) throw new Error('ENOENT');
      return dirs[p];
    },
  };
}

test('auto prefers Chrome, falls back to Edge', () => {
  const both = fakeFs([CHROME, EDGE]);
  assert.equal(locateBrowser('auto', '', env, both)?.kind, 'chrome');
  assert.equal(locateBrowser('edge', '', env, both)?.kind, 'edge');
  assert.equal(locateBrowser('auto', '', env, fakeFs([EDGE]))?.kind, 'edge');
  assert.equal(locateBrowser('chrome', '', env, fakeFs([EDGE])), null);
  assert.equal(locateBrowser('auto', '', env, fakeFs([])), null);
});

test('custom browser path and version detection', () => {
  const custom = 'D:\\Portable\\chrome.exe';
  const probe = fakeFs([custom], { 'D:\\Portable': ['153.0.8010.48', '153.0.8010.53', 'Locales', '99.1.1.1'] });
  const b = locateBrowser('auto', custom, env, probe)!;
  assert.deepEqual([b.kind, b.version], ['chrome', '153.0.8010.53']);
  assert.equal(browserKey(b), 'chrome@153.0.8010.53');
  assert.equal(locateBrowser('auto', 'D:\\missing.exe', env, probe), null);
  assert.equal(detectVersion('X:\\nowhere\\chrome.exe', probe), 'unknown');
  assert.ok(candidatePaths(env).some((c) => c.exe === 'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
});

test('launch flags are plain: no debugging or automation switches', () => {
  const args = launchArgs('C:\\p', 'https://tv.youtube.com/');
  assert.ok(args.includes('--user-data-dir=C:\\p'));
  assert.ok(args.includes('--app=https://tv.youtube.com/'));
  for (const a of args) {
    assert.doesNotMatch(a, /remote-debugging|enable-automation|headless|disable-blink-features|disable-web-security|disable-direct-composition/);
  }
});

test('matching our profile in browser command lines', () => {
  const dir = 'C:\\Users\\u\\AppData\\Local\\MultiGameViewer\\profiles\\chrome\\shared';
  assert.equal(userDataDirMatches(`"chrome.exe" --user-data-dir=${dir} --app=x`, dir), true);
  assert.equal(userDataDirMatches(`"chrome.exe" --user-data-dir="${dir.toUpperCase()}\\" --type=renderer`, dir), true);
  assert.equal(userDataDirMatches(`"chrome.exe" --user-data-dir=${dir}-other`, dir), false);
  assert.equal(userDataDirMatches('"chrome.exe" --app=x', dir), false);
  assert.equal(processTypeOf('chrome.exe --user-data-dir=x'), 'browser');
  assert.equal(processTypeOf('chrome.exe --type=gpu-process --foo'), 'gpu-process');
  assert.equal(processTypeOf('chrome.exe --type=utility --utility-sub-type=audio.mojom.AudioService'), 'utility:audio.mojom.AudioService');
});

test('window titles: sign-in detection and clean labels', () => {
  assert.equal(looksLikeSignIn('Sign in - Google Accounts'), true);
  assert.equal(looksLikeSignIn("Verify it's you"), true);
  assert.equal(looksLikeSignIn('YouTube TV - Watch & DVR Live Sports, Shows & News'), false);
  assert.equal(cleanTitle('Chiefs at Bills - YouTube TV'), 'Chiefs at Bills');
  assert.equal(cleanTitle('YouTube TV'), '');
  assert.equal(cleanTitle('Big Buck Bunny 60fps 4K - YouTube'), 'Big Buck Bunny 60fps 4K');
  assert.equal(cleanTitle('(3) Lofi beats - YouTube'), 'Lofi beats');
  assert.equal(cleanTitle('YouTube'), '');
  assert.equal(cleanTitle('YouTube TV - Watch & DVR Live Sports, Shows & News'), 'Watch & DVR Live Sports, Shows & News');
});
