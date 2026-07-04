// Beginner Layer-By-Layer (LBL) Rubik's cube solver.
//
// Pure ESM, no dependencies. Operates on the CubeState model from ./state.js.
// It emits ONLY face moves (U D L R F B, with ' or 2) — never whole-cube
// rotations — so the net whole-cube orientation is preserved and isSolved()
// (which is absolute: white on +Y) is reached exactly.
//
// The standard last-layer algorithms below act on the TOP (U) layer, so we
// build the cube bottom-up with the YELLOW (D) face down:
//   1. Bottom cross    : the four yellow edges around the D center (yellow down),
//                        via the classic "daisy" method.
//   2. Bottom corners  : the four yellow corners -> first layer complete.
//   3. Middle edges    : the four E-slice edges  -> first two layers complete.
//   4. LL edge orient  : white cross on the U face.
//   5. LL corner orient : whole U face white.
//   6. LL corner perm  : last-layer corners into their homes.
//   7. LL edge perm    : last-layer edges into their homes -> solved.
//
// Speed / correctness strategy:
//   * Phases 1-2 place pieces one at a time using a bounded IDDFS. Searches are
//     kept fast by restricting the move set: staging (get the piece into the top
//     layer) is a shallow full-set search; the actual insertion runs on a small
//     3-face generator {U + the two side faces of the target slot}, so branching
//     is ~7 and depth stays small. Every goal predicate requires all previously
//     solved pieces to stay solved, so the method is correct-by-construction.
//   * Phase 3 and phases 4-7 use calibrated, standard algorithms driven by
//     greedy loops (try the 4 U-setups, keep the effect that maximises the count
//     of correctly placed pieces) with iteration caps.
//
// Every fixed algorithm string here is verified in test/solver.test.mjs (the
// "calibration" tests) to have exactly the effect its phase relies on.

import { toList } from './state.js';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const U = [0, 1, 0], D = [0, -1, 0];
const Fn = [0, 0, 1], Bn = [0, 0, -1], Rn = [1, 0, 0], Ln = [-1, 0, 0];

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
function colorToNormal(c) {
  return { U, D, F: Fn, B: Bn, R: Rn, L: Ln }[c];
}
function homePosEdge(c1, c2) {
  const a = colorToNormal(c1), b = colorToNormal(c2);
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function homePosCorner(c1, c2, c3) {
  const a = colorToNormal(c1), b = colorToNormal(c2), c = colorToNormal(c3);
  return [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
}
function findEdge(state, c1, c2) {
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        const p = [x, y, z];
        if ((x ? 1 : 0) + (y ? 1 : 0) + (z ? 1 : 0) !== 2) continue;
        const cols = exposedNormals(p).map(n => state.colorAt(p, n));
        if ((cols[0] === c1 && cols[1] === c2) || (cols[0] === c2 && cols[1] === c1)) return p;
      }
  return null;
}
function findCorner(state, c1, c2, c3) {
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        const p = [x, y, z];
        if ((x ? 1 : 0) + (y ? 1 : 0) + (z ? 1 : 0) !== 3) continue;
        const set = new Set(exposedNormals(p).map(n => state.colorAt(p, n)));
        if (set.size === 3 && set.has(c1) && set.has(c2) && set.has(c3)) return p;
      }
  return null;
}
function pieceHomeEdge(state, c1, c2) {
  const home = homePosEdge(c1, c2);
  for (const n of exposedNormals(home))
    if (state.colorAt(home, n) !== normalToColor(n)) return false;
  return true;
}
function pieceHomeCorner(state, c1, c2, c3) {
  const home = homePosCorner(c1, c2, c3);
  for (const n of exposedNormals(home))
    if (state.colorAt(home, n) !== normalToColor(n)) return false;
  return true;
}
function cornerInPlace(state, c1, c2, c3) {
  const home = homePosCorner(c1, c2, c3);
  const cols = new Set(exposedNormals(home).map(n => state.colorAt(home, n)));
  return cols.size === 3 && cols.has(c1) && cols.has(c2) && cols.has(c3);
}

// ---------------------------------------------------------------------------
// Bounded IDDFS search over a supplied move set. Fully restores `state`.
// ---------------------------------------------------------------------------

const FULL_MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'L', "L'", 'L2',
  'R', "R'", 'R2', 'F', "F'", 'F2', 'B', "B'", 'B2'];

