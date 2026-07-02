// Near-optimal ("shortest") Rubik's cube solver.
//
// Same public contract as ./solver.js — { steps: [{ name, moves }] } from
// solve(state), and a flat string[] from solveMoves(state) — but instead of the
// beginner layer-by-layer method (~130 moves) it delegates to the `cubejs`
// Kociemba two-phase solver, yielding ~20-move solutions. A total-beginner user
// following the guided UI then plays far fewer arrows.
//
// The solutions use ONLY face moves (U D L R F B, with ' or 2) — cubejs never
// emits whole-cube rotations — so the net whole-cube orientation is preserved
// and CubeState.isSolved() (absolute: white on +Y) is reached exactly.
//
// Bridging CubeState <-> cubejs is a single frozen 54-entry facelet map (MAP
// below), calibrated against cubejs as the oracle and exhaustively verified by
// round-trip in test/solverShort.test.mjs.
//
// Browser note: the two imports below are BARE specifiers on purpose, so the
// page can map them to esm.sh (or a local copy) via an <script type="importmap">.
// The exact specifiers this file depends on are:
//     'cubejs'            (default export: the Cube class + static solver)
//     'cubejs/lib/solve.js'  (installs Cube.initSolver / Cube#solve)
// `cubejs`'s own index.js already require()s ./lib/solve, so the first import is
// sufficient in Node; the second is listed explicitly because a browser importmap
// resolving 'cubejs' to a single ESM file will not pull the solve submodule in,
// and importing it (for side effects) guarantees the solver is present there too.
import Cube from 'cubejs';
import 'cubejs/lib/solve.js';

import { toList } from './state.js';

// ---------------------------------------------------------------------------
// CubeState <-> cubejs facelet-string bridge.
//
// cubejs uses the standard Kociemba 54-char facelet string, blocks in order
//   U(0-8) R(9-17) F(18-26) D(27-35) L(36-44) B(45-53),
// each face a 3x3 grid read row-major in that face's own reading orientation,
// each char being the FACE LETTER (U R F D L B) of the colour sitting there.
// A solved cube maps to
//   "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB".
//
// MAP[i] = { p:[x,y,z], n:[nx,ny,nz] } is the CubeState cubie position + outward
// normal that carries facelet index i. Built once from the per-face orientation
// SPEC that was solved empirically (cubejs as oracle) and is proven correct by
// the test suite's round-trip over thousands of scrambles.
// ---------------------------------------------------------------------------

// Outward normal of each cubejs face block, in CubeState axes
// (+X=R red, -X=L orange, +Y=U white, -Y=D yellow, +Z=F green, -Z=B blue).
const FACE_NORMAL = {
  0: [0, 1, 0],   // U +Y
  1: [1, 0, 0],   // R +X
  2: [0, 0, 1],   // F +Z
  3: [0, -1, 0],  // D -Y
  4: [-1, 0, 0],  // L -X
  5: [0, 0, -1],  // B -Z
};

// For each face: which CubeState axis (and sign) the grid row / column runs
// along. row/col each range 0..2; coordinate = sign * (idx - 1).
const SPEC = {
  0: { rowAxis: 2, rowSign: 1, colAxis: 0, colSign: 1 },   // U
  1: { rowAxis: 1, rowSign: -1, colAxis: 2, colSign: -1 }, // R
  2: { rowAxis: 1, rowSign: -1, colAxis: 0, colSign: 1 },  // F
  3: { rowAxis: 2, rowSign: -1, colAxis: 0, colSign: 1 },  // D
  4: { rowAxis: 1, rowSign: -1, colAxis: 2, colSign: 1 },  // L
  5: { rowAxis: 1, rowSign: -1, colAxis: 0, colSign: -1 }, // B
};

const MAP = (() => {
  const map = new Array(54);
  for (let face = 0; face < 6; face++) {
    const n = FACE_NORMAL[face];
    const na = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2; // the face's normal axis index
    const s = SPEC[face];
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++) {
        const idx = 9 * face + row * 3 + col;
        const p = [0, 0, 0];
        p[na] = n[na];
        p[s.rowAxis] = s.rowSign * (row - 1);
        p[s.colAxis] = s.colSign * (col - 1);
        map[idx] = { p, n: n.slice() };
      }
  }
  return map;
})();

/** Serialize a CubeState to the cubejs 54-char facelet string. */
export function toFacelets(state) {
  let out = '';
  for (let i = 0; i < 54; i++) out += state.colorAt(MAP[i].p, MAP[i].n);
  return out;
}

// ---------------------------------------------------------------------------
// Lazy, memoized solver initialisation. Cube.initSolver() builds the two-phase
// pruning tables (~1s the first time); we run it at most once per process.
// ---------------------------------------------------------------------------
let solverReady = false;
function ensureSolver() {
  if (!solverReady) {
    Cube.initSolver();
    solverReady = true;
  }
}

// ---------------------------------------------------------------------------
// Public API — mirrors ./solver.js.
// ---------------------------------------------------------------------------

export function solve(inputState) {
  const state = inputState.clone(); // never mutate the caller's state
  const steps = [];

  if (state.isSolved()) {
    // Nothing to do — return an empty (but well-formed) single phase.
    return { steps: [{ name: '最短还原 · Shortest solution', moves: [] }] };
  }

  ensureSolver();
  const facelets = toFacelets(state);
  const raw = Cube.fromString(facelets).solve(); // e.g. "U2 D R' D2 ..."
  const moves = toList(raw); // splits on whitespace, drops empties

  // Correct-by-verification: apply to the clone and confirm it solves.
  const check = state.clone().moves(moves);
  if (!check.isSolved()) {
    throw new Error('solverShort: cubejs solution did not solve the cube');
  }

  return { steps: [{ name: '最短还原 · Shortest solution', moves }] };
}

export function solveMoves(inputState) {
  return solve(inputState).steps.flatMap(s => s.moves);
}

// Exposed for calibration / unit tests only.
export const _internals = { MAP, toFacelets, ensureSolver };
