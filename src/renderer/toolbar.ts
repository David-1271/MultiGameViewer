// Toolbar UI. Renders from the state pushed by the main process and sends commands back.
import type { LayoutMode, Settings, SlotId, SlotView, UiCommand, UiState } from '../shared/types';


type Panel = `game-${SlotId}` | 'settings' | 'stats' | 'help';

const $bar = document.getElementById('bar')!;
const $banner = document.getElementById('banner')!;
const $panel = document.getElementById('panel')!;
const $root = document.getElementById('root')!;

let state: UiState | null = null;
let panel: Panel | null = null;
let renderedPanelKey = '';
/** Swap flow: first click on Swap arms picking; then two game chips are chosen. */
let pickingFirst = false;

const send = (cmd: UiCommand) => window.mgv.command(cmd);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICON = {
  grid: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
  spotlight: svg('<rect x="3" y="3" width="13" height="18" rx="1"/><rect x="18" y="3" width="3" height="5" rx="1"/><rect x="18" y="9.5" width="3" height="5" rx="1"/><rect x="18" y="16" width="3" height="5" rx="1"/>'),
  solo: svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/>'),
  swap: svg('<path d="M7 7h12l-3-3M17 17H5l3 3"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  unfull: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  stats: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>'),
  min: svg('<path d="M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  speaker: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  muted: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
};

function modeButton(mode: LayoutMode, label: string, icon: string, s: UiState): string {
  const on = s.layout.mode === mode;
  return `<button class="${on ? 'on' : ''}" data-act="mode" data-mode="${mode}" title="${label}">${icon}<span>${label}</span></button>`;
}

function chip(v: SlotView, s: UiState): string {
  const picking = pickingFirst || s.swapFrom !== null;
  const on = panel === `game-${v.id}` || s.swapFrom === v.id || ((s.layout.mode !== 'grid') && s.layout.focus === v.id);
  const name = v.name || v.title || `Game ${v.number}`;
  const audio = s.audioScope === 'per-game' ? (v.muted ? ICON.muted : ICON.speaker) : '';
  const tip = `Game ${v.number}${v.title ? ' — ' + v.title : ''} (${phaseText(v)})`;
  return `<button class="chip ${on ? 'on' : ''} ${picking ? 'picking' : ''}" data-act="chip" data-slot="${v.id}" title="${esc(tip)}">
    <span class="dot ${v.phase}"></span><span class="num">${v.number}</span><span class="name">${esc(name)}</span>${audio}</button>`;
}

function phaseText(v: SlotView): string {
  switch (v.phase) {
    case 'starting':
      return 'starting';
    case 'open':
      return 'open';
    case 'signin':
      return 'sign-in required';
    case 'closed':
      return 'closed';
    case 'fullscreen':
      return 'full screen';
    case 'unresponsive':
      return 'not responding';
    case 'browser-down':
      return 'browser stopped';
  }
}

function renderBar(s: UiState): void {
  const swapping = pickingFirst || s.swapFrom !== null;
  const slots = [...s.slots].sort((a, b) => a.id - b.id);
  $bar.innerHTML = [
    modeButton('grid', '2×2', ICON.grid, s),
    modeButton('spotlight', 'Spotlight', ICON.spotlight, s),
    modeButton('solo', 'Solo', ICON.solo, s),
    '<span class="sep"></span>',
    ...slots.map((v) => chip(v, s)),
    '<span class="sep"></span>',
    `<button class="${swapping ? 'on' : ''}" data-act="swap" title="Swap two games">${ICON.swap}<span>${s.swapFrom !== null ? `Swap ${s.swapFrom + 1} with…` : pickingFirst ? 'Pick a game…' : 'Swap'}</span></button>`,
    `<button class="icon ${s.masterMuted ? 'on' : ''}" data-act="master" title="${s.masterMuted ? 'Unmute' : 'Mute'} all games (Ctrl+Alt+M)">${s.masterMuted ? ICON.muted : ICON.speaker}</button>`,
    `<button class="icon ${s.fullscreen ? 'on' : ''}" data-act="fullscreen" title="Full screen (Ctrl+Alt+F)">${s.fullscreen ? ICON.unfull : ICON.full}</button>`,
    `<button class="icon ${panel === 'settings' ? 'on' : ''}" data-act="panel" data-panel="settings" title="Settings">${ICON.gear}</button>`,
    `<button class="icon ${panel === 'stats' ? 'on' : ''}" data-act="panel" data-panel="stats" title="Performance">${ICON.stats}</button>`,
    `<button class="icon ${panel === 'help' ? 'on' : ''}" data-act="panel" data-panel="help" title="Help & shortcuts">${ICON.help}</button>`,
    `<button class="icon" data-act="minimize" title="Minimize everything (Ctrl+Alt+H)">${ICON.min}</button>`,
    `<button class="icon danger" data-act="quit" title="Exit MultiGame Viewer (closes the games)">${ICON.close}</button>`,
  ].join('');
}

function renderBanner(s: UiState): void {
  const b = s.banner;
  $banner.className = b ? b.kind : '';
  $banner.innerHTML = b ? `<span class="text">${esc(b.text)}</span>${b.action ? `<button class="on" data-act="banner">${esc(b.action.label)}</button>` : ''}` : '';
}

// ---- panels ------------------------------------------------------------------------------

function gamePanel(s: UiState, id: SlotId): string {
  const v = s.slots[id];
  const others = s.slots.filter((o) => o.id !== id);
  const perGame = s.audioScope === 'per-game';
  const audio = perGame
    ? `<button data-act="audioOnly" data-slot="${id}">${ICON.speaker}Only this game's audio</button>
       <button data-act="mute" data-slot="${id}">${v.muted ? ICON.speaker + 'Unmute' : ICON.muted + 'Mute'}</button>`
    : `<span class="note">All four games share one browser, so Windows sees one audio stream. Use each game's own speaker button, or pick <b>Separate sessions</b> in Settings for per-game audio control here.</span>`;
  const window_ =
    v.phase === 'closed' || v.phase === 'browser-down'
      ? `<button class="on" data-act="reopen" data-slot="${id}">Reopen game ${v.number}</button>`
      : `<button data-act="activate" data-slot="${id}" title="Give this game keyboard focus">Focus</button>
         <button data-act="reload" data-slot="${id}" title="Reload the page (F5)">Reload</button>
         <button data-act="guide" data-slot="${id}" title="Open the YouTube TV live guide in this quadrant">Live guide</button>
         <button data-act="reopen" data-slot="${id}" title="Close and reopen this game's window at YouTube TV home">Reopen</button>`;
  return `<h2>Game ${v.number}${v.title ? ` — ${esc(v.title)}` : ''}</h2>
    <div class="row"><label>Label <input type="text" data-input="rename" data-slot="${id}" maxlength="60" placeholder="e.g. Chiefs @ Bills" value="${esc(v.name)}"></label></div>
    <h3>Layout</h3>
    <div class="row">
      <button data-act="spotlight" data-slot="${id}">${ICON.spotlight}Spotlight</button>
      <button data-act="solo" data-slot="${id}">${ICON.solo}${s.layout.mode === 'solo' && s.layout.focus === id ? 'Back to layout' : 'Solo'}</button>
      <span class="note">Swap with</span>
      ${others.map((o) => `<button data-act="swapWith" data-a="${id}" data-b="${o.id}">${o.number}</button>`).join('')}
    </div>
    <h3>Audio</h3><div class="row">${audio}</div>
    <h3>Window</h3><div class="row">${window_}</div>`;
}

function check(key: string, label: string, checked: boolean, hint = ''): string {
  return `<label class="check"><input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
}

function settingsPanel(s: UiState): string {
  const st: Settings = s.settings;
  const displays = s.displays
    .map((d) => `<option value="${d.id}" ${d.id === s.displayId ? 'selected' : ''}>${esc(d.label)} — ${esc(d.detail)}</option>`)
    .join('');
  return `<h2>Settings</h2>
    <div class="row"><label>Monitor <select data-input="display">${displays}</select></label>
      <label>Gap between games <input type="range" min="0" max="24" step="1" data-input="gap" value="${st.gap}"> <span>${st.gap}px</span></label></div>
    <div class="grid2">
      ${check('showLabels', 'Show game labels', st.showLabels)}
      ${check('toolbarAutoHide', 'Auto-hide this toolbar', st.toolbarAutoHide, 'Move the mouse to the top edge to show it')}
      ${check('lockLayout', 'Keep games snapped in place', st.lockLayout)}
      ${check('hotkeys', 'Keyboard shortcuts', st.hotkeys, 'Only active while the viewer is focused')}
      ${check('audio.exclusive', 'One game audible at a time', st.audio.exclusive)}
      ${check('audio.followFocus', 'Audio follows the clicked game', st.audio.followFocus, 'Separate sessions only')}
      ${check('autoRestartBrowser', 'Restart a crashed browser automatically', st.autoRestartBrowser)}
    </div>
    <h3>Browser</h3>
    <div class="row">
      <label>Use <select data-input="browser">
        <option value="auto" ${st.browser === 'auto' ? 'selected' : ''}>Auto (Chrome, then Edge)</option>
        <option value="chrome" ${st.browser === 'chrome' ? 'selected' : ''}>Google Chrome</option>
        <option value="edge" ${st.browser === 'edge' ? 'selected' : ''}>Microsoft Edge</option>
      </select></label>
      <label>Sessions <select data-input="sessionMode">
        <option value="shared" ${st.sessionMode === 'shared' ? 'selected' : ''}>Shared — one sign-in, lowest resource use</option>
        <option value="separate" ${st.sessionMode === 'separate' ? 'selected' : ''}>Separate — per-game audio, sign in per game</option>
      </select></label>
    </div>
    <div class="note">${s.browser ? `${esc(s.browser.name)} ${esc(s.browser.version)}` : 'No browser found'}. Changing these restarts the games.</div>
    <h3>Fine tuning</h3>
    <div class="row"><label>Extra top crop <input type="number" min="-4" max="12" data-input="titleCropAdjust" value="${st.titleCropAdjust}"> px</label>
      <span class="note">Increase if a sliver of title bar shows above a game.</span></div>
    <div class="row">
      <button data-act="resnap">Re-snap windows</button>
      <button data-act="restartBrowser">Restart browser</button>
      <button data-act="openLogs">Open log folder</button>
      <button data-act="resetSettings">Reset settings</button>
    </div>`;
}

function statsPanel(s: UiState): string {
  const st = s.stats;
  if (!st) return '<h2>Performance</h2><div class="note">Measuring…</div>';
  const per = st.perGame?.length
    ? `<h3>Per game</h3><div class="row">${st.perGame.map((g) => `<span class="stat"><span>Game ${g.number}</span><b>${g.cpuPercent.toFixed(0)}% · ${g.memoryMB.toFixed(0)} MB</b></span>`).join('')}</div>`
    : '';
  return `<h2>Performance <span class="note">(viewer's browser processes)</span></h2>
    <div class="row">
      <span class="stat"><span>CPU (all cores)</span><b>${st.cpuPercent.toFixed(0)}%</b></span>
      <span class="stat"><span>Memory</span><b>${st.memoryMB.toFixed(0)} MB</b></span>
      <span class="stat"><span>Processes</span><b>${st.processes}</b></span>
      ${st.gpu3dPercent !== null ? `<span class="stat"><span>GPU 3D</span><b>${st.gpu3dPercent.toFixed(0)}%</b></span>` : ''}
      ${st.gpuVideoDecodePercent !== null ? `<span class="stat"><span>GPU video decode</span><b>${st.gpuVideoDecodePercent.toFixed(0)}%</b></span>` : ''}
    </div>${per}
    ${st.warnings.map((w) => `<div class="warnline">⚠ ${esc(w)}</div>`).join('')}
    <div class="note">"GPU video decode" above 0% means the graphics card is decoding the streams (efficient). Some DRM streams are decoded inside the browser's protected media component instead, which shows as CPU.</div>`;
}

function helpPanel(s: UiState): string {
  return `<h2>Help</h2>
    <div class="note">Pick a game in each quadrant with YouTube TV's own guide (click into the quadrant), or use a game's <b>Live guide</b> button. Hover a game to use its player controls; the player's own full-screen button enlarges that game until you press Esc.</div>
    <div class="note">YouTube TV counts each quadrant as a stream. The base plan allows 3 at once; the 4K Plus add-on allows unlimited streams at home. If the 4th game shows a "too many streams" message, that is the account limit.</div>
    <h3>Keyboard shortcuts</h3>
    <table>${s.hotkeys.map((h) => `<tr><td><kbd>${esc(h.keys)}</kbd></td><td>${esc(h.action)}</td></tr>`).join('')}</table>`;
}

function renderPanel(s: UiState, force = false): void {
  // Don't rebuild the panel under the user's cursor while they are typing.
  const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text' && $panel.contains(document.activeElement);
  const key = panel + ':' + (panel === 'stats' ? JSON.stringify(s.stats) : JSON.stringify([s.settings, s.slots, s.layout, s.displays, s.displayId, s.audioScope, s.browser]));
  if (!force && (typing || key === renderedPanelKey)) return;
  renderedPanelKey = key;
  if (!panel) {
    $panel.innerHTML = '';
    return;
  }
  if (panel.startsWith('game-')) $panel.innerHTML = gamePanel(s, Number(panel.slice(5)) as SlotId);
  else if (panel === 'settings') $panel.innerHTML = settingsPanel(s);
  else if (panel === 'stats') $panel.innerHTML = statsPanel(s);
  else $panel.innerHTML = helpPanel(s);
}

function render(force = false): void {
  if (!state) return;
  renderBar(state);
  renderBanner(state);
  renderPanel(state, force);
  requestAnimationFrame(reportSize);
}

let lastSize = '';
function reportSize(): void {
  const r = $root.getBoundingClientRect();
  const size = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`;
  if (size === lastSize) return;
  lastSize = size;
  send({ type: 'toolbarSize', width: Math.ceil(r.width), height: Math.ceil(r.height) });
}

function setPanel(next: Panel | null): void {
  if (panel === 'stats' && next !== 'stats') send({ type: 'statsVisible', visible: false });
  panel = next;
  if (panel === 'stats') send({ type: 'statsVisible', visible: true });
  send({ type: 'toolbarPinned', pinned: panel !== null || pickingFirst });
  render(true);
}

// ---- events ------------------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || !state) return;
  const slot = Number(el.dataset.slot) as SlotId;
  switch (el.dataset.act) {
    case 'mode':
      return send({ type: 'setMode', mode: el.dataset.mode as LayoutMode });
    case 'chip':
      if (pickingFirst) {
        pickingFirst = false;
        return send({ type: 'beginSwap', slot });
      }
      if (state.swapFrom !== null) {
        if (state.swapFrom === slot) send({ type: 'cancelSwap' });
        else send({ type: 'swap', a: state.swapFrom, b: slot });
        return;
      }
      return setPanel(panel === `game-${slot}` ? null : `game-${slot}`);
    case 'swap':
      if (pickingFirst || state.swapFrom !== null) {
        pickingFirst = false;
        render();
        return send({ type: 'cancelSwap' });
      }
      pickingFirst = true;
      return setPanel(null);
    case 'swapWith':
      return send({ type: 'swap', a: Number(el.dataset.a) as SlotId, b: Number(el.dataset.b) as SlotId });
    case 'master':
      return send({ type: 'toggleMasterMute' });
    case 'fullscreen':
      return send({ type: 'toggleFullscreen' });
    case 'panel': {
      const p = el.dataset.panel as Panel;
      return setPanel(panel === p ? null : p);
    }
    case 'minimize':
      setPanel(null);
      return send({ type: 'minimize' });
    case 'quit':
      return send({ type: 'quit' });
    case 'banner':
      if (state.banner?.action) send(state.banner.action.command);
      return;
    case 'spotlight':
      return send({ type: 'spotlight', slot });
    case 'solo':
      return send({ type: 'toggleSolo', slot });
    case 'audioOnly':
      return send({ type: 'audioOnly', slot });
    case 'mute':
      return send({ type: 'toggleMute', slot });
    case 'activate':
      setPanel(null);
      return send({ type: 'activate', slot });
    case 'reload':
      return send({ type: 'reload', slot });
    case 'guide':
      return send({ type: 'guide', slot });
    case 'reopen':
      return send({ type: 'reopen', slot });
    case 'resnap':
    case 'restartBrowser':
    case 'openLogs':
    case 'resetSettings':
      return send({ type: el.dataset.act } as UiCommand);
  }
});

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (!state) return;
  const key = el.dataset.setting;
  if (key) {
    const checked = (el as HTMLInputElement).checked;
    if (key.startsWith('audio.')) {
      send({ type: 'updateSettings', patch: { audio: { ...state.settings.audio, [key.slice(6)]: checked } } });
    } else {
      send({ type: 'updateSettings', patch: { [key]: checked } as Partial<Settings> });
    }
    return;
  }
  switch (el.dataset.input) {
    case 'rename':
      return send({ type: 'rename', slot: Number(el.dataset.slot) as SlotId, name: el.value.trim() });
    case 'display':
      return send({ type: 'setDisplay', id: Number(el.value) });
    case 'gap':
      return send({ type: 'updateSettings', patch: { gap: Number(el.value) } });
    case 'titleCropAdjust':
      return send({ type: 'updateSettings', patch: { titleCropAdjust: Number(el.value) } });
    case 'browser':
      return send({ type: 'updateSettings', patch: { browser: el.value as Settings['browser'] } });
    case 'sessionMode':
      return send({ type: 'updateSettings', patch: { sessionMode: el.value as Settings['sessionMode'] } });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    pickingFirst = false;
    if (state?.swapFrom !== null) send({ type: 'cancelSwap' });
    setPanel(null);
  }
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.target.blur();
});

window.mgv.onState((s) => {
  state = s;
  render();
});
