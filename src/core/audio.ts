// Pure audio-state transitions. The main process applies the result through the Windows
// audio-session API; nothing here touches the web page.
import type { SlotId } from '../shared/types';

export interface AudioState {
  muted: boolean[];
  masterMuted: boolean;
  exclusive: boolean;
  followFocus: boolean;
}

export function defaultAudio(): AudioState {
  // Four commentary tracks at once is noise; start with only game 1 audible.
  return { muted: [false, true, true, true], masterMuted: false, exclusive: true, followFocus: false };
}

export function normalizeAudio(raw: unknown): AudioState {
  const d = defaultAudio();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<AudioState>;
  const muted = Array.isArray(r.muted) && r.muted.length === 4 ? r.muted.map((m) => m === true) : d.muted;
  return {
    muted,
    masterMuted: typeof r.masterMuted === 'boolean' ? r.masterMuted : d.masterMuted,
    exclusive: typeof r.exclusive === 'boolean' ? r.exclusive : d.exclusive,
    followFocus: typeof r.followFocus === 'boolean' ? r.followFocus : d.followFocus,
  };
}

export function audioOnly(a: AudioState, slot: SlotId): AudioState {
  return { ...a, muted: a.muted.map((_, i) => i !== slot) };
}

export function toggleMute(a: AudioState, slot: SlotId): AudioState {
  if (a.muted[slot]) {
    if (a.exclusive) return audioOnly(a, slot);
    return { ...a, muted: a.muted.map((m, i) => (i === slot ? false : m)) };
  }
  return { ...a, muted: a.muted.map((m, i) => (i === slot ? true : m)) };
}

/** Called when a game window becomes the foreground window. */
export function onGameFocused(a: AudioState, slot: SlotId): AudioState {
  return a.followFocus ? audioOnly(a, slot) : a;
}

/** Cycle the single audible game to the next one (hotkey). */
export function cycleAudio(a: AudioState): AudioState {
  const current = a.muted.findIndex((m) => !m);
  const next = ((current + 1) % 4) as SlotId;
  return audioOnly(a, next);
}

export function toggleMaster(a: AudioState): AudioState {
  return { ...a, masterMuted: !a.masterMuted };
}

/** Effective mute for a game: master mute wins, otherwise the per-game state. */
export function effectiveMuted(a: AudioState, slot: SlotId): boolean {
  return a.masterMuted || a.muted[slot];
}
