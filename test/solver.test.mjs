import test from 'node:test';
import assert from 'node:assert/strict';
import { CubeState, randomScramble, invert } from '../src/state.js';
import { solve, solveMoves, _internals as I } from '../src/solver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Apply an alg to a solved cube and return, for every edge/corner cubie whose
// facelets are not in their solved home, a "position:[colors]" description.
function exposedNormals(p) {
  const out = [];
  if (p[0] !== 0) out.push([p[0], 0, 0]);
  if (p[1] !== 0) out.push([0, p[1], 0]);
  if (p[2] !== 0) out.push([0, 0, p[2]]);
  return out;
}
function normalToColor(n) {
  if (n[1] === 1) return 'U'; if (n[1] === -1) return 'D';
  if (n[2] === 1) return 'F'; if (n[2] === -1) return 'B';
  if (n[0] === 1) return 'R'; return 'L';
}
function posName(p) {
  let s = '';
  if (p[1] === 1) s += 'U'; if (p[1] === -1) s += 'D';
  if (p[2] === 1) s += 'F'; if (p[2] === -1) s += 'B';
  if (p[0] === 1) s += 'R'; if (p[0] === -1) s += 'L';
  return s;
}
function movedPieces(alg) {
  const s = new CubeState().moves(alg);
  const moved = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        const p = [x, y, z];
        if ((x ? 1 : 0) + (y ? 1 : 0) + (z ? 1 : 0) < 2) continue;
        const here = exposedNormals(p).map(n => s.colorAt(p, n)).join('');
        const solved = exposedNormals(p).map(n => normalToColor(n)).join('');
        if (here !== solved) moved.push(posName(p));
      }
  return moved;
}
// Every U-face sticker of the U layer stays 'U' (orientation-preserving) and
// nothing below the U layer is disturbed?
function isUOnlyPermutation(alg) {
  const s = new CubeState().moves(alg);
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) if (s.colorAt([x, 1, z], [0, 1, 0]) !== 'U') return false;
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        if (y === 1) continue;
        const p = [x, y, z];
        if ((x ? 1 : 0) + (y ? 1 : 0) + (z ? 1 : 0) < 2) continue;
        for (const n of exposedNormals(p)) if (s.colorAt(p, n) !== normalToColor(n)) return false;
      }
  return true;
}

// ---------------------------------------------------------------------------
// Calibration: verify each fixed last-layer algorithm has the effect the solver
// relies on. If any of these regress, the phase logic breaks.
// ---------------------------------------------------------------------------

test('calibration: edge-cross alg only affects the U layer', () => {
  const s = new CubeState().moves(I.ALG.edgeCross);
  // it must not disturb any piece below the U layer
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        if (y === 1) continue;
        const p = [x, y, z];
        if ((x ? 1 : 0) + (y ? 1 : 0) + (z ? 1 : 0) < 2) continue;
        for (const n of exposedNormals(p))
          assert.equal(s.colorAt(p, n), normalToColor(n), `edgeCross disturbed ${posName(p)}`);
      }
});

test('calibration: sune & antisune are inverses, orient corners, U-layer only', () => {
  // sune then antisune returns to solved
  assert.ok(new CubeState().moves(I.ALG.sune).moves(I.ALG.antisune).isSolved(),
    'sune·antisune should be identity');
  // both keep the first two layers intact
  for (const alg of [I.ALG.sune, I.ALG.antisune]) {
    const s = new CubeState().moves(alg);
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          if (y === 1) continue;
          const p = [x, y, z];
          if ((x ? 1 : 0) + (y ? 1 : 0) + (z ? 1 : 0) < 2) continue;
          for (const n of exposedNormals(p))
            assert.equal(s.colorAt(p, n), normalToColor(n), `${alg} disturbed ${posName(p)}`);
        }
  }
});

// The corner-permutation phase uses cornerCycleA and cornerCycleB as two
// independent pure 3-cycles of U-layer corners (they cycle different triples;
// they are NOT each other's inverse). What matters is that each is a pure,
// U-layer-only, orientation-preserving 3-cycle so the macro-search over them
// can reach any even corner permutation without touching orientation or F2L.
test('calibration: corner 3-cycles are pure, U-only, orientation-preserving', () => {
  for (const alg of [I.ALG.cornerCycleA, I.ALG.cornerCycleB]) {
    assert.ok(isUOnlyPermutation(alg), `${alg} is not a U-only permutation`);
    const s = new CubeState();
    s.moves(alg).moves(alg).moves(alg);
    assert.ok(s.isSolved(), `${alg} should have order 3`);
    const moved = movedPieces(alg);
    assert.equal(moved.length, 3, `${alg} should cycle exactly 3 corners, moved ${moved}`);
  }
});

