// Review of the MOBILE colour-editor net logic.
//
// The mobile net differs from desktop: it puts the B (back) face *below D* instead
// of in the L·F·R·B strip. That is a 180° change in how B unfolds, so B's tile→cubie
// map must differ from desktop's. This suite pins that down three ways:
//   1. the app's map == an INDEPENDENT first-principles unfolding derived here;
//   2. a real (solvable) cube entered through the net stays valid & identical;
//   3. the pre-fix "strip B" map would misread a below-D net (regression guard).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CubeState, cubeError, randomScramble } from '../src/state.js';
import { MOBILE_FACELET_POS, NET_ORDER } from '../src/netLayout.js';

const FACE_NORMAL = { U: [0,1,0], D: [0,-1,0], F: [0,0,1], B: [0,0,-1], R: [1,0,0], L: [-1,0,0] };

// Independent unfolding of the MOBILE net, derived purely from fold geometry
// (NOT from netLayout.js). Layout:  . u .  /  l f r  /  . d .  /  . b .
// r,c ∈ 0..2 row-major; returns the cubie position [x,y,z] a tile represents.
const NETPOS = {
  U: (r, c) => [c - 1, 1, r - 1],     // above F: bottom row (r=2) is the F edge (z=+1)
  F: (r, c) => [c - 1, 1 - r, 1],     // front, upright
  D: (r, c) => [c - 1, -1, 1 - r],    // below F: top row (r=0) is the F edge (z=+1)
  L: (r, c) => [-1, 1 - r, c - 1],    // left of F: right col (c=2) is the F edge (z=+1)
  R: (r, c) => [1, 1 - r, 1 - c],     // right of F: left col (c=0) is the F edge (z=+1)
  B: (r, c) => [c - 1, r - 1, -1],    // below D: top row (r=0) is the D edge (y=-1) → 180° of the strip
};
const posOf = (fn, idx) => fn((idx / 3) | 0, idx % 3);
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function setFacelet(state, p, n, c) {
  const f = state.facelets.find(f => eq(f.p, p) && eq(f.n, n));
  if (f) f.c = c;
  return !!f;
}
// The net a human paints off a real cube, read with true geometry.
function readNet(cube) {
  const net = {};
  for (const face of NET_ORDER) {
    net[face] = [];
    for (let idx = 0; idx < 9; idx++) net[face].push(cube.colorAt(posOf(NETPOS[face], idx), FACE_NORMAL[face]));
  }
  return net;
}
// Rebuild a CubeState from net data using a given tile→cubie map (mirrors applyEditor).
function rebuild(net, faceletPos) {
  const s = new CubeState();
  for (const face of NET_ORDER)
    for (let idx = 0; idx < 9; idx++) setFacelet(s, faceletPos[face][idx], FACE_NORMAL[face], net[face][idx]);
  return s;
}

test('mobile net map matches the first-principles unfolding, tile for tile', () => {
  for (const face of NET_ORDER)
    for (let idx = 0; idx < 9; idx++)
      assert.deepEqual(MOBILE_FACELET_POS[face][idx], posOf(NETPOS[face], idx), `face ${face}, tile ${idx}`);
});

test('mobile net covers all 54 stickers exactly once (no gaps, no collisions)', () => {
  const seen = new Set();
  for (const face of NET_ORDER)
    for (let idx = 0; idx < 9; idx++) {
      const key = MOBILE_FACELET_POS[face][idx].join(',') + '|' + FACE_NORMAL[face].join(',');
      assert.ok(!seen.has(key), `collision at ${face} tile ${idx}`);
      seen.add(key);
    }
  assert.equal(seen.size, 54);
});

test('a solvable cube entered through the mobile net stays valid & identical (2000 scrambles)', () => {
  for (let i = 0; i < 2000; i++) {
    const orig = new CubeState().moves(randomScramble(30));
    const rebuilt = rebuild(readNet(orig), MOBILE_FACELET_POS);
    assert.equal(cubeError(rebuilt), null, `scramble #${i} was wrongly flagged: ${cubeError(rebuilt)}`);
    for (const f of orig.facelets) assert.equal(rebuilt.colorAt(f.p, f.n), f.c, `sticker mismatch, scramble #${i}`);
  }
});

test('regression: the old "strip B" map misreads a below-D net → false unsolvable', () => {
  // Pre-fix B map (B unfolded in the strip): pos = [1-c, 1-r, -1].
  const OLD = { ...MOBILE_FACELET_POS, B: Array.from({ length: 9 }, (_, idx) => [1 - (idx % 3), 1 - ((idx / 3) | 0), -1]) };
  let flagged = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const orig = new CubeState().moves(randomScramble(30)); // a genuinely solvable cube
    if (cubeError(rebuild(readNet(orig), OLD)) !== null) flagged++;
  }
  // With B read 180° wrong, the vast majority of real cubes look impossible — exactly Eric's bug.
  assert.ok(flagged > N * 0.9, `old map flagged only ${flagged}/${N}; expected the overwhelming majority`);
});
