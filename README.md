# MultiGame Viewer

Watch four YouTube TV games (or regular YouTube videos and live streams) at once on one Windows monitor, in a clean 2×2 grid where each game
fills exactly one quarter of the screen. There are no tabs, address bars or title bars between
them.

```
+-------------------+-------------------+
|      Game 1       |      Game 2       |
+-------------------+-------------------+
|      Game 3       |      Game 4       |
+-------------------+-------------------+
```

YouTube TV can't be embedded (it refuses iframes, and embedded browsers have neither DRM nor
Google sign-in). So MultiGame Viewer uses **four ordinary Google Chrome (or Microsoft Edge)
windows** and arranges them with Windows window management. Playback, DRM and sign-in are the
browser's own; the viewer never touches the video, the page or your credentials. The
reasoning and test results are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Features

* **2×2 grid** that adapts to any resolution, aspect ratio, DPI scaling and monitor.
  1920×1080 gives four 960×540 games; with a 40 px taskbar, 960×520.
* **Spotlight**: one game large (¾ width), the other three stacked beside it.
* **Solo**: one game fills the screen while the others keep playing behind it; press again to
  go back. The player's own full-screen button also works; press Esc to return.
* **Regular YouTube too:** paste any YouTube link (video, live stream, Shorts, playlist) into a
  quadrant. It plays in a player-only view that fills the tile, and mixes freely with YouTube TV.
* **Swap** any two games, **rename** them, optional **labels** and **gaps**.
* **Full-screen mode** covers the taskbar. **Minimize/restore** all four together.
* **Monitor picker** for multi-monitor setups; remembers layout, monitor and names.
* **Audio**: master mute; in *Separate sessions* mode, per-game mute, "only this game" and
  audio that follows the clicked game.
* **Auto-hiding toolbar**: touch the top edge of the screen. Keyboard shortcuts and a tray menu.
* **Recovery**: a closed game shows a Reopen button; a crashed browser restarts itself; one
  failing game never takes the others down.
* **Performance panel** with CPU, memory, GPU and GPU video-decode usage.

## Requirements

* Windows 10 or 11 (64-bit). Windows 11 gives the cleanest seams.
* **Google Chrome** or **Microsoft Edge** installed (Edge ships with Windows 11).
* A YouTube TV subscription. **Four simultaneous streams need the 4K Plus add-on** (unlimited
  streams at home); the base plan allows 3.
* Hardware: see [Performance](docs/ARCHITECTURE.md#4-performance). In short: a GPU with
  hardware video decode, 8–16 GB RAM and 30+ Mbps internet.

## Install and run

### From a release build

Run `MultiGame Viewer Setup 0.1.0.exe` (installer) or `MultiGame Viewer 0.1.0.exe` (portable).
Both are produced by `npm run dist` into `release/`. They are unsigned, so Windows SmartScreen
may ask for confirmation.

### From source

Prerequisites: Node.js 22+ (24 recommended) and npm.

```bash
npm install
```

```bash
npm start
```

`npm start` compiles TypeScript into `dist/` and launches the viewer with Electron.

## Using it with YouTube TV

1. **First launch:** one large window opens on YouTube TV. Sign in normally (Google's own
   sign-in page, including 2-step verification). Once the YouTube TV home screen appears,
   click **Continue → open all four games** in the banner at the top.
2. Four games appear in a 2×2 grid. Click into a quadrant and pick a game from YouTube TV's
   guide, or use that game's **Live guide** button in the toolbar.
3. Sign-in is remembered by the browser in the viewer's own profile, so next time the four
   windows open directly.
4. Move the mouse to the **top edge** of the screen to show the toolbar:
   * `2×2`, `Spotlight`, `Solo`: layouts. Click a **game chip** (1–4) for its menu: label,
     spotlight/solo, swap with…, audio, Focus, Reload, Live guide, Reopen.
   * `Swap`: click two games to exchange their positions.
   * Speaker: mute or unmute everything. Full-screen, Settings, Performance, Help, Minimize,
     Exit.
5. **Exit** closes the four game windows too. Next launch restores layout, monitor, labels and
   audio settings.

### Watching regular YouTube

1. Show the toolbar and click a game's chip (1–4).
2. Under **Watch**, paste a link and press **Enter** (or **Open**). Any of these work:
   `youtube.com/watch?v=…`, `youtu.be/…`, `/live/…`, `/shorts/…`, playlists, a start time
   (`?t=90`), or just the 11-character video ID.
3. The video plays in a **player-only view**, with no YouTube page around it. Links to
   channels, search results or the YouTube home page open as normal pages.
4. **Browsing works too:** open **YouTube** in a quadrant, click any video, and the tile switches
   to the player-only view by itself about a second later. The video restarts from the beginning
   when it switches. **Fill tile** (Ctrl+Alt+V) does it on demand, and Settings can turn the
   automatic switch off.
5. The quadrant remembers its link and reopens it next time. **YouTube TV**, **Live guide** and
   **YouTube** switch the quadrant back to a home page.

Notes:

* **Autoplay:** if Chrome won't autoplay with sound (it often blocks sound until you've
  interacted with the site), the video starts **muted**. Click the player's speaker to unmute.
