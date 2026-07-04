# Twist Solver

**Anyone can enjoy a Rubik's cube — even if you've never solved one.**

Twist Solver takes any scrambled cube and walks you through fixing it, one quarter-turn at a
time. On-screen arrows show exactly what to twist next — no notation, no algorithms, nothing to
memorize. Just follow along.

> 🔗 **Live demo: [twist-solver.pages.dev](https://twist-solver.pages.dev)** — one link, opens on desktop and mobile (phones automatically get the mobile layout).

## Features

- **Desktop & mobile** — one shared 3D engine, with interfaces tuned separately for mouse/keyboard and touch.
- **Scramble** — one click for a random, always-solvable scramble to practice on.
- **Enter your own cube** — paint the six faces to match your real, physical cube; the entry is
  validated for solvability before you solve.
- **Two solve modes:**
  - **Shortest** (~20 moves) — the fast way to a solved cube.
  - **Beginner** (~130 moves) — the classic layer-by-layer method, grouped into human-friendly
    phases you can actually learn.
- **Follow-along guidance** — the active layer glows, motion arrows show the turn, and you move
  step-by-step (prev / next), with auto-play and adjustable speed.
- **Free-look** — orbit the cube any time (drag or hold `Space` on desktop; one-finger drag +
  pinch-to-zoom on mobile), then recenter with one tap.

## Run locally

Zero build — it's plain HTML/CSS/JS. three.js and cubejs load from a CDN at runtime, so all you
need is a static server:

```bash
python3 -m http.server 8173
# Desktop:  http://localhost:8173/
# Mobile:   http://localhost:8173/mobile.html
```

> Opening `index.html` directly via `file://` won't work — browsers block ES modules over `file://`,
> so serve it over `http` as above.

## Tests

```bash
npm test   # node --test — state model + both solvers, each verified against 2000 random scrambles
```

## Project layout

Two front-ends over one shared engine:

- **Desktop** — `index.html` + `styles.css` + `src/main.js`
- **Mobile** — `mobile.html` + `mobile.css` + `src/mobile.js`
- **Shared engine** — `src/cube.js` (3D + animation), `src/state.js` (logic + solvability),
  `src/solver.js` (Beginner), `src/solverShort.js` (Shortest), `src/solveVisuals.js` (arrows)

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture, brand, and design decisions.
