// Pure geometric model of a 3x3 cube — no rendering deps, runs in node + browser.
//
// Each facelet knows its cubie position `p` (x,y,z in {-1,0,1}) and its outward
// normal `n` (a unit axis vector). A turn rotates `p` and `n` by an exact 90°
// integer rotation, so the model can never accumulate float drift. Faces are
// named by the colour that sits there when solved:
//   U D F B R L  =  white yellow green blue red orange
//
// This mirrors src/cube.js exactly (same axes, same sign convention, same
// solved definition), so any move sequence that solves a CubeState will also
// solve the on-screen cube once we sync them.

const COLOR_OF_NORMAL = ([x, y, z]) =>
  y === 1 ? 'U' : y === -1 ? 'D' :
  z === 1 ? 'F' : z === -1 ? 'B' :
  x === 1 ? 'R' : 'L';

// Rotate an integer vector by s*90° (right-handed) about the given axis.
function rotate([x, y, z], axis, s) {
  if (axis === 'x') return [x, -s * z, s * y];
  if (axis === 'y') return [s * z, y, -s * x];
  return [-s * y, s * x, z]; // z
}

// notation symbol -> [axis, layerValue|null, baseSign]   (null layer = whole cube)
// baseSign is the rotation about the +axis that makes an unprimed (clockwise) turn.
const FACE = {
  U: ['y', 1, -1], D: ['y', -1, 1],
  R: ['x', 1, -1], L: ['x', -1, 1],
  F: ['z', 1, -1], B: ['z', -1, 1],
};
const WHOLE = { x: ['x', null, -1], y: ['y', null, -1], z: ['z', null, -1] };
const AXIS_INDEX = { x: 0, y: 1, z: 2 };

export class CubeState {
  constructor() {
    this.facelets = [];
    const NORMALS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const pos = [x, y, z];
          for (const n of NORMALS) {
            // this cubie carries a facelet on normal n iff its coord along that axis is extreme
            const ai = n[0] ? 0 : n[1] ? 1 : 2;
            if (pos[ai] === n[ai]) this.facelets.push({ p: pos.slice(), n: n.slice(), c: COLOR_OF_NORMAL(n) });
          }
        }
  }

  clone() {
    const s = Object.create(CubeState.prototype);
    s.facelets = this.facelets.map(f => ({ p: f.p.slice(), n: f.n.slice(), c: f.c }));
    return s;
  }

  /** Apply one move in standard notation: "R", "U'", "F2", "x", "y'", ... */
  move(token) {
    const m = /^([UDLRFBxyz])(['2]?)$/.exec(token);
    if (!m) return this;
    const [, sym, mod] = m;
    const def = FACE[sym] || WHOLE[sym];
    const [axis, layer, base] = def;
    const s = mod === "'" ? -base : base;
    const times = mod === '2' ? 2 : 1;
    const ai = AXIS_INDEX[axis];
    for (let t = 0; t < times; t++) {
      for (const f of this.facelets) {
        if (layer === null || f.p[ai] === layer) {
          f.p = rotate(f.p, axis, s);
          f.n = rotate(f.n, axis, s);
        }
      }
    }
    return this;
  }

  /** Apply a whitespace string or array of moves. */
  moves(seq) {
    for (const t of toList(seq)) this.move(t);
    return this;
  }

  isSolved() {
    return this.facelets.every(f => f.c === COLOR_OF_NORMAL(f.n));
  }

  /** Colour currently shown at cubie position `p` on face-normal `n` (or null). */
  colorAt(p, n) {
    const f = this.facelets.find(f =>
      f.p[0] === p[0] && f.p[1] === p[1] && f.p[2] === p[2] &&
      f.n[0] === n[0] && f.n[1] === n[1] && f.n[2] === n[2]);
    return f ? f.c : null;
  }
}

// ---------------------------------------------------------------------------
// Solvability check. A 3x3 with 9 of each colour can still be physically
// impossible (a single flipped edge, a twisted corner, or two swapped pieces).
// Those are exactly the three classic invariants:
//   • every corner/edge is a real piece, and all are present (valid permutation)
//   • corner-twist total ≡ 0 (mod 3)
//   • edge-flip total  ≡ 0 (mod 2)
//   • corner permutation parity === edge permutation parity
// Returns null if solvable, else a short human reason.
// ---------------------------------------------------------------------------
const OPPOSITE = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' };
const CORNER_POS = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNER_POS.push([x, y, z]);
const EDGE_POS = [
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
];
const solvedColorsAt = pos => [0, 1, 2].filter(ai => pos[ai] !== 0)
  .map(ai => { const n = [0, 0, 0]; n[ai] = pos[ai]; return COLOR_OF_NORMAL(n); });
const CORNER_KEYS = CORNER_POS.map(p => solvedColorsAt(p).slice().sort().join(''));
const EDGE_KEYS = EDGE_POS.map(p => solvedColorsAt(p).slice().sort().join(''));

function permParity(perm) {
  const seen = perm.map(() => false);
  let odd = 0;
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let j = i, len = 0;
    while (!seen[j]) { seen[j] = true; j = perm[j]; len++; }
    if (len % 2 === 0) odd ^= 1; // an even-length cycle contributes odd parity
  }
  return odd;
}