* **Embedding blocked:** some owners don't allow their videos to be embedded. Those switch to
  the normal YouTube watch page automatically. **Open on YouTube page** does that on purpose,
  for example to see live chat.
* **Sign-in:** public videos need none. For members-only or Premium, sign in on youtube.com in
  any quadrant; it's the same Google sign-in as YouTube TV.
* To make new games open YouTube instead of YouTube TV, set Settings → **New games open**:
  YouTube. That also skips the first-run YouTube TV sign-in step.

### Keyboard shortcuts

These are active only while a game or the toolbar has focus, so they never steal keys from
other apps.

| Keys | Action |
|---|---|
| Ctrl+Alt+G | 2×2 grid |
| Ctrl+Alt+S | Spotlight the focused game |
| Ctrl+Alt+1…4 | Solo game 1…4 (again = back) |
| Ctrl+Alt+F | Full screen on/off |
| Ctrl+Alt+M | Mute/unmute all |
| Ctrl+Alt+A | Audio to next game (Separate sessions) |
| Ctrl+Alt+T | Show/hide toolbar |
| Ctrl+Alt+L | Labels on/off |
| Ctrl+Alt+R | Re-snap windows |
| Ctrl+Alt+V | Fill the focused tile with its YouTube video (player-only view) |
| Ctrl+Alt+H | Minimize everything |

If another app already owns a shortcut, it's skipped and noted in the log.

### Settings

* **Sessions**
  * *Shared* (default): one browser and one sign-in; lowest resource use. Windows sees one
    audio stream, so per-game mute uses each game's own speaker button.
  * *Separate*: one browser per game; the toolbar can mute and solo each game's audio.
    Sign in once per game (each is remembered). About 4× the browser overhead.
* **Browser**: Auto (Chrome, then Edge), Chrome, or Edge.
* **New games open**: YouTube TV or YouTube, for games without a pasted link.
* **Play YouTube videos in a player-only view**: turn off to always use the full watch page.
* **Fill the tile when you pick a YouTube video**: automatic switch after you click a video on a
  YouTube page.
* **Gap between games**: 0 = seamless.
* **Extra top crop**: raise it if a sliver of title bar ever shows above a game.
* **Keep games snapped**: puts windows back if something moves them.

Settings live in `%APPDATA%\MultiGame Viewer\settings.json`, logs in
`%APPDATA%\MultiGame Viewer\logs\`, and browser profiles in
`%LOCALAPPDATA%\MultiGameViewer\profiles\`.

## Development

| Command | What it does |
|---|---|
| `npm run build` | Compile main/core (CommonJS) and renderer (ES modules) into `dist/`, copy HTML/CSS/icons |
| `npm start` | Build and run |
| `npm test` | Build and run the unit tests (Node's built-in test runner) |
| `npm run typecheck` | Type-check both TypeScript projects |
| `npm run probe` | Re-run the feasibility checks on this machine (framing headers, Electron Widevine, browser detection, automation flag) |
| `npm run dist` | Package an NSIS installer and a portable exe into `release/` |

Debugging aids for unpackaged builds only:

* `MGV_DEBUG=1` enables verbose logging.
* `MGV_DEV_PIPE=1` opens a local named pipe that accepts the same JSON commands as the
  toolbar, for scripted end-to-end runs:

```bash
node scripts/dev-send.mjs '{"type":"setMode","mode":"spotlight"}'
```

### Project structure

```
src/
  shared/types.d.ts        Types shared by main process and UI pages
  core/                    Pure, unit-tested logic (no Electron/Win32)
    geometry.ts            Grid/spotlight/solo rectangles, gap masks, inset math
    stacking.ts            Z-order policy (how title bars stay hidden)
    layout.ts audio.ts     Layout and audio state transitions
    displays.ts            Monitor choice, physical work area
    frame.ts               Title-bar calibration and window insets
    settings.ts            Schema, validation, atomic persistence
    browsers.ts titles.ts  Browser discovery/launch flags; window-title helpers
    links.ts               Parsing pasted links; the YouTube player page
  main/
    main.ts controller.ts  Entry point; orchestration, watchdog, recovery, commands
    placer.ts              Places a browser window so its content fills a quadrant
    youtubePlayer.ts       Serves the player page on 127.0.0.1 (loopback only)
    browser/host.ts        Launch/hand-off, window discovery, crash detection, shutdown
    win32/                 koffi bindings: windows, processes, Core Audio, GPU counters,
                           WinEvent hook, native gap masks
    ui/overlays.ts         Backdrop, toolbar, labels
    hotkeys.ts tray.ts logger.ts paths.ts devControl.ts
  preload/preload.ts       Minimal sandboxed bridge for the UI pages
  renderer/                Toolbar and backdrop pages (HTML/CSS/TS, no framework)
  test/                    Unit tests
  tools/probe.ts           Feasibility probe
