# Twist Solver — project context & handoff

A follow-along Rubik's-cube solver for **total beginners**: scramble (or enter your real
cube), hit **Solve**, and copy the on-screen **black arrows on the glowing layer**, one
quarter-turn at a time — no theory, no algorithms. Eric's **portfolio piece** → design
polish is paramount ("maximum design effort"; English UI). Zero-build static site.

- Location `~/Desktop/cubic-solver` (git). Two front-ends over ONE shared engine:
  **Desktop** = `index.html` + `styles.css` + `src/main.js`; **Mobile** = `mobile.html` +
  `mobile.css` + `src/mobile.js`.
- three.js + cubejs load from CDN via `<script type="importmap">` at runtime — no build.
  `node_modules/` exists only for the test suite (gitignored).

## Run & verify
- Serve: `python3 -m http.server 8173` → Desktop `http://localhost:8173/` · Mobile `http://localhost:8173/mobile.html`
- Tests: `npm test` (`node --test`) — state model + BOTH solvers (2000-scramble oracles), ~3 min, **22/22**. main.js / mobile.js (DOM controllers) are not unit-tested.
- **Screenshot-verify visuals before delivering** (Eric's been burned by untested output). Headless WebGL:
  ```
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
    --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox \
    --force-device-scale-factor=2 --window-size=1440,900 --screenshot=/tmp/o.png "URL"
  ```
  then Read the PNG. **rAF DOES tick in `--headless=new` (~20fps)** — the old "rAF stalls"
  caveat is stale. Drive a solve via DOM clicks over CDP (`#scramble` → `[data-mode="basic|short"]`
  → `#solve` → `#solveNext`). Mobile: emulate via CDP `Emulation.setDeviceMetricsOverride`
  (390×844; short-phone test 375×667).

## Architecture — shared engine (both front-ends import these)
- `src/cube.js` — 3D cube (27 cubies + sticker tiles), turn queue, logical `CubeState` kept
  in lockstep; `setSolveHighlight`/`clearSolveHighlight` (variant-C muting); `_animate` has a
  `duration<=0` instant fast-path.
- `src/state.js` — facelet model; `cubeError(state)` solvability validator; `toList`.
- `src/solver.js` — beginner **LBL** (~130 moves). Phases: `Bottom cross · Bottom corners ·
  Middle edges · Top cross · Top face · Corner positions · Edge positions`. 2000/2000.
- `src/solverShort.js` — **Kociemba two-phase via cubejs** (~20 moves). 2000/2000. ⚠️ cubejs
  is **non-optimal** (a single `R` → 8 moves; every random scramble → exactly 22). This is the
  library's normal behaviour, not a bug — **Eric chose to leave it** (no optimal fast-path).
- `src/solveVisuals.js` — `buildMotionArrows`: near-black `#141414` arrows on all four side
  faces of the moving layer.

## Brand (LOCKED)
- **Name** Twist Solver. **Logo** = realistic mid-twist cube, `twist-logo.png` (512², transparent;
  re-cropped from the old `mock/twist-sheet.png` with its full bottom — that source sheet has
  since been pruned). **Wordmark** Orbitron 800, "Solver" green, the "i" tittle = a small green
  cube square (`top:-.02em`).
- **Primary = GREEN `#00A24B`** (graphite `#2A2E37` was tried and **rejected**). Vars centralised
  in `styles.css`/`mobile.css` `:root`. Cube colours: W`#F7F7F5` Y`#FFD400` G`#00A24B` B`#0A57C7`
  R`#D01B2E` O`#FF6A00`.

## Key interactions / decisions (LOCKED)
- **Free-look = TURNTABLE + INERTIA** (both): yaw world-Y, pitch world-X clamped `[0.12, π-0.12]`
  (no roll → easy target angles) + flick-to-spin that eases to a stop (`stepInertia` in the render
  loop). Desktop: **Space = momentary hold-to-orbit** (ignores key-repeat; button stays green,
  cursor steady grab). Mobile: 1-finger orbit, **2-finger pinch-zoom (50–150%)**. Recenter glides
  ON the view-sphere (slerp direction + lerp radius — no "zoom in/out" dip) and resets zoom to 100%.
- Desktop: hold **Shift** previews **primed** notation on the Turn-a-layer buttons (U→U′), synced
  from `e.shiftKey` so it can't stick. Top-bar buttons bumped (13.5px / 16px icons); **center
  actions (Scramble/Edit/Reset) are borderless**, right tools (Free look/Recenter/Exit) bordered.
- **Move strip is ADAPTIVE by mode**: Beginner → grouped columns (each phase owns its label + its
  chips, so labels align and the hairline divider sits exactly on the boundary), taller; Shortest →
  one compact chip row, no labels, shorter (`.tl-strip.solo` / `.strip.solo`; footer row = `auto`).
  Current chip keeps the **pixel/arcade offset shadow**. Compact labels = `PHASE_SHORT` scheme B
  (Btm cross · Btm corners · Mid edges · Top cross · Top face · LL corners · LL edges).
- Method label lives in the **top bar** next to "● Solving", separated by an equal-spaced **dot**
  (flex-child dot). Desktop shows method + engine; mobile shows just the method.
- Mobile solve dock: header = `Step` + right group `[speed · red-✕ Exit]` (~38px touch targets);
  nav = `◀ · Auto · Next`, Auto = **neutral ghost** with a green ▶ that toggles to ⏸ Pause; speed
  0.5/1/2× + auto-play. **Editor sheet fits ONE screen** (no page scroll — the 6-face net is the
  only *local* scroller, only on short phones; palette + "Check & Apply" stay pinned).
- Enter during a solve advances a step — EXCEPT when a text input (the zoom field) is focused.
- Copy: editor sub is unified — "Pick a color, then click/tap the tiles to match your real cube.
  Center tiles are fixed." (only click vs tap differs). Button = "Check & Apply".

## Solvability (`cubeError`)
Catches wrong colour counts, invalid/dup/missing pieces, corner-twist sum mod 3, and corner-vs-edge
parity. A lone flipped edge passes those but is caught by attempting the (always-terminating) LBL
solve in `applyEditor`. The editor validates a throwaway `CubeState` first, so a bad entry never
clobbers the on-screen cube.

## Git / deploy state
- All work committed on branch **`ericf-0704--ui-revamp`** (author = **personal** `ericfu-tianchi`
  / `ericfu-tianchi@outlook.com` — NOT the OpusFu company account), squash-merged to `main`, pushed
  to Eric's personal GitHub. gh active account was switched to `ericfu-tianchi` (switch back with
  `gh auth switch --user OpusFu` if needed).
