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
