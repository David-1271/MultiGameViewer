// Locating an installed Chromium browser with a production Widevine CDM (Chrome or Edge) and
// building the command line. The flags are deliberately ordinary: no remote debugging, no
// automation switches, nothing that changes how sites see the browser.
import * as path from 'node:path';
import type { BrowserChoice } from '../shared/types';

export type BrowserKind = 'chrome' | 'edge' | 'custom';

export interface BrowserInstall {
  kind: BrowserKind;
  name: string;
  exe: string;
  version: string;
}

export interface FsProbe {
  exists(p: string): boolean;
  readdir(p: string): string[];
}

export function candidatePaths(env: Record<string, string | undefined>): { kind: 'chrome' | 'edge'; exe: string }[] {
  const pf = env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = env['LOCALAPPDATA'] ?? '';
  const list: { kind: 'chrome' | 'edge'; exe: string }[] = [
    { kind: 'chrome', exe: path.win32.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { kind: 'chrome', exe: path.win32.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
  ];
  if (local) list.push({ kind: 'chrome', exe: path.win32.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') });
  list.push(
    { kind: 'edge', exe: path.win32.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { kind: 'edge', exe: path.win32.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
  );
  return list;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Chrome and Edge keep version-named folders next to the executable; the highest is current. */
export function detectVersion(exe: string, probe: FsProbe): string {
  try {
    const versions = probe.readdir(path.win32.dirname(exe)).filter((n) => /^\d+(\.\d+){3}$/.test(n));
    versions.sort(compareVersions);
    return versions.at(-1) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const NAMES: Record<BrowserKind, string> = { chrome: 'Google Chrome', edge: 'Microsoft Edge', custom: 'Custom browser' };

export function locateBrowser(
  choice: BrowserChoice,
  customPath: string,
  env: Record<string, string | undefined>,
  probe: FsProbe,
): BrowserInstall | null {
  if (customPath) {
    if (!probe.exists(customPath)) return null;
    const lower = customPath.toLowerCase();
    const kind: BrowserKind = lower.endsWith('chrome.exe') ? 'chrome' : lower.endsWith('msedge.exe') ? 'edge' : 'custom';
    return { kind, name: NAMES[kind], exe: customPath, version: detectVersion(customPath, probe) };
  }
  const candidates = candidatePaths(env).filter((c) => choice === 'auto' || c.kind === choice);
  // Auto prefers Chrome (Google's own Widevine build), then Edge (always present on Windows 11).
  for (const c of candidates) {
    if (probe.exists(c.exe)) return { kind: c.kind, name: NAMES[c.kind], exe: c.exe, version: detectVersion(c.exe, probe) };
  }
  return null;
}

export function browserKey(b: BrowserInstall): string {
  return `${b.kind}@${b.version}`;
}

/**
 * Flags for every launch. The first launch starts the browser; later ones hand off to it.
 *
 * Deliberately NOT used: --disable-direct-composition. It would let the window clip region
 * hide title bars, but it also turns off the capture-protected presentation Chrome uses for
 * DRM video, i.e. it weakens content protection. Title bars are hidden by stacking instead.
 */
export function launchArgs(userDataDir: string, appUrl: string): string[] {
  return [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Keep games hidden behind a "solo" game playing live instead of being suspended.
    '--disable-background-media-suspend',
    '--hide-crash-restore-bubble',
    `--app=${appUrl}`,
  ];
}

/** Argument that identifies processes belonging to one of our profiles. */
export function userDataDirMatches(commandLine: string, userDataDir: string): boolean {
  const norm = (s: string) => s.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const m = /--user-data-dir=(?:"([^"]+)"|(\S+))/i.exec(commandLine);
  if (!m) return false;
  return norm(m[1] ?? m[2]) === norm(userDataDir);
}

/** Chromium child processes carry --type=...; the browser process does not. */
export function processTypeOf(commandLine: string): string {
  const t = /--type=(\S+)/.exec(commandLine);
  if (!t) return 'browser';
  if (t[1] === 'utility') {
    const sub = /--utility-sub-type=(\S+)/.exec(commandLine);
    return sub ? `utility:${sub[1]}` : 'utility';
  }
  return t[1];
}
