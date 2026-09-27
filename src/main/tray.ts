import { Menu, Tray, nativeImage } from 'electron';
import * as path from 'node:path';
import type { UiCommand } from '../shared/types';

export function createTray(run: (cmd: UiCommand | 'showToolbar') => void): Tray {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  const tray = new Tray(icon);
  tray.setToolTip('MultiGame Viewer');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show controls', click: () => run('showToolbar') },
      { type: 'separator' },
      { label: '2×2 grid', click: () => run({ type: 'setMode', mode: 'grid' }) },
      { label: 'Spotlight', click: () => run({ type: 'setMode', mode: 'spotlight' }) },
      { label: 'Full screen on/off', click: () => run({ type: 'toggleFullscreen' }) },
      { label: 'Re-snap windows', click: () => run({ type: 'resnap' }) },
      { label: 'Minimize everything', click: () => run({ type: 'minimize' }) },
      { type: 'separator' },
      { label: 'Restart browser', click: () => run({ type: 'restartBrowser' }) },
      { label: 'Open log folder', click: () => run({ type: 'openLogs' }) },
      { type: 'separator' },
      { label: 'Exit', click: () => run({ type: 'quit' }) },
    ]),
  );
  tray.on('click', () => run('showToolbar'));
  return tray;
}