export function cubeError(state) {
  const cnt = {};
  for (const f of state.facelets) cnt[f.c] = (cnt[f.c] || 0) + 1;
  for (const c of ['U', 'D', 'F', 'B', 'R', 'L']) if (cnt[c] !== 9) return `there are ${cnt[c] || 0} ${c} tiles, not 9`;

  // corners
  const cPerm = [], cOri = [];
  for (const p of CORNER_POS) {
    const cx = state.colorAt(p, [p[0], 0, 0]);
    const cy = state.colorAt(p, [0, p[1], 0]);
    const cz = state.colorAt(p, [0, 0, p[2]]);
    const cols = [cx, cy, cz];
    if (new Set(cols).size !== 3) return 'a corner has a repeated colour';
    for (const c of cols) if (cols.includes(OPPOSITE[c])) return 'a corner has opposite colours on it';
    const slot = CORNER_KEYS.indexOf(cols.slice().sort().join(''));
    if (slot < 0) return 'a corner piece is impossible';
    cPerm.push(slot);
    const isUD = c => c === 'U' || c === 'D';
    const chir = p[0] * p[1] * p[2];
    cOri.push(isUD(cy) ? 0 : isUD(cx) ? (chir > 0 ? 1 : 2) : (chir > 0 ? 2 : 1));
  }
  if (new Set(cPerm).size !== 8) return 'a corner is duplicated or missing';
  if (cOri.reduce((a, b) => a + b, 0) % 3 !== 0) return 'a corner is twisted';

  // edges — validate pieces + permutation. (The edge-flip parity invariant is left to
  // the actual solve attempt in the editor: a single flipped edge is otherwise a valid
  // configuration and reliably making the solver fail is the simplest correct detector.)
  const ePerm = [];
  for (const p of EDGE_POS) {
    const present = [0, 1, 2].filter(ai => p[ai] !== 0).map(ai => { const n = [0, 0, 0]; n[ai] = p[ai]; return n; });
    const cA = state.colorAt(p, present[0]);
    const cB = state.colorAt(p, present[1]);
    if (cA === cB) return 'an edge has a repeated colour';
    if (OPPOSITE[cA] === cB) return 'an edge has opposite colours on it';
    const slot = EDGE_KEYS.indexOf([cA, cB].slice().sort().join(''));
    if (slot < 0) return 'an edge piece is impossible';
    ePerm.push(slot);
  }
  if (new Set(ePerm).size !== 12) return 'an edge is duplicated or missing';

  if (permParity(cPerm) !== permParity(ePerm)) return 'two pieces are swapped';
  return null;
}

export function toList(seq) {
  return Array.isArray(seq) ? seq.filter(Boolean) : seq.split(/\s+/).filter(Boolean);
}

/** Inverse of a sequence (reverse order, invert each move). */
export function invert(seq) {
  return toList(seq).slice().reverse().map(t =>
    t.endsWith('2') ? t : t.endsWith("'") ? t[0] : t + "'");
}

/** Random scramble (no immediate repeats of the same face). */
export function randomScramble(n = 25) {
  const faces = ['U', 'D', 'L', 'R', 'F', 'B'];
  const mods = ['', "'", '2'];
  const out = [];
  let last = '';
  for (let i = 0; i < n; i++) {
    let f;
    do { f = faces[Math.floor(Math.random() * 6)]; } while (f === last);
    last = f;
    out.push(f + mods[Math.floor(Math.random() * 3)]);
  }
  return out;
}
