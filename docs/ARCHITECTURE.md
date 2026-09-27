# Architecture and feasibility findings

This document records what was tested before and during the build, why the design looks the
way it does, and how the pieces fit together. All measurements were taken on Windows 11
(build 26200) with Chrome 153, Edge 154, Electron 44, a 2560×1440 primary and a 1920×1080
secondary monitor, both at 125% scaling.

`npm run probe` repeats the key checks on any machine.

## 1. Feasibility: what YouTube TV allows

| Question | Finding | Evidence |
|---|---|---|
| Can tv.youtube.com be framed (iframe)? | **No.** | Response headers carry `X-Frame-Options: SAMEORIGIN`. A test iframe in Chrome rendered `chrome-error://chromewebdata/` ("tv.youtube.com refused to connect"). |
| Can an embedded engine (Electron, CEF, WebView2) play it? | **Not legitimately.** | Stock Electron 44: `requestMediaKeySystemAccess('com.widevine.alpha')` → `NotSupportedError` (no Widevine CDM). castLabs' Electron fork adds Widevine, but premium services require a VMP-signed production build. |
| Does Google sign-in work in embedded browsers? | **No.** | Google blocks sign-in from embedded webviews ("This browser or app may not be secure"). This is documented for Electron, CEF and WebView2. |
| Does DRM work in the real browsers? | **Yes.** | Chrome and Edge ship a production Widevine CDM. `requestMediaKeySystemAccess` succeeds, and a public Widevine test stream played in all four quadrants at once. |
| Can the browser be scripted via the DevTools protocol? | **Technically yes, but it isn't acceptable.** | `--remote-debugging-pipe` and `--remote-debugging-port` both set `navigator.webdriver = true`, which is the signal Google uses to refuse sign-in. Hiding that flag would mean evading a security check, so the viewer uses no DevTools protocol at all. A plain launch reports `webdriver=false`. |
| Simultaneous streams? | **Base plan: 3. 4K Plus: unlimited at home.** | YouTube TV help: the 4K Plus add-on (and NFL Sunday Ticket) remove the limit on the home Wi-Fi network. Each quadrant is a separate stream, so the 4th game on a base plan will likely hit the limit. |
| Official multiview on PCs? | **Not in web browsers** (as of mid-2026). | YouTube TV Multiview is available on TV devices; browsers get only occasional pre-built multiview feeds. |

**Conclusion:** use four ordinary Chrome/Edge windows and make them look like one purpose-built
screen by OS-level window management. Nothing is embedded, injected, scripted or bypassed.

## 2. Options considered

| Option | Verdict |
|---|---|
| A. One page with four iframes (web app or extension) | Impossible without stripping `X-Frame-Options`, which defeats a site security control. Rejected. |
| B. Embedded browser app: Electron/CEF/WebView2 hosting four views | No Widevine (or needs licensed VMP signing), and Google sign-in is blocked. Rejected. |
| C. Real browser + DevTools protocol automation (Puppeteer-style) | Would make mute/reload easy, but flags the browser as automated (`navigator.webdriver`), which is incompatible with Google sign-in and with the "no circumvention" rule. Rejected. |
| D. Real browser + browser extension for control | Workable, but branded Chrome no longer allows `--load-extension`, so the user would have to sideload in developer mode. Deferred (see future work). |
| **E. Real browser app windows + native window manager (chosen)** | The browser stays exactly what the user would run anyway. The controller only moves, stacks and clips windows, and uses the Windows mixer for audio. |

### Controller technology

The controller's jobs are Win32 window management, a small overlay UI, global hotkeys, a
tray icon, monitor/DPI handling and packaging.

* **Electron + TypeScript + koffi (chosen).** Electron supplies the display/DPI APIs,
  shortcuts, tray and a tiny HTML toolbar. [koffi](https://koffi.dev) is a prebuilt FFI (no
  native compiler needed) for the Win32/COM calls. Hardware acceleration is disabled in the
  controller, so it never competes with the video streams for the GPU. Measured cost is about
  187 MB RAM across 5 processes with idle CPU near 0. No video passes through Electron.