// Likewise, edgeCycleA / edgeCycleB are pure U-layer edge 3-cycles.
test('calibration: edge 3-cycles are pure, U-only, orientation-preserving', () => {
  for (const alg of [I.ALG.edgeCycleA, I.ALG.edgeCycleB]) {
    assert.ok(isUOnlyPermutation(alg), `${alg} is not a U-only permutation`);
    const s = new CubeState();
    s.moves(alg).moves(alg).moves(alg);
    assert.ok(s.isSolved(), `${alg} should have order 3`);
    const moved = movedPieces(alg);
    assert.equal(moved.length, 3, `${alg} should cycle exactly 3 edges, moved ${moved}`);
  }
});

// ---------------------------------------------------------------------------
// Structural contract
// ---------------------------------------------------------------------------

test('solve returns non-empty, well-labelled steps; solveMoves is their concat', () => {
  const scr = randomScramble(25);
  const scrambled = new CubeState().moves(scr);
  const { steps } = solve(scrambled);
  assert.ok(steps.length >= 1);
  for (const step of steps) {
    assert.equal(typeof step.name, 'string');
    assert.ok(step.name.length > 0, 'step name must be non-empty');
    assert.ok(Array.isArray(step.moves));
  }
  const flat = steps.flatMap(s => s.moves);
  assert.deepEqual(solveMoves(scrambled), flat, 'solveMoves must equal concatenation of step moves');
});

test('solve does not mutate its input state', () => {
  const scr = randomScramble(25);
  const scrambled = new CubeState().moves(scr);
  const snapshot = scrambled.clone();
  solve(scrambled);
  // Compare facelet-by-facelet against the snapshot.
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++)
        for (const n of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
          assert.equal(scrambled.colorAt([x, y, z], n), snapshot.colorAt([x, y, z], n),
            'solve must not mutate the passed-in state');
});

test('typical solution length is < 300 moves', () => {
  let max = 0;
  for (let i = 0; i < 200; i++) {
    const scrambled = new CubeState().moves(randomScramble(25));
    const len = solveMoves(scrambled).length;
    if (len > max) max = len;
  }
  assert.ok(max < 300, `max solution length ${max} should be < 300`);
});

test('the emitted solution uses only face moves (no whole-cube rotations)', () => {
  const scrambled = new CubeState().moves(randomScramble(25));
  for (const m of solveMoves(scrambled)) {
    assert.match(m, /^[UDLRFB]['2]?$/, `move "${m}" must be a face move`);
  }
});

// A follower should never be told to turn the same face twice in a row (e.g. U'
// then U, or U2 then U): those cancel/combine and read as a mistake. The seam
// simplifier must remove every such run — flat AND within each phase's steps.
test('no redundant consecutive same-face moves (500 scrambles)', () => {
  for (let i = 0; i < 500; i++) {
    const scr = randomScramble(25);
    const { steps } = solve(new CubeState().moves(scr));
    const flat = steps.flatMap(s => s.moves);
    for (let k = 1; k < flat.length; k++)
      assert.notEqual(flat[k][0], flat[k - 1][0],
        `scramble #${i}: consecutive same-face "${flat[k - 1]} ${flat[k]}" should be simplified`);
    // and it must still solve, so the simplification stayed effect-preserving
    assert.ok(new CubeState().moves(scr).moves(flat).isSolved(), `scramble #${i} no longer solves`);
  }
});

// ---------------------------------------------------------------------------
// The correctness oracle: 2000 random scrambles must all solve.
// ---------------------------------------------------------------------------

test('solves 2000 random scrambles (100%)', () => {
  for (let i = 0; i < 2000; i++) {
    const scramble = randomScramble(25);
    const scrambled = new CubeState().moves(scramble);
    const moves = solveMoves(scrambled);
    const check = new CubeState().moves(scramble).moves(moves);
    assert.ok(check.isSolved(),
      `scramble #${i} not solved.\n  scramble: ${scramble.join(' ')}\n  solution: ${moves.join(' ')}`);
  }
});
