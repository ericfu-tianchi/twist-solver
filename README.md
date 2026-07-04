# Twist Solver

**Anyone can enjoy a Rubik's cube — even if you've never solved one.**

Twist Solver takes any scrambled cube and walks you through fixing it, one quarter-turn at a
time. On-screen arrows show exactly what to twist next — no notation, no algorithms, nothing to
memorize. Just follow along.

## ▶ Use it — [twist-solver.pages.dev](https://twist-solver.pages.dev)

It's live. One link, works on desktop and mobile (phones automatically get the mobile layout).
**This repository is the source code** behind that site.

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

## How it works

Zero-build, no backend. It's plain HTML/CSS/JS: the 3D rendering, the solver, the cube state, and
the validation all run in the browser — the host just serves static files. For a full walk-through
of the architecture, see the [technical flyer](https://twist-solver.pages.dev/technical-flyer.html).

## Run locally

There's no build step. Serve the folder over HTTP with any static server, then open the URL it prints:

```bash
python3 -m http.server        # serves at http://localhost:8000
# or, with Node:  npx serve .
```

Both `/` (desktop) and `/mobile.html` are served. The port is arbitrary — pass any number
(e.g. `python3 -m http.server 8173`) if the default is taken.

> Opening `index.html` straight from disk (`file://`) won't work — browsers block ES modules over
> `file://`, so it must be served over `http`.

## Tests

The cube state model and both solvers are covered by a test suite — each solver is verified against
2000 random scrambles:

```bash
npm test
```

## Project layout

Two front-ends over one shared engine:

- **Desktop** — `index.html` + `styles.css` + `src/main.js`
- **Mobile** — `mobile.html` + `mobile.css` + `src/mobile.js`
- **Shared engine** — `src/cube.js` (3D + animation), `src/state.js` (logic + solvability),
  `src/solver.js` (Beginner), `src/solverShort.js` (Shortest), `src/solveVisuals.js` (arrows)
