// Turning whatever the user pastes into something a quadrant can open.
//
// Regular YouTube videos play best in YouTube's embed player (just the video, no page around
// it). YouTube only serves that player inside a real web page (a bare /embed/ URL shows
// "Error 153"), so the viewer serves a one-line page from 127.0.0.1 that embeds it the
// standard way (the IFrame Player API). Everything else opens as-is.

export type YouTubeTarget =
  | { kind: 'video'; id: string; start?: number }
  | { kind: 'playlist'; list: string; id?: string; start?: number };

export type ResolvedLink = { link: string; youtube: YouTubeTarget | null; service: 'youtube' | 'youtubetv' | 'web' };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

export const YOUTUBE_HOME = 'https://www.youtube.com/';

/** "90", "90s", "1m30s", "1h2m3s" -> seconds. */
export function parseStart(v: string | null): number | undefined {
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v) || undefined;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || !(m[1] || m[2] || m[3])) return undefined;
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return s || undefined;
}

export function parseYouTube(url: URL): YouTubeTarget | null {
  const host = url.hostname.toLowerCase();
  const start = parseStart(url.searchParams.get('t') ?? url.searchParams.get('start'));
  const withStart = <T extends object>(t: T) => (start ? { ...t, start } : t);
  const list = url.searchParams.get('list');
  let id: string | undefined;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
    else if (['live', 'shorts', 'embed', 'v'].includes(parts[0]) && parts[1] && parts[1] !== 'videoseries') id = parts[1];
    else if (parts[0] === 'playlist' || (parts[0] === 'embed' && parts[1] === 'videoseries')) id = undefined;
    else return null; // home, channels, search... open as a normal page
  } else return null;
  const validId = id && VIDEO_ID.test(id) ? id : undefined;
  if (list && LIST_ID.test(list)) return withStart(validId ? { kind: 'playlist' as const, list, id: validId } : { kind: 'playlist' as const, list });
  return validId ? withStart({ kind: 'video' as const, id: validId }) : null;
}

/** Canonical https://www.youtube.com/watch?... URL for a target (what we store and fall back to). */
export function watchUrl(t: YouTubeTarget): string {
  const u = t.kind === 'video' || t.id ? new URL('https://www.youtube.com/watch') : new URL('https://www.youtube.com/playlist');
  if (t.kind === 'video') u.searchParams.set('v', t.id);
  else {
    if (t.id) u.searchParams.set('v', t.id);
    u.searchParams.set('list', t.list);
  }
  if (t.start) u.searchParams.set('t', `${t.start}s`);
  return u.toString();
}

/**
 * Resolve user input: a full URL, a URL without scheme, or a bare 11-character video id.
 * Only https is allowed (http is upgraded).
 */
export function resolveLink(input: string): ResolvedLink | { error: string } {
  let text = input.trim();
  if (!text) return { error: 'Paste a YouTube or YouTube TV link.' };
  if (VIDEO_ID.test(text)) text = `https://www.youtube.com/watch?v=${text}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: 'That doesn’t look like a link.' };
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return { error: 'Only https links can be opened.' };
  const host = url.hostname.toLowerCase();
  if (!host.includes('.')) return { error: 'That doesn’t look like a link.' };
  if (host === 'tv.youtube.com') return { link: url.toString(), youtube: null, service: 'youtubetv' };
  const youtube = parseYouTube(url);
  if (youtube) return { link: watchUrl(youtube), youtube, service: 'youtube' };
  const isYouTube = host === 'youtu.be' || YOUTUBE_HOSTS.has(host);
  return { link: url.toString(), youtube: null, service: isYouTube ? 'youtube' : 'web' };
}

/** Query string for the local player page. */
export function playerQuery(t: YouTubeTarget): string {
  const q = new URLSearchParams();
  if (t.kind === 'video') q.set('v', t.id);
  else {
    q.set('list', t.list);
    if (t.id) q.set('v', t.id);
  }
  if (t.start) q.set('start', String(t.start));
  return q.toString();
}

/** Parse the player page's own query back into a target (strictly validated). */
export function targetFromPlayerQuery(q: URLSearchParams): YouTubeTarget | null {
  const v = q.get('v');
  const list = q.get('list');
  const start = parseStart(q.get('start'));
  const id = v && VIDEO_ID.test(v) ? v : undefined;
  if (list && LIST_ID.test(list)) return { kind: 'playlist', list, ...(id ? { id } : {}), ...(start ? { start } : {}) };
  if (id) return { kind: 'video', id, ...(start ? { start } : {}) };
  return null;
}

/**
 * The local player page. It embeds YouTube's player with the official IFrame Player API,
 * shows the video title in the window title (for labels), and switches to the normal watch
 * page if the owner has disabled embedding (errors 101/150/153).
 */
export function playerPageHtml(t: YouTubeTarget): string {
  const cfg = {
    videoId: t.kind === 'video' ? t.id : t.id ?? '',
    playerVars: {
      autoplay: 1,
      playsinline: 1,
      rel: 0,
      ...(t.start ? { start: t.start } : {}),
      ...(t.kind === 'playlist' ? { listType: 'playlist', list: t.list } : {}),
    },
    fallback: watchUrl(t),
  };
  // JSON is safe to inline once "<" is escaped (no way to close the script tag).
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin"><title>YouTube</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{width:100%;height:100%;border:0}</style></head>
<body><div id="p"></div>
<script>
const cfg = ${json};
function title(p) { try { const t = p.getVideoData().title; if (t) document.title = t + ' - YouTube'; } catch (e) {} }
window.onYouTubeIframeAPIReady = function () {
  new YT.Player('p', { width: '100%', height: '100%', videoId: cfg.videoId, playerVars: cfg.playerVars, events: {
    onReady: function (e) {
      var p = e.target;
      title(p);
      p.playVideo();
      // Browsers block autoplay with sound until you've interacted with the site; if that
      // happened, start muted instead (use the player's speaker button to unmute).
      setTimeout(function () { var st = p.getPlayerState(); if (st !== 1 && st !== 3) { p.mute(); p.playVideo(); } }, 1500);
    },
    onStateChange: function (e) { title(e.target); },
    onError: function (e) { if ([101, 150, 153].indexOf(e.data) >= 0) location.replace(cfg.fallback); }
  } });
};
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body></html>`;
}
