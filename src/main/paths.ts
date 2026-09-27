import { app } from 'electron';
import * as path from 'node:path';
import type { SessionMode, SlotId } from '../shared/types';
import type { BrowserKind } from '../core/browsers';

export function appPaths() {
  const userData = app.getPath('userData');
  const local = process.env.LOCALAPPDATA || userData;
  return {
    settings: path.join(userData, 'settings.json'),
    logDir: path.join(userData, 'logs'),
    logFile: path.join(userData, 'logs', 'viewer.log'),
    profilesRoot: path.join(local, 'MultiGameViewer', 'profiles'),
  };
}

/**
 * Browser profile folder. The viewer uses its own profile(s), separate from the user's
 * everyday browser profile; the browser itself keeps the sign-in cookies there.
 * In "separate" mode game 1 reuses the shared profile so an existing sign-in carries over.
 */
export function profileDir(root: string, kind: BrowserKind, mode: SessionMode, slot: SlotId): string {
  if (mode === 'shared' || slot === 0) return path.join(root, kind, 'shared');
  return path.join(root, kind, `game-${slot + 1}`);
}