docs/ARCHITECTURE.md       Feasibility findings, options, design, error handling
scripts/                   build.mjs, dev-send.mjs, make-icon.ps1
```

Runtime dependency: `koffi` (prebuilt FFI). Dev dependencies: `electron`, `typescript`,
`@types/node`, `electron-builder`.

## Known limitations

* **Stream limit:** the base YouTube TV plan allows 3 streams, so the 4th game shows YouTube
  TV's "too many streams" message unless you have 4K Plus (at home).
* **1 px seams:** with the gap at 0, games are separated by a 1-pixel black line. The browser
  paints a 1 px frame edge that can't be hidden without weakening its DRM presentation (see
  architecture doc).
* **Monitor stacked above the layout monitor:** top-row title bars sit just above the top
  edge, so they can show as a thin strip at the bottom of a monitor placed directly above.
* **After a game uses the player's full-screen button,** its window's 9 px edges may show
  resize cursors over neighbours (Chrome stops accepting the clip region). **Reopen** that game
  to reset it.
* **Per-game audio needs Separate sessions** (one browser per game). In Shared mode only a
  master mute is available from the toolbar.
* The toolbar can't list or pick YouTube TV games; you choose them in YouTube TV's own guide.
  (Regular YouTube links can be pasted directly.) The viewer
  deliberately doesn't read or automate the page.
* Reload presses F5 in the game. It needs the viewer to have focus (toolbar click or hotkey).
* Windows only. Tested on Windows 11 with Chrome 153 and Edge 154.

## Troubleshooting

| Problem | Try |
|---|---|
| "No supported browser found" | Install Chrome, or pick Edge / set a path in Settings. |
| Sign-in says "This browser or app may not be secure" | Make sure no other tool launched the browser with automation flags; the viewer uses a plain launch. Sign in to the window directly, not via a link from another app. |
| 4th game shows "too many streams" | Account limit: add 4K Plus, or watch three games. |
| A game is black or frozen | Game chip → **Reload**, or **Reopen**. Check the Performance panel for GPU decode and warnings. |
| Choppy video | Settings → turn off gaps and labels; in the viewer browser make sure *Use graphics acceleration* is on; close other video apps; check bandwidth (30+ Mbps). |
| A sliver of title bar shows | Settings → *Extra top crop* +1 or +2. |
| Windows got moved or covered | Toolbar → Settings → **Re-snap windows** (Ctrl+Alt+R). |
| Toolbar won't appear | Click into a game first (the viewer must be focused), then touch the top edge; or use the tray icon → Show controls. |
| A shortcut does nothing | Another app owns it (see the log via Settings → Open log folder). |
| A YouTube video says "Video unavailable" | The video is private, region-locked, or an ended live stream. Paste a different link, or use **Open on YouTube page**. |
| A YouTube video has no sound | It started muted (browser autoplay rule). Click the player's speaker icon. |
| Start from scratch | Quit, then delete `%APPDATA%\MultiGame Viewer\settings.json`. Delete `%LOCALAPPDATA%\MultiGameViewer\profiles` to sign out. |

## Future improvements

* Optional companion browser extension (loaded once by the user) for per-tab mute and
  "change channel" in Shared mode, with no automation flags involved.
* More layouts (1+2, 3×3 for nine games, picture-in-picture) and per-monitor layouts.
* Drag-and-drop swapping directly on the games.
* Port the controller to .NET/WinUI to shave ~150 MB.
* Signed installer and auto-update.
* macOS version using the Accessibility window APIs.