- Org rules: no direct push to master; **squash merge**; PR needs an **"AI coding brief"** section
  (Original request / Manual interventions / Retro). Branch name `{first}{lastinitial}-{mm}{dd}--{feature}`.

## ▶ NEXT STEP (new session) — DEPLOY (the last step)
Goal: one static webpage that opens on desktop **and** mobile, free & shareable.
**Recommended: GitHub Pages** (zero-build, already on his GitHub, relative paths work on the repo
subpath with no code changes):
1. Repo must be **public** for free Pages. GitHub → repo → Settings → Pages → "Deploy from a
   branch" → `main` / `/ (root)` → Save.
2. URLs: Desktop `https://ericfu-tianchi.github.io/<repo>/` · Mobile `…/mobile.html`.
3. Optional polish: a tiny UA/width redirect so small screens land on `mobile.html`; and/or vendor
   three.js + cubejs locally so a CDN hiccup can't break the page.
- Alternatives (all free, auto-deploy on push, custom-domain): Cloudflare Pages / Vercel / Netlify.

## Working style with Eric
Concise; hands-on; **iterates hard on visuals** → show options as throwaway mock HTML + screenshots,
let him pick, then integrate. **Verify visuals via screenshot before delivering.** Only touch code
that's actually involved. Wants honest limits. Prefers opening the live app in real Chrome.
