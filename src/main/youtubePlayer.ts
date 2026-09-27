// Serves the one-page YouTube player (see core/links.ts) on 127.0.0.1. YouTube's embed player
// refuses to run as a bare top-level page, so it needs a real page to live in; this is that
// page. Loopback only, a single route, strictly validated parameters.
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { playerPageHtml, playerQuery, targetFromPlayerQuery, type YouTubeTarget } from '../core/links';
import type { Logger } from './logger';

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
  'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
  "style-src 'unsafe-inline'",
  'img-src https: data:',
].join('; ');

export class YouTubePlayerServer {
  private server: http.Server | null = null;
  private port = 0;

  constructor(private readonly log: Logger) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on('error', (err) => {
        this.log.warn('YouTube player page server failed; YouTube links will open as normal pages', err);
        resolve();
      });
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        this.log.info(`YouTube player page on 127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  get available(): boolean {
    return this.port !== 0;
  }

  urlFor(t: YouTubeTarget): string {
    return `http://127.0.0.1:${this.port}/player?${playerQuery(t)}`;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Reject anything that isn't addressed to us directly (guards against DNS rebinding).
    if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${this.port}`) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const target = url.pathname === '/player' ? targetFromPlayerQuery(url.searchParams) : null;
    if (!target) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP,
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(playerPageHtml(target));
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = 0;
  }
}
