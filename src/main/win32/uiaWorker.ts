// Worker thread for UI Automation lookups (they are blocking cross-process calls).
import { parentPort } from 'node:worker_threads';
import { readDocumentUrl } from './uia';

parentPort?.on('message', (m: { id: number; hwnd: number }) => {
  let url: string | null = null;
  try {
    url = readDocumentUrl(m.hwnd);
  } catch {
    url = null;
  }
  parentPort?.postMessage({ id: m.id, url });
});
