// Development aid (unpackaged builds only, and only with MGV_DEV_PIPE=1): a local named pipe
// that accepts the same JSON commands the toolbar sends, one per line, so end-to-end runs can be
// scripted. {"type":"state"} returns the current UI state. Default pipe permissions give other
// Windows users read-only access, so they cannot send commands.
import { app } from 'electron';
import * as net from 'node:net';
import type { UiCommand, UiState } from '../shared/types';
import type { Logger } from './logger';

export const DEV_PIPE = '\\\\.\\pipe\\multigame-viewer-dev';

export function startDevControl(run: (cmd: UiCommand) => void, state: () => UiState, log: Logger): net.Server | null {
  if (app.isPackaged || process.env.MGV_DEV_PIPE !== '1') return null; // never in release builds
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const cmd = JSON.parse(line) as UiCommand | { type: 'state' };
          if (cmd.type === 'state') sock.write(JSON.stringify(state()) + '\n');
          else {
            run(cmd as UiCommand);
            sock.write('{"ok":true}\n');
          }
        } catch (err) {
          sock.write(JSON.stringify({ ok: false, error: String(err) }) + '\n');
        }
      }
    });
    sock.on('error', () => undefined);
  });
  server.on('error', (err) => log.warn('Dev control pipe failed', err));
  server.listen(DEV_PIPE, () => log.warn(`Dev control pipe enabled at ${DEV_PIPE}`));
  return server;
}
