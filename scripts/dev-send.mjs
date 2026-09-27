// Send one command to a running viewer started with MGV_DEV_PIPE=1, print the reply.
// Usage: node scripts/dev-send.mjs '{"type":"setMode","mode":"grid"}'
import net from 'node:net';

const PIPE = String.raw`\\.\pipe\multigame-viewer-dev`;
const sock = net.connect(PIPE, () => sock.write((process.argv[2] ?? '{"type":"state"}') + '\n'));
sock.on('data', (d) => {
  process.stdout.write(d.toString());
  sock.end();
});
sock.on('error', (e) => {
  console.error('viewer not reachable:', e.message);
  process.exit(1);
});
