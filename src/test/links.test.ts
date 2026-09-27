import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStart, playerPageHtml, playerQuery, resolveLink, targetFromPlayerQuery, watchUrl } from '../core/links';

const ok = (input: string) => {
  const r = resolveLink(input);
  if ('error' in r) throw new Error(`${input}: ${r.error}`);
  return r;
};

test('every common YouTube video link form resolves to the same video', () => {
  for (const input of [
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    'youtube.com/watch?v=aqz-KE-bpKQ&feature=share',
    'https://youtu.be/aqz-KE-bpKQ?si=abc',
    'https://m.youtube.com/watch?v=aqz-KE-bpKQ',
    'https://www.youtube.com/live/aqz-KE-bpKQ',
    'https://www.youtube.com/shorts/aqz-KE-bpKQ',
    'https://www.youtube.com/embed/aqz-KE-bpKQ',
    'http://www.youtube.com/watch?v=aqz-KE-bpKQ',
    'aqz-KE-bpKQ',
  ]) {
    const r = ok(input);
    assert.deepEqual(r.youtube, { kind: 'video', id: 'aqz-KE-bpKQ' }, input);
    assert.equal(r.link, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', input);
    assert.equal(r.service, 'youtube');
  }
});

test('start times and playlists are kept', () => {
  assert.deepEqual(ok('https://youtu.be/aqz-KE-bpKQ?t=1m30s').youtube, { kind: 'video', id: 'aqz-KE-bpKQ', start: 90 });
  assert.equal(ok('https://youtu.be/aqz-KE-bpKQ?t=90').link, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=90s');
  const pl = ok('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
  assert.deepEqual(pl.youtube, { kind: 'playlist', list: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' });
  assert.equal(pl.link, 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
  const inList = ok('https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
  assert.deepEqual(inList.youtube, { kind: 'playlist', list: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', id: 'aqz-KE-bpKQ' });
  assert.equal(parseStart('1h2m3s'), 3723);
  assert.equal(parseStart('abc'), undefined);
  assert.equal(parseStart('0'), undefined);
});

test('non-video YouTube pages, YouTube TV and other sites open as pages', () => {
  assert.deepEqual(ok('https://www.youtube.com/@NFL/live'), { link: 'https://www.youtube.com/@NFL/live', youtube: null, service: 'youtube' });
  assert.equal(ok('youtube.com').youtube, null);
  assert.deepEqual(ok('https://tv.youtube.com/watch/abc?vp=1'), { link: 'https://tv.youtube.com/watch/abc?vp=1', youtube: null, service: 'youtubetv' });
  assert.equal(ok('example.org/stream').service, 'web');
  assert.equal(ok('https://www.youtube.com/watch?v=short').youtube, null, 'invalid id is not treated as a video');
});

test('unsafe or empty input is rejected', () => {
  for (const bad of ['', '   ', 'YE7VzlLtp-4?t=30', 'localhost', 'javascript:alert(1)', 'file:///C:/x', 'data:text/html,hi', 'ftp://example.com']) {
    assert.ok('error' in resolveLink(bad), bad);
  }
});

test('player query round-trips and rejects junk', () => {
  for (const t of [
    { kind: 'video' as const, id: 'aqz-KE-bpKQ' },
    { kind: 'video' as const, id: 'aqz-KE-bpKQ', start: 42 },
    { kind: 'playlist' as const, list: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', id: 'aqz-KE-bpKQ' },
  ]) {
    assert.deepEqual(targetFromPlayerQuery(new URLSearchParams(playerQuery(t))), t);
  }
  assert.equal(targetFromPlayerQuery(new URLSearchParams('v=<script>')), null);
  assert.equal(targetFromPlayerQuery(new URLSearchParams('')), null);
  assert.equal(watchUrl({ kind: 'playlist', list: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' }), 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
});

test('player page embeds through the official API and falls back to the watch page', () => {
  const html = playerPageHtml({ kind: 'video', id: 'aqz-KE-bpKQ', start: 5 });
  assert.match(html, /https:\/\/www\.youtube\.com\/iframe_api/);
  assert.match(html, /"videoId":"aqz-KE-bpKQ"/);
  assert.match(html, /"start":5/);
  assert.match(html, /\[101, 150, 153\]/);
  assert.match(html, /"fallback":"https:\/\/www\.youtube\.com\/watch\?v=aqz-KE-bpKQ&t=5s"/);
  assert.doesNotMatch(html.replace(/<\/script>/g, ''), /<\/script/i, 'config cannot break out of the script');
});
