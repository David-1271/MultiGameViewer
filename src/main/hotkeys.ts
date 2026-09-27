// Keyboard shortcuts. They are registered only while one of the viewer's windows (a game or
// the toolbar) is in the foreground, so they never steal keys from other applications.
import { globalShortcut } from 'electron';
import type { HotkeyView, SlotId, UiCommand } from '../shared/types';
import type { Logger } from './logger';

export interface Hotkey {
  accelerator: string;
  keys: string;
  action: string;
  command: UiCommand | 'cycleAudio' | 'toggleToolbar' | 'toggleLabels';
}

export function hotkeyTable(): Hotkey[] {
  const solo = ([0, 1, 2, 3] as SlotId[]).map<Hotkey>((s) => ({
    accelerator: `Control+Alt+${s + 1}`,
    keys: `Ctrl+Alt+${s + 1}`,
    action: `Solo game ${s + 1} (press again to return)`,
    command: { type: 'toggleSolo', slot: s },
  }));
  return [
    { accelerator: 'Control+Alt+G', keys: 'Ctrl+Alt+G', action: '2×2 grid', command: { type: 'setMode', mode: 'grid' } },
    { accelerator: 'Control+Alt+S', keys: 'Ctrl+Alt+S', action: 'Spotlight the focused game', command: { type: 'setMode', mode: 'spotlight' } },
    ...solo,
    { accelerator: 'Control+Alt+F', keys: 'Ctrl+Alt+F', action: 'Full screen on/off', command: { type: 'toggleFullscreen' } },
    { accelerator: 'Control+Alt+M', keys: 'Ctrl+Alt+M', action: 'Mute / unmute all', command: { type: 'toggleMasterMute' } },
    { accelerator: 'Control+Alt+A', keys: 'Ctrl+Alt+A', action: 'Audio to next game (separate mode)', command: 'cycleAudio' },
    { accelerator: 'Control+Alt+T', keys: 'Ctrl+Alt+T', action: 'Show / hide the toolbar', command: 'toggleToolbar' },
    { accelerator: 'Control+Alt+L', keys: 'Ctrl+Alt+L', action: 'Labels on/off', command: 'toggleLabels' },
    { accelerator: 'Control+Alt+R', keys: 'Ctrl+Alt+R', action: 'Re-snap all windows', command: { type: 'resnap' } },
    { accelerator: 'Control+Alt+H', keys: 'Ctrl+Alt+H', action: 'Minimize everything', command: { type: 'minimize' } },
  ];
}

export function hotkeyViews(): HotkeyView[] {
  return hotkeyTable().map((h) => ({ keys: h.keys, action: h.action }));
}

export class Hotkeys {
  private registered = false;

  constructor(
    private readonly run: (h: Hotkey) => void,
    private readonly log: Logger,
  ) {}

  setActive(active: boolean): void {
    if (active === this.registered) return;
    if (active) {
      for (const h of hotkeyTable()) {
        try {
          if (!globalShortcut.register(h.accelerator, () => this.run(h))) this.log.warn(`Hotkey ${h.keys} is in use by another app`);
        } catch (err) {
          this.log.warn(`Could not register ${h.keys}`, err);
        }
      }
    } else {
      globalShortcut.unregisterAll();
    }
    this.registered = active;
  }
}
