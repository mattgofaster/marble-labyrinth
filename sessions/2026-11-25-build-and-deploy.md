# Marble Labyrinth: build, GitHub Pages deploy, iPhone tilt fixes
**Date:** 2026-11-25  |  **Project:** marble-labyrinth

## Goal
I asked for creative ways to use the iPhone's accelerometer in an app, chose a marble labyrinth (tilt maze) game, and wanted it playable on my iPhone with tilt controls, in portrait only, at a speed that feels right.

## What we did
- Brainstormed motion ideas (hot-potato bomb, pour/balance, gesture spells, labyrinth, etc.); I picked the marble labyrinth.
- Found that claude.ai artifacts can't use device motion for my account, so built it as a local Vite project in `Web App Games/marble-labyrinth/` like my other games.
- Designed 6 boards as text grids and verified each is solvable with a BFS script (fixed The Spiral, which had a pit blocking the only route).
- Built the game: canvas rendering (green painted-wood board, raised walls, numbered pits in route order, gold goal cup, checkpoint flags, steel marble), sub-stepped physics (tilt gravity, damping, wall bounce, pit-lip pull), countdown calibration, Recenter, timer/falls/best times in localStorage, board unlocking, synthesized Web Audio sounds, wake lock, pause on app switch, keyboard and drag-joystick fallbacks.
- Tested on desktop Chrome: fixed overlays showing despite `hidden` (added `[hidden]{display:none!important}`) and dotted seams on wall bevels (lineCap butt).
- Added `play.bat` (desktop) and `play-phone.bat` (HTTPS on LAN with self-signed cert, since iOS requires HTTPS for motion).
- Set up GitHub Pages: `.gitignore`, Actions workflow, `git init`, created public repo `mattgofaster/marble-labyrinth`, enabled Pages (Actions source). Live at https://mattgofaster.github.io/marble-labyrinth/
- Fixed tilt not working on iOS: the countdown finished while the permission prompt was open, so the neutral reading was never set. Now the countdown waits for the prompt, and the first late reading becomes neutral. Added messages for denied access.
- Portrait only: iOS Safari can't lock orientation, so the app counter-rotates itself when the viewport goes landscape (touch devices only). Later made detection prefer `window.orientation` with a viewport-shape fallback, and added a one-time tip about Portrait Orientation Lock. Confirmed it works: the brief iOS rotation flash before it snaps back can't be prevented by a web page.
- Speed tuning across several rounds (too slow → too slow → too fast → midpoint). Added a Gentle / Normal / Fast tilt speed picker in the menu (saved).

## Files changed
- `marble-labyrinth/index.html`: created; HUD, board canvas, bottom bar, menu (with tilt speed picker), completion overlay, toast.
- `marble-labyrinth/src/main.js`: created; game logic, physics, input, portrait lock, rendering, menus; later tilt/permission fixes, orientation detection, speed settings.
- `marble-labyrinth/src/levels.js`: created; 6 boards (11×17 grids).
- `marble-labyrinth/src/audio.js`: created; synthesized roll, knock, drop, flag, win sounds.
- `marble-labyrinth/src/style.css`: created; layout, theme, overlays, `.rotated` portrait-lock styles, speed picker.
- `marble-labyrinth/package.json`, `package-lock.json`: created; Vite 5 + @vitejs/plugin-basic-ssl; `dev`, `phone`, `build` scripts.
- `marble-labyrinth/vite.config.js`: created; `base: './'`; HTTPS + LAN host only in `phone` mode.
- `marble-labyrinth/play.bat`, `play-phone.bat`: created; desktop and iPhone-over-Wi-Fi launchers.
- `marble-labyrinth/netlify.toml`: created; Netlify build config (unused so far).
- `marble-labyrinth/README.md`: created; how to play, files, tuning constants.
- `marble-labyrinth/.gitignore`: created; ignores node_modules, dist, logs.
- `marble-labyrinth/.github/workflows/deploy.yml`: created; builds and deploys to GitHub Pages on push to main.

## Key decisions & rationale
- **Local Vite project, not a claude.ai artifact:** artifacts can't access device motion for my account.
- **GitHub Pages over Netlify/LAN:** real HTTPS (needed for iOS motion), no certificate warning, PC doesn't need to be on, auto-deploys on push. Repo is public because free Pages requires it.
- **deviceorientation (beta/gamma), not devicemotion:** consistent sign conventions across iOS and Android.
- **Calibrate neutral at countdown end:** you can hold the phone at any comfortable angle.
- **Counter-rotate instead of a "rotate back" overlay:** tilting sideways often triggers iOS auto-rotate mid-game, and an overlay would interrupt play.
- **Native app wrapper (Capacitor) rejected for now:** true portrait lock needs a Mac + Xcode, plus re-signing every 7 days or the $99/yr Apple program.
- **Current speed tuning:** `SPEEDS = { gentle: 100, normal: 145, fast: 210 }`, `MAX_SPEED 24`, `DAMPING 0.45`, `MAX_TILT_DEG 22`. Midpoint between the "too slow" (105 normal) and "too fast" (200 normal) versions.

## Open items / next steps
- **[ME]** Play the latest speed tuning on the iPhone and say whether Normal feels right, or whether Gentle/Fast should become the default.
- **[ME]** Turn on Portrait Orientation Lock in Control Center to avoid the brief iOS rotation flash (unfixable from the web).
- Unverified on device: drag-joystick fallback while counter-rotated (the ring is hidden in that mode).
- Parked ideas: more boards, moving obstacles, the other motion game ideas (hot-potato bomb, etc.).
- Optional: GitHub Actions warns that Node 20 actions are deprecated; it still works, but the workflow could be bumped later.

## How to resume
Open `C:\Users\leddy\Desktop\Claude Code\Projects\Web App Games\marble-labyrinth`. It's a Vite tilt-maze game deployed to https://mattgofaster.github.io/marble-labyrinth/ (repo mattgofaster/marble-labyrinth; pushing to main auto-deploys). Tilt controls and the portrait counter-rotation work on iPhone; the last change set speed to normal=145 (gentle 100, fast 210) and I was about to test whether it feels right. Speed constants are at the top of `src/main.js`, and boards are in `src/levels.js`.