* .NET/WPF: equally capable natively and lighter, but more effort for the UI and packaging.
  A good future port if the controller's memory matters.
* Tauri: WebView2 UI and Rust Win32; similar result, more toolchain.
* Plain Node + koffi, with the UI hosted in the same Chrome instance: one fewer Chromium,
  but needs a hand-built message loop and native tray and hotkeys. Considered, not chosen.

## 3. How it works

```
 ┌────────────────────── Electron controller (no video) ───────────────────────┐
 │ controller.ts  layout state, watchdog, recovery, commands                   │
 │ core/*         pure logic: geometry, stacking, displays, settings, audio    │
 │ win32/*        koffi: windows, regions, z-order, processes, audio, GPU      │
 │ ui/overlays    backdrop · auto-hide toolbar · labels (one renderer shared)  │
 └──────────────┬───────────────────────────────────────────┬──────────────────┘
                │ spawn chrome.exe --app=… (plain flags)     │ SetWindowPos / SetWindowRgn /
                ▼                                            ▼ Core Audio / perf counters
      ┌──────────────── Google Chrome (or Edge), dedicated profile ─────────────┐
      │  4 app windows (no tabs/address bar) · one browser process · one sign-in │
      └─────────────────────────────────────────────────────────────────────────┘
```

### Launching

* A dedicated profile lives at `%LOCALAPPDATA%\MultiGameViewer\profiles\<browser>\shared`.
  The browser itself stores the sign-in cookies there; the viewer never reads or stores
  credentials.
