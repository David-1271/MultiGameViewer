// Minimal bridge for the viewer's own UI pages (toolbar, backdrop). Sandboxed; exposes only
// "send a command" and "receive state".
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('mgv', {
  command(cmd: unknown): void {
    ipcRenderer.send('mgv:command', cmd);
  },
  onState(cb: (state: unknown) => void): void {
    ipcRenderer.on('mgv:state', (_e: IpcRendererEvent, state: unknown) => cb(state));
  },
});
