import test from 'node:test';
import assert from 'node:assert/strict';
import { CubeState, randomScramble } from '../src/state.js';
import { solve, solveMoves, toFacelets, _internals as I } from '../src/solverShort.js';

// ---------------------------------------------------------------------------
// Bridge calibration: a solved CubeState must map to the canonical cubejs
// facelet string, and every one of the 54 map entries must sit on a real
// exposed sticker (extreme coordinate along its own normal axis).
// ---------------------------------------------------------------------------

test('calibration: solved state maps to the canonical facelet string', () => {
  const solved = toFacelets(new CubeState());
  assert.equal(
    solved,
    'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB',
    'solved CubeState must map to the standard Kociemba solved facelets');
});

test('calibration: the 54-facelet map covers real, distinct stickers', () => {
  assert.equal(I.MAP.length, 54);
  const seen = new Set();
  for (const { p, n } of I.MAP) {
    const na = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2; // normal axis
    assert.equal(p[na], n[na], 'facelet must lie on its own outward face');
    const key = p.join(',') + '|' + n.join(',');
    assert.ok(!seen.has(key), `duplicate facelet mapping: ${key}`);
    seen.add(key);
  }
  assert.equal(seen.size, 54, 'all 54 facelets must be distinct (p,n) pairs');
});

// ---------------------------------------------------------------------------
// Structural contract (mirrors solver.test.mjs).
// ---------------------------------------------------------------------------

test('solve returns a well-labelled single phase; solveMoves is its concat', () => {
  const scrambled = new CubeState().moves(randomScramble(25));
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
  const scrambled = new CubeState().moves(randomScramble(25));
  const snapshot = scrambled.clone();
  solve(scrambled);
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++)
        for (const n of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
          assert.equal(scrambled.colorAt([x, y, z], n), snapshot.colorAt([x, y, z], n),
            'solve must not mutate the passed-in state');
});

test('the emitted solution uses only face moves (no whole-cube rotations)', () => {
  const scrambled = new CubeState().moves(randomScramble(25));
  for (const m of solveMoves(scrambled)) {
    assert.match(m, /^[UDLRFB]['2]?$/, `move "${m}" must be a face move`);
  }
});

test('an already-solved cube yields an empty solution', () => {
  const { steps } = solve(new CubeState());
  const flat = steps.flatMap(s => s.moves);
  assert.equal(flat.length, 0, 'solved cube should need no moves');
});

// ---------------------------------------------------------------------------
// Speed: a single solve must be fast once the solver is initialised. We warm
// initSolver() up front (its one-time table build is allowed to be slow), then
// assert an individual solve is well under 200ms.
// ---------------------------------------------------------------------------

test('a single solve is fast after init (< 200ms)', () => {
  I.ensureSolver(); // warm up (one-time table build)
  const scrambled = new CubeState().moves(randomScramble(25));
  const t0 = performance.now();
  solveMoves(scrambled);
  const dt = performance.now() - t0;
  assert.ok(dt < 200, `single solve took ${dt.toFixed(1)}ms, expected < 200ms`);
});

// ---------------------------------------------------------------------------
// The correctness oracle: 2000 random scrambles must all solve, and the
// solutions must be short. Also logs the move-count distribution for the UI.
// ---------------------------------------------------------------------------

test('solves 2000 random scrambles (100%) with short solutions', () => {
  I.ensureSolver();
  const N = 2000;
  const lens = [];
  for (let i = 0; i < N; i++) {
    const scramble = randomScramble(25);
    const scrambled = new CubeState().moves(scramble);
    const moves = solveMoves(scrambled);
    const check = new CubeState().moves(scramble).moves(moves);
    assert.ok(check.isSolved(),
      `scramble #${i} not solved.\n  scramble: ${scramble.join(' ')}\n  solution: ${moves.join(' ')}`);
    lens.push(moves.length);
  }

  lens.sort((a, b) => a - b);
  const min = lens[0];
  const max = lens[lens.length - 1];
  const median = lens[Math.floor(lens.length / 2)];
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  console.log(`\n[solverShort] move-count over ${N} scrambles: ` +
    `min=${min} median=${median} mean=${mean.toFixed(2)} max=${max}\n`);

  assert.ok(max <= 30, `max solution length ${max} should be <= 30`);
});