* The first `chrome.exe --user-data-dir=… --app=URL` starts the browser. Each later one hands
  off to the running instance (Chromium's normal process singleton), so all four windows share
  one browser process and one sign-in.
* Flags: `--no-first-run --no-default-browser-check --hide-crash-restore-bubble
  --disable-background-media-suspend` (the last keeps games hidden behind a Solo game
  playing live). That's all.
* Browser processes are identified by reading process command lines
  (`NtQueryInformationProcess`) and matching `--user-data-dir`. New windows are found by
  diffing the profile's top-level windows before and after each launch.

### Making four browser windows look like one screen

An app window still has a title bar (30 DIP in Chrome 153 and Edge 154) plus invisible resize
borders. The viewer:

1. **Calibrates** once per browser version. A local `data:` page writes its viewport size
   into `document.title`; comparing that with the client area (`GetWindowText` /
   `GetClientRect`) yields the title-bar height. Nothing is injected into YouTube TV.
2. **Places** each window larger than its quadrant (`core/frame.ts`,
   `core/geometry.ts#expandByInsets`) so the *web content* lands exactly on the quadrant.
3. **Stacks** the windows (`core/stacking.ts`). Top-row title bars sit above the screen's top
   edge. Every lower row is stacked *under* the row above, so its title bar is covered by the
   game above it. A Solo (or page-fullscreen) game goes on top. A WinEvent hook re-stacks the
   instant you click a game.
4. **Clips** hit-testing with `SetWindowRgn`, so the invisible resize borders don't intercept
   clicks meant for neighbours. Chrome's GPU-composited output is *not* clipped by window
   regions; that's why step 3 exists.
5. **Masks gaps.** With a gap configured, tiny native black windows (`win32/masks.ts`) cover
   the strips where a tucked-away title bar would otherwise show.
6. **Blackens the 1 px frame edge.** The browser paints a 1 px frame edge beside its content;
   Windows 11 draws its border line over it, so `DWMWA_BORDER_COLOR` is set to black. With no
   gap, games are separated by a 1 px black hairline. That's the smallest seam achievable
   without changing how the browser renders.

**Considered and rejected: `--disable-direct-composition`.** With it, window regions clip the
browser's output exactly (no title-bar tricks needed). But it also disables the
capture-protected presentation Chrome uses for DRM video: DRM frames became capturable in
screenshots, whereas normally they appear black. That weakens content protection, so it is
not used.

### Audio

Chromium plays all of a browser's audio from one "audio service" process, which Windows sees
as one mixer session.

* **Shared mode (default)** has one browser, so the viewer offers a *master* mute. Per-game
  mute uses YouTube TV's own speaker button in each quadrant.
* **Separate mode** runs one browser (and profile) per game, so each game gets its own
  session. The toolbar can then mute, unmute or solo audio per game through Core Audio
  (`ISimpleAudioVolume`), the same mechanism as the Windows Volume Mixer. The cost is a
  one-time sign-in per game and roughly 4× the browser overhead.

The viewer only touches sessions belonging to its own browser processes, and applies a state
only when it changes or a session is new, so it never fights changes you make in the Volume
Mixer.

### Monitors and DPI

The controller is per-monitor-DPI aware. Layout is computed in physical pixels from the exact
Win32 monitor and work-area rectangles. When a window crosses monitors with different scaling,
the placer lets the browser adopt the new DPI first and then places it precisely. The chosen
monitor is remembered by id and by position; if it disappears, the layout falls back to the
primary monitor.

### Error handling

| Situation | Behaviour |
|---|---|
| Not signed in | First run opens one full-size window with a "Sign in, then Continue" banner. Windows whose title looks like a Google sign-in page get a "Sign in required" label. |
| A game window is closed | Its quadrant shows a placeholder with **Reopen** / **Open live guide**. The others are untouched. |
| The browser crashes | Detected from its exit code (the viewer holds a handle to the browser process). Games restart automatically (max 3 times in 5 minutes), then it asks. In Separate mode only the affected game restarts. |
| A window hangs | `IsHungAppWindow` → "Not responding" label. All window calls are async or guarded, so a hung browser can't freeze the controller. |
| Network lost / restored | Banner. YouTube TV reconnects by itself, and **Reload all** is offered. |
| Stream fails / no permission / too many streams | YouTube TV shows its own message in that quadrant; the others keep playing. |
| YouTube TV changes its page | Nothing to break: the viewer never reads or modifies page content. |
| Page goes fullscreen (player button) | Detected; the viewer steps aside and re-snaps when you press Esc. |
| No Chrome/Edge, or hardware acceleration off | Startup dialog / Stats-panel warning. |
| Monitor unplugged, DPI or taskbar changes | Re-layout on the fallback monitor. |
| Viewer itself crashes | Next start adopts the still-running game windows instead of opening duplicates. |

### Security and privacy

* No passwords, cookies or tokens are read or stored. Sign-in happens only in the real browser.
* No DevTools protocol, no extensions, no page scripting, no header stripping, and no
  capture of video.
* The viewer's own pages are sandboxed with a strict CSP. Only `https:` URLs are accepted as
  start/guide URLs.
* The dev control pipe (`MGV_DEV_PIPE=1`) exists only in unpackaged development builds.

## 4. Performance

Measured with the four signed-out welcome-page videos playing: the viewer's browser used
~1.1 GB RAM and ~1% CPU, with 26% on the GPU's *video decode* engine (hardware decoding
confirmed). The Widevine DRM test stream was decoded without the GPU decode engine in both
configurations tested, so some DRM streams cost CPU instead.

Rough guidance for four live 1080p games:

* A 4-core CPU from the last ~6 years. With hardware decode the CPU mostly idles; without it,
  expect 4 streams to need a strong 6–8-core CPU.
* A GPU with H.264/VP9 hardware decode (Intel UHD 620+, any AMD/NVIDIA from ~2016+).
* 8 GB RAM minimum, 16 GB comfortable.
* Network: ~7 Mbps per HD stream (YouTube TV's guidance), so **30+ Mbps** for four.

The Performance panel shows the viewer's CPU, memory, GPU 3D and GPU video-decode usage.
