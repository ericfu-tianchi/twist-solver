# Cubic Solver — project context & handoff

A follow-along Rubik's cube solver web app. Target user: a **total beginner** who just wants
to successfully solve a real cube **once** by copying on-screen steps — no learning, no tutorials.
It's Eric's personal portfolio piece, so **design polish matters a lot** (his words: "maximum
design effort"; "too simple / AI-slop = fail").

Location: `~/Desktop/cubic-solver` (git repo, branch `main`). Zero-build static site.

## Run & verify
- Serve: `python3 -m http.server 8173` (already the `npm run serve` script). Open `http://localhost:8173`.
- Node tests: `npm test` (== `node --test`). Covers the state model + BOTH solvers (2000-scramble oracles).
- **Verify visuals yourself with a headless-Chrome screenshot before showing Eric** (he's been burned by
  untested output). WebGL needs these flags:
  ```
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
    --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox \
    --window-size=1200,1000 --virtual-time-budget=9000 --screenshot=/tmp/out.png "http://localhost:8173/PAGE.html"
  ```
  then Read the PNG. Without those `--use-gl` flags the canvas is blank.

## Architecture
- `index.html` / `styles.css` — UI shell (dark glass panels). **NOTE: UI is Chinese + "AI-slop"; slated for
  a full English + Figma-console-style redo — see TODO.**
- `src/cube.js` — 3D cube: 27 rounded-box cubies + sticker tiles, turn animation (reparent layer to a pivot,
  ease, bake back, snap to grid). Keeps a logical `CubeState` in lock-step with every turn. Everything is
  standard notation (U D L R F B + x y z, with `'` and `2`). Exports `parseMove`, `FACE_NORMAL`, `COLORS`.
- `src/state.js` — pure geometric facelet model (node + browser). `colorAt(pos, normal)`, `isSolved()`
  (absolute: white +Y, green +Z, red +X, yellow -Y, blue -Z, orange -X), `move`, `moves`, `clone`,
  `invert`, `randomScramble`.
- `src/solver.js` — beginner **LBL** solver (~130 moves, 7 named phases). Verified 2000/2000.
- `src/solverShort.js` — **Kociemba** two-phase via the `cubejs` lib (~20 moves; 18–22). Verified 2000/2000.
  Browser loads `cubejs` from esm.sh via the importmap in index.html; node uses the npm dep.
- `src/main.js` — scene/lights, camera control, free-mode, guided-solve controller, editor, all wiring.

## Solver (key facts)
- **Default = shortest (Kociemba, ~20 moves)**; a toggle switches to **basic (LBL, ~130)**. (Eric's call: for a
  follow-along "solve once" user, fewer steps beats pedagogy. CFOP was considered and rejected — more work,
  more moves than Kociemba, no benefit when you're just copying arrows.)
- First short-solve triggers a one-time ~1–2 s Kociemba table build (there's a "计算中" toast). ~12 ms after.
- **Every 180° move is split into two 90° steps** in the guided flow (the eye can't tell 90° from 180°).
- Colour scheme is the WCA standard: white U / yellow D / green F / blue B / red R / orange L. This is correct
  and confirmed — do not change. "正对/recenter" = look at the green Front face, white on top.

## Camera / interaction (in the app)
- Default & recenter ("正对") = pure face-on front. Solve view = a fixed 3/4 (`SOLVE_VIEW`), **locked** during
  solving (no per-move camera moves). Auto-returns to it on next/prev/auto if you free-observed. `最佳视角` button.
- Free mode = seamless quaternion **arcball** (replaced OrbitControls, which pole-locked). Wheel = zoom.
  Cursor becomes **grab/grabbing hand** in free mode; the Free button has a 3D-orbit icon.
- Left slider = cube size. Scramble is a **start/stop toggle**. Auto-play has 0.5×/1×/2× speed.

## Design decisions LOCKED but NOT yet integrated into the app  ← main pending work
1. **Highlight during solve = "variant C"**: the moving LAYER's stickers stay vivid (HSL sat×1.16, light×1.12);
   all other layers are muted (sat×0.42, light×0.3). Preserves hue/readability, strong contrast. The app still
   uses the OLD own-colour-emissive highlight — replace it.
2. **Direction arrow = per-sticker motion arrows** (Eric's final concept, matches his reference photo): for the
   move, draw a small **solid arrow on each camera-facing SIDE sticker of the moving layer**, pointing in that
   sticker's motion direction (project `omega × r` onto the face plane); skip the layer's outer/axis face; skip
   hidden faces. Confirmed working across all 6 turns (see arrow-lab5.html). The app still has the OLD floating
   curved-arc arrow — replace it.
   - Arrow glyph = clean solid arrow (shaft + triangle head).
   - Arrow **colour = PENDING Eric's pick** among: #1 black, #5 black + white outline (rec), #6 white + black
     outline. (Yellow blends on warm/white stickers.) See arrow-lab6.html.

## Open TODOs (priority order)
1. Get Eric's arrow-colour pick, then **integrate the per-sticker motion arrows + highlight-C into the app**
   (generalize for any move at the locked solve view; replace `buildArc`/`showArrow` and `cube.setHighlight`).
   For Back (B) turns few side stickers are visible from the solve 3/4 — okay to tilt the view a touch just for B.
   Screenshot-verify each turn.
2. **UI overhaul**: redo the whole interface in **ENGLISH** (Eric: entire UI in English), Figma-console aesthetic
   (modern, minimal, refined floating panels). Use the `frontend-design` skill. Screenshot-verify.
3. Then end-to-end: scramble → solve → follow arrows, verify the full loop.

## Design-lab files (throwaway design exploration; delete before shipping)
`arrow-lab.html`, `arrow-lab2.html`, `arrow-lab3.html`, `arrow-lab4.html` (glyph styles), `arrow-lab5.html`
(the chosen per-sticker arrow across all 6 turns), `arrow-lab6.html` (arrow colours), `highlight-lab.html`
(highlight variants → chose C). These render mini 3D cubes for side-by-side comparison; not part of the app.

## Working style with Eric (important)
Concise; hands-on; wants honest limits; **verify visuals via screenshot before delivering, never ship untested**;
deliver one step at a time; maximum design effort. He iterates hard on visuals — show options in a lab HTML,
let him pick, then integrate.
