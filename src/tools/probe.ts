// Feasibility probe: re-checks, on this machine, the constraints that drove the architecture.
// Run with `npm run probe`. Uses throwaway browser profiles; never signs in to anything.
//
//  1. tv.youtube.com refuses to be framed (X-Frame-Options / CSP)      -> no iframes
//  2. Stock Electron has no Widevine CDM                              -> no embedded player
//  3. A supported browser (Chrome/Edge) is installed                  -> real browser windows
//  4. navigator.webdriver: plain launch vs. debug-controlled launch   -> no DevTools protocol
import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchArgs, locateBrowser } from '../core/browsers';
import { findBrowserProcesses, processTree, snapshotProcesses, terminateProcess } from '../main/win32/processes';
import { appWindowsOf, windowTitle } from '../main/win32/windows';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { check: string; result: string; ok: boolean }[] = [];
const report = (check: string, ok: boolean, result: string) => {
  results.push({ check, ok, result });
  console.log(`${ok ? 'PASS' : 'NOTE'}  ${check}\n      ${result}`);
};

function headers(url: string): Promise<Record<string, string | string[] | undefined>> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153 Safari/537.36' } }, (res) => {
      res.resume();
      resolve(res.headers);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

async function checkFraming(): Promise<void> {
  try {
    const h = await headers('https://tv.youtube.com/');
    const xfo = String(h['x-frame-options'] ?? 'none');
    const csp = ([] as string[]).concat(h['content-security-policy'] ?? []).join(' ');
    const fa = /frame-ancestors[^;]*/.exec(csp)?.[0] ?? 'none';
    report('tv.youtube.com can be embedded in an iframe', false, `X-Frame-Options: ${xfo}; CSP frame-ancestors: ${fa} -> browsers refuse to render it in a frame`);
  } catch (err) {
    report('tv.youtube.com response headers', false, `request failed: ${(err as Error).message}`);
  }
}

async function checkElectronWidevine(): Promise<void> {
  const w = new BrowserWindow({ show: false });
  try {
    await w.loadURL('https://example.com/');
    const r = await w.webContents.executeJavaScript(
      `navigator.requestMediaKeySystemAccess('com.widevine.alpha',[{initDataTypes:['cenc'],videoCapabilities:[{contentType:'video/mp4; codecs="avc1.42E01E"'}]}]).then(()=>'supported').catch(e=>'unsupported ('+e.name+')')`,
    );
    report('Widevine DRM inside stock Electron', r === 'supported', `Electron ${process.versions.electron}: ${r}`);
  } catch (err) {
    report('Widevine DRM inside stock Electron', false, `could not test: ${(err as Error).message}`);
  } finally {
    w.destroy();
  }
}

/** Launch the browser at a local page that reports navigator.webdriver in its title. */
async function webdriverFlag(exe: string, extra: string[], pipe: boolean): Promise<string> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mgv-probe-'));
  const page = 'data:text/html,' + encodeURIComponent('<script>document.title="webdriver="+navigator.webdriver</script>');
  const child = spawn(exe, [...extra, ...launchArgs(profile, page)], { stdio: pipe ? ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] : 'ignore', detached: !pipe });
  if (!pipe) child.unref();
  let title = 'no window';
  try {
    for (let i = 0; i < 50 && title === 'no window'; i++) {
      await sleep(200);
      const procs = snapshotProcesses();
      const pid = findBrowserProcesses(procs, path.win32.basename(exe), profile)[0];
      if (pid) title = appWindowsOf(new Set([pid])).map(windowTitle).find((t) => t.startsWith('webdriver=')) ?? 'no window';
    }
  } finally {
    const procs = snapshotProcesses();
    for (const pid of findBrowserProcesses(procs, path.win32.basename(exe), profile)) for (const p of processTree(procs, pid).reverse()) terminateProcess(p.pid);
    await sleep(800);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
  return title;
}

async function main(): Promise<void> {
  console.log('MultiGame Viewer feasibility probe\n');
  await checkFraming();
  await checkElectronWidevine();
  const browser = locateBrowser('auto', '', process.env, { exists: (p) => fs.existsSync(p), readdir: (p) => fs.readdirSync(p) });
  report('Installed Widevine-capable browser (Chrome or Edge)', !!browser, browser ? `${browser.name} ${browser.version} at ${browser.exe}` : 'none found');
  if (browser) {
    const plain = await webdriverFlag(browser.exe, [], false);
    report('Plain launch looks like a normal user browser', plain === 'webdriver=false', plain);
    const debug = await webdriverFlag(browser.exe, ['--remote-debugging-pipe'], true);
    report('DevTools-protocol launch is flagged as automation (why the viewer never uses it)', debug === 'webdriver=true', debug);
  }
  const out = path.join(os.tmpdir(), 'multigame-viewer-probe.json');
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`\nSaved ${out}`);
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {
  /* keep running until all checks finish */
});
app.whenReady().then(main).catch((e) => console.error(e)).finally(() => app.quit());
