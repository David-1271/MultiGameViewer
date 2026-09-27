// System event hook (the accessibility "WinEvent" API): lets us react the instant another
// window is activated or minimized instead of waiting for the next poll. Out-of-context hooks
// are delivered through the hooking thread's message loop, which Electron's main thread runs.
import koffi from 'koffi';
import { W, WinEventProc } from './native';

export const EVENT_SYSTEM_FOREGROUND = 0x0003;
export const EVENT_SYSTEM_MINIMIZESTART = 0x0016;
export const EVENT_SYSTEM_MINIMIZEEND = 0x0017;
const WINEVENT_OUTOFCONTEXT = 0x0000;
const WINEVENT_SKIPOWNPROCESS = 0x0002;

export function watchWinEvents(onEvent: (event: number, hwnd: number) => void): () => void {
  const cb = koffi.register((_hook: number, event: number, hwnd: number, idObject: number) => {
    if (idObject === 0) onEvent(event, hwnd); // OBJID_WINDOW only
  }, koffi.pointer(WinEventProc));
  const flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
  const hooks = [
    W.SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, 0, cb, 0, 0, flags),
    W.SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, 0, cb, 0, 0, flags),
  ].filter((h) => h);
  return () => {
    for (const h of hooks) W.UnhookWinEvent(h);
    koffi.unregister(cb);
  };
}