function moveSet(faces) {
  const out = [];
  for (const f of faces) out.push(f, f + "'", f + '2');
  return out;
}
function inverseToken(t) {
  return t.endsWith('2') ? t : t.endsWith("'") ? t[0] : t + "'";
}
const sameFace = (a, b) => a[0] === b[0];

function searchMoves(state, goal, maxDepth, moves = FULL_MOVES) {
  if (goal(state)) return [];
  const path = [];
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (dfs(state, goal, depth, path, '', moves)) return path.slice();
  }
  return null;
}
function dfs(state, goal, depth, path, lastFace, moves) {
  for (const mv of moves) {
    if (lastFace && sameFace(mv, lastFace)) continue;
    state.move(mv);
    path.push(mv);
    if (depth === 1) {
      if (goal(state)) { state.move(inverseToken(mv)); return true; }
    } else if (dfs(state, goal, depth - 1, path, mv[0], moves)) {
      state.move(inverseToken(mv));
      return true;
    }
    state.move(inverseToken(mv));
    path.pop();
  }
  return false;
}

function applySeq(state, record, seq) {
  for (const m of toList(seq)) { state.move(m); record.push(m); }
}

// ---------------------------------------------------------------------------
// Piece groups
// ---------------------------------------------------------------------------

const D_EDGES = [['D', 'F'], ['D', 'R'], ['D', 'B'], ['D', 'L']];
// Corner as [d, side1, side2] with the two side faces that border its slot.
const D_CORNERS = [['D', 'F', 'R'], ['D', 'R', 'B'], ['D', 'B', 'L'], ['D', 'L', 'F']];
const MID_EDGES = [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']];
const U_EDGES = [['U', 'F'], ['U', 'R'], ['U', 'B'], ['U', 'L']];
const U_CORNERS = [['U', 'F', 'R'], ['U', 'R', 'B'], ['U', 'B', 'L'], ['U', 'L', 'F']];
// The four vertical middle slots as (front, right) face pairs, clockwise.
const SLOTS = [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']];

// The U-layer edge/petal slots (positions with y=1 and one horizontal coord).
const U_SLOTS = [[0, 1, 1], [1, 1, 0], [0, 1, -1], [-1, 1, 0]];

// ---------------------------------------------------------------------------
// Phase 1: bottom (yellow) cross via the "daisy" method.
//   A) Build a daisy: each of the four D-colour edges is either a petal on top
//      (its D sticker facing UP) or already solved on the bottom.
//   B) Drop each petal into the bottom by aligning its side colour and turning
//      that side face twice.
// ---------------------------------------------------------------------------
function petalReadyCount(state) {
  let n = 0;
  for (const [a, b] of D_EDGES) {
    const p = findEdge(state, a, b);
    if (p[1] === 1 && state.colorAt(p, U) === 'D') n++;        // petal on top
    else if (pieceHomeEdge(state, a, b)) n++;                  // solved on bottom
  }
  return n;
}
function phaseBottomCross(state) {
  const record = [];
  // A) build the daisy
  let guard = 0;
  while (petalReadyCount(state) < 4) {
    if (++guard > 16) throw new Error('daisy build did not converge');
    const had = petalReadyCount(state);
    const goal = (s) => petalReadyCount(s) > had;
    const sol = searchMoves(state, goal, 5);
    if (!sol) throw new Error('daisy build: no move increases ready count');
    applySeq(state, record, sol);
  }
  // B) drop each petal to the bottom
  guard = 0;
  while (!D_EDGES.every(([a, b]) => pieceHomeEdge(state, a, b))) {
    if (++guard > 12) throw new Error('cross drop did not converge');
    let acted = false;
    for (const sl of U_SLOTS) {
      if (state.colorAt(sl, U) !== 'D') continue;              // not a petal
      const other = exposedNormals(sl).map(n => state.colorAt(sl, n)).find(c => c !== 'D');
      if (pieceHomeEdge(state, 'D', other)) continue;          // this colour already solved
      // Align: rotate U so the {D,other} petal sits above face `other`.
      const fn = colorToNormal(other);
      const target = [fn[0], 1, fn[2]];
      const align = (s) => {
        const p = findEdge(s, 'D', other);
        return p && p[0] === target[0] && p[1] === 1 && p[2] === target[2]
          && s.colorAt(target, U) === 'D';
      };
      const sol = searchMoves(state, align, 3, moveSet(['U']));
      if (!sol) throw new Error(`cross align failed for D${other}`);
      applySeq(state, record, sol);
      applySeq(state, record, other + '2');                    // drop it
      acted = true;
      break;
    }
    if (!acted) throw new Error('cross drop: no petal to place');
  }
  return record;
}

// ---------------------------------------------------------------------------
// Phase 2: bottom (yellow) corners. Stage to top (shallow full-set search),
// then insert on the target slot's 3-face generator {U, side1, side2}.
// ---------------------------------------------------------------------------
function cornerInTopLayer(state, c1, c2, c3) {
  const p = findCorner(state, c1, c2, c3);
  return p && p[1] === 1;
}
function phaseBottomCorners(state) {
  const record = [];
  const placed = [];
  const crossOk = (s) => D_EDGES.every(e => pieceHomeEdge(s, e[0], e[1]));
  for (const [a, b, c] of D_CORNERS) {
    if (!pieceHomeCorner(state, a, b, c)) {
      const keep = (s) => crossOk(s) && placed.every(k => pieceHomeCorner(s, k[0], k[1], k[2]));
      // Stage into the top layer if buried.
      if (!cornerInTopLayer(state, a, b, c)) {
        const stage = (s) => cornerInTopLayer(s, a, b, c) && keep(s);
        const s1 = searchMoves(state, stage, 4);
        if (!s1) throw new Error(`bottomCorners stage failed for ${a}${b}${c}`);
        applySeq(state, record, s1);
      }
      // Insert on the slot's generator {U} + the two side faces (b, c).
      const gen = moveSet(['U', b, c]);
      const insert = (s) => pieceHomeCorner(s, a, b, c) && keep(s);
      const s2 = searchMoves(state, insert, 8, gen);
      if (!s2) throw new Error(`bottomCorners insert failed for ${a}${b}${c}`);
      applySeq(state, record, s2);
    }
    placed.push([a, b, c]);
  }
  return record;
}

// ---------------------------------------------------------------------------
// Phase 3: middle-layer edges via a greedy loop over the fixed slot inserts.
// rightInsert(f,r) places the front-top edge into the (f,r) slot, touching only
// the U layer and that slot (verified in the calibration tests).
// ---------------------------------------------------------------------------
function rightInsert(f, r) {
  return `U ${r} U' ${r}' U' ${f}' U ${f}`;
}
function midSolvedCount(state) {
  return MID_EDGES.filter(([a, b]) => pieceHomeEdge(state, a, b)).length;
}
function phaseMiddleEdges(state) {
  const record = [];
  let iters = 0;
  while (midSolvedCount(state) < 4) {
    if (++iters > 60) throw new Error('middleEdges did not converge');
    const before = midSolvedCount(state);
    let bestGain = -99, bestSetup = '', bestSlot = SLOTS[0];
    for (const [f, r] of SLOTS) {
      for (const setup of ['', 'U', 'U2', "U'"]) {
        const trial = state.clone();
        if (setup) trial.moves(setup);
        trial.moves(rightInsert(f, r));
        const gain = midSolvedCount(trial) - before;
        if (gain > bestGain) { bestGain = gain; bestSetup = setup; bestSlot = [f, r]; }
      }
    }
    // Apply the best (a non-improving move still shuffles a stuck piece up).
    if (bestSetup) applySeq(state, record, bestSetup);
    applySeq(state, record, rightInsert(bestSlot[0], bestSlot[1]));
  }
  return record;
}

// ---------------------------------------------------------------------------
// Calibrated last-layer algorithms (all act only on the U layer).
// ---------------------------------------------------------------------------
const ALG = {
  edgeCross: "F R U R' U' F'",                    // OLL edge (cross) flipper
  sune: "R U R' U R U2 R'",                        // corner orientation (twist)
  antisune: "R U2 R' U' R U' R'",                  // corner orientation (untwist)
  cornerCycleA: "R' F R' B2 R F' R' B2 R2",        // pure corner 3-cycle (Aa)
  cornerCycleB: "R B' R F2 R' B R F2 R2",          // its inverse (Ab)
  edgeCycleA: "R U' R U R U R U' R' U' R2",        // pure edge 3-cycle (Ua)
  edgeCycleB: "R2 U R U R' U' R' U' R' U R'",      // its inverse (Ub)
};

// ---------------------------------------------------------------------------
// Macro-move IDDFS: a tiny search over U turns + a small set of U-layer-only
// algorithms (given as move-token arrays). Correct-by-construction: it searches
// until goal(state) holds using only moves that preserve the first two layers.
// Applies/undoes in place; returns the flat token list, or null.
// ---------------------------------------------------------------------------
function macroSearch(state, goal, macros, maxDepth) {
  if (goal(state)) return [];
  const path = [];
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (macroDfs(state, goal, macros, depth, path, false)) return path.slice();
  }
  return null;
}
// On success: state is fully restored and `path` holds the winning token list.
function macroDfs(state, goal, macros, depth, path, lastWasU) {
  for (const m of macros) {
    if (m.isU && lastWasU) continue; // fold consecutive U turns
    for (const t of m.fwd) state.move(t);
    const mark = path.length;
    for (const t of m.fwd) path.push(t);
    let hit = false;
    if (depth === 1) hit = goal(state);
    else hit = macroDfs(state, goal, macros, depth - 1, path, m.isU);
    for (const t of m.inv) state.move(t);
    if (hit) return true;
    path.length = mark;
  }
  return false;
}
function toMacro(seq, isU = false) {
  const fwd = toList(seq);
  const inv = fwd.slice().reverse().map(inverseToken);
  return { fwd, inv, isU };
}
const U_MACROS = [toMacro('U', true), toMacro('U2', true), toMacro("U'", true)];

// ---------------------------------------------------------------------------
// Phase 4: orient last-layer edges (white cross on U).
// The edge-cross alg F R U R' U' F' advances the U-edge pattern
//   dot -> L -> line -> cross. We classify the pattern reached by each AUF and
// always pick the setup that maximises a progress score (cross>line>L>dot), so
// the cross is reached in at most 3 applications.
// ---------------------------------------------------------------------------
function llEdgeOrientedArr(state) {
  return U_EDGES.map(([a, b]) => state.colorAt(homePosEdge(a, b), U) === 'U');
}
function llEdgeOrientedCount(state) {
  return llEdgeOrientedArr(state).filter(Boolean).length;
}
// 3 = cross, 2 = line (two opposite), 1 = L (two adjacent) or single, 0 = dot.
function llEdgeScore(state) {
  const a = llEdgeOrientedArr(state); // [UF, UR, UB, UL]
  const c = a.filter(Boolean).length;
  if (c === 4) return 3;
  if (c === 0) return 0;
  if (c === 2) return (a[0] && a[2]) || (a[1] && a[3]) ? 2 : 1; // opposite=line
  return 1;
}
function phaseLLEdgeOrient(state) {
  const record = [];
  let iters = 0;
  while (llEdgeOrientedCount(state) < 4) {
    if (++iters > 8) throw new Error('LLEdgeOrient did not converge');
    let bestScore = -1, bestSetup = '';
    for (const setup of ['', 'U', 'U2', "U'"]) {
      const trial = state.clone();
      if (setup) trial.moves(setup);
      trial.moves(ALG.edgeCross);
      const sc = llEdgeScore(trial);
      if (sc > bestScore) { bestScore = sc; bestSetup = setup; }
    }
    if (bestSetup) applySeq(state, record, bestSetup);
    applySeq(state, record, ALG.edgeCross);
  }
  return record;
}

// ---------------------------------------------------------------------------
// Phase 5: orient last-layer corners (whole U face white).
// ---------------------------------------------------------------------------
function llCornerOrientedCount(state) {
  let n = 0;
  for (const [a, b, c] of U_CORNERS) if (state.colorAt(homePosCorner(a, b, c), U) === 'U') n++;
  return n;
}
const CO_MACROS = [...U_MACROS, toMacro(ALG.sune), toMacro(ALG.antisune)];
function phaseLLCornerOrient(state) {
  const goal = (s) => llCornerOrientedCount(s) === 4;
  const sol = macroSearch(state, goal, CO_MACROS, 10);
  if (!sol) throw new Error('LLCornerOrient did not converge');
  const record = [];
  applySeq(state, record, sol);
  return record;
}

// ---------------------------------------------------------------------------
// Phase 6: permute last-layer corners (correct homes; twist preserved).
// ---------------------------------------------------------------------------
function llCornerPermCount(state) {
  let n = 0;
  for (const [a, b, c] of U_CORNERS) if (cornerInPlace(state, a, b, c)) n++;
  return n;
}
const CP_MACROS = [...U_MACROS, toMacro(ALG.cornerCycleA), toMacro(ALG.cornerCycleB)];
function phaseLLCornerPerm(state) {
  const goal = (s) => llCornerPermCount(s) === 4;
  const sol = macroSearch(state, goal, CP_MACROS, 8);
  if (!sol) throw new Error('LLCornerPerm did not converge');
  const record = [];
  applySeq(state, record, sol);
  return record;
}

// ---------------------------------------------------------------------------
// Phase 7: permute last-layer edges -> solved.
// ---------------------------------------------------------------------------
function llEdgePermCount(state) {
  let n = 0;
  for (const [a, b] of U_EDGES) if (pieceHomeEdge(state, a, b)) n++;
  return n;
}
const EP_MACROS = [...U_MACROS, toMacro(ALG.edgeCycleA), toMacro(ALG.edgeCycleB)];
function phaseLLEdgePerm(state) {
  // Search directly for the fully solved cube (this is the last phase), so the
  // final AUF alignment is found by the search itself.
  const goal = (s) => s.isSolved();
  const sol = macroSearch(state, goal, EP_MACROS, 8);
  if (!sol) throw new Error('LLEdgePerm did not converge');
  const record = [];
  applySeq(state, record, sol);
  return record;
}

// ---------------------------------------------------------------------------
// Stitching per-phase algorithms together leaves redundant seams: the same face
// turned twice in a row (e.g. U' then U, or U2 then U). Those are never a real
// step — they cancel or combine — and confuse a follower. This pass collapses
// every run of same-face moves into a single turn (dropping identities), which
// is exactly effect-preserving, while keeping each move in its phase so the
// grouped strip is unchanged. Phase labels are preserved even if a phase empties.
const QUARTER = { '': 1, '2': 2, "'": 3 };       // clockwise quarter-turns, mod 4
const SUFFIX = { 1: '', 2: '2', 3: "'" };        // 0 ⇒ identity, dropped
function simplifySteps(steps) {
  const stack = []; // {face, amt, si} — si non-decreasing, no two adjacent same face
  steps.forEach((s, si) => {
    for (const m of s.moves) {
      const face = m[0], amt = QUARTER[m.slice(1)];
      const top = stack[stack.length - 1];
      if (top && top.face === face) {
        const merged = (top.amt + amt) % 4;
        stack.pop();
        if (merged) stack.push({ face, amt: merged, si: top.si }); // keep earlier phase
      } else {
        stack.push({ face, amt, si });
      }
    }
  });
  const out = steps.map(s => ({ name: s.name, moves: [] }));
  for (const mv of stack) out[mv.si].moves.push(mv.face + SUFFIX[mv.amt]);
  return out;
}

// Public API
// ---------------------------------------------------------------------------
export function solve(inputState) {
  const state = inputState.clone();
  const steps = [];
  const push = (name, moves) => steps.push({ name, moves });

  push('Bottom cross', phaseBottomCross(state));
  push('Bottom corners', phaseBottomCorners(state));
  push('Middle edges', phaseMiddleEdges(state));
  push('Top cross', phaseLLEdgeOrient(state));
  push('Top face', phaseLLCornerOrient(state));
  push('Corner positions', phaseLLCornerPerm(state));
  push('Edge positions', phaseLLEdgePerm(state));

  if (!state.isSolved()) throw new Error('solve did not reach a solved state');
  return { steps: simplifySteps(steps) };
}

export function solveMoves(inputState) {
  return solve(inputState).steps.flatMap(s => s.moves);
}

// Internal phase runners, exposed for calibration / unit tests only.
export const _internals = {
  phaseBottomCross, phaseBottomCorners, phaseMiddleEdges,
  phaseLLEdgeOrient, phaseLLCornerOrient, phaseLLCornerPerm, phaseLLEdgePerm,
  llEdgeOrientedCount, llCornerOrientedCount, llCornerPermCount, llEdgePermCount,
  ALG,
};
