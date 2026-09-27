// Backdrop page: black surface behind the games. Shows a placeholder card where a game has no
// window (starting, closed, browser stopped) and renders the optional label windows.
import type { SlotView, UiState } from '../shared/types';


const $cards = document.getElementById('cards')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function card(v: SlotView, s: UiState): string {
  if (!v.rect || !v.visible) return '';
  if (s.signInMode && v.id !== 0) return '';
  const pos = `left:${v.rect.x}px;top:${v.rect.y}px;width:${v.rect.width}px;height:${v.rect.height}px`;
  const name = v.name ? ` · ${esc(v.name)}` : '';
  switch (v.phase) {
    case 'starting':
      return `<div class="card" style="${pos}"><div class="spinner"></div><div class="title">Game ${v.number}${name}</div><div class="sub">Opening YouTube TV…</div></div>`;
    case 'closed':
      return `<div class="card" style="${pos}"><div class="title">Game ${v.number}${name} is closed</div>
        <div><button data-cmd="reopen" data-slot="${v.id}">Reopen</button> <button class="secondary" data-cmd="guide" data-slot="${v.id}">Open live guide</button></div></div>`;
    case 'browser-down':
      return `<div class="card" style="${pos}"><div class="title">Game ${v.number}: browser stopped</div>
        <div class="sub">The other games are unaffected.</div><div><button data-cmd="reopen" data-slot="${v.id}">Restart this game</button></div></div>`;
    default:
      return '';
  }
}

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
  if (!el) return;
  const slot = Number(el.dataset.slot) as 0 | 1 | 2 | 3;
  if (el.dataset.cmd === 'reopen') window.mgv.command({ type: 'reopen', slot });
  if (el.dataset.cmd === 'guide') window.mgv.command({ type: 'guide', slot });
});

// ---- label windows -----------------------------------------------------------------------
// Opened from this page so they share its renderer process (no extra processes per label).

const LABEL_CSS = `html,body{margin:0;background:transparent;overflow:hidden;font:600 13px/1 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif}
.pill{display:inline-flex;align-items:center;gap:7px;max-width:400px;margin:2px;padding:6px 10px 6px 6px;border-radius:7px;background:rgba(10,12,16,.78);color:#f1f3f6;white-space:nowrap}
.n{display:inline-grid;place-items:center;min-width:19px;height:19px;border-radius:4px;background:#3d8bfd;color:#fff;font-size:12px}
.t{overflow:hidden;text-overflow:ellipsis}.w{color:#f0b429}.m{color:#9aa1ad;font-weight:400}`;

const labels: (Window | null)[] = [null, null, null, null];
const labelHtml: string[] = ['', '', '', ''];

function ensureLabel(i: number): Window | null {
  const existing = labels[i];
  if (existing && !existing.closed) return existing;
  const w = window.open('about:blank', `mgv-label-${i}`);
  if (!w) return null;
  w.document.open();
  w.document.write(`<!doctype html><html><head><style>${LABEL_CSS}</style></head><body><div id="l"></div></body></html>`);
  w.document.close();
  labels[i] = w;
  labelHtml[i] = '';
  return w;
}

function labelContent(v: SlotView, s: UiState): string {
  const text = v.name || v.title || `Game ${v.number}`;
  const warn = v.phase === 'signin' ? 'Sign in required' : v.phase === 'unresponsive' ? 'Not responding' : '';
  const muted = s.audioScope === 'per-game' && v.muted ? '<span class="m">muted</span>' : '';
  return `<span class="pill"><span class="n">${v.number}</span><span class="t">${esc(text)}</span>${warn ? `<span class="w">${warn}</span>` : ''}${muted}</span>`;
}

function renderLabels(s: UiState): void {
  s.slots.forEach((v) => {
    const w = ensureLabel(v.id);
    if (!w) return;
    const html = labelContent(v, s);
    if (html === labelHtml[v.id]) return;
    labelHtml[v.id] = html;
    const el = w.document.getElementById('l');
    if (el) el.innerHTML = html;
  });
}

window.mgv.onState((s) => {
  $cards.innerHTML = s.slots.map((v) => card(v, s)).join('');
  renderLabels(s);
});
