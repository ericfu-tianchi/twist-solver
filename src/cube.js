import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CubeState } from './state.js';

// --- geometry constants -----------------------------------------------------
export const UNIT = 1.03;   // distance between neighbouring cubie centres
const BODY = 0.98;          // cubie body edge length
const STICKER = 0.85;       // coloured sticker tile size

// Classic (WCA) colour scheme: white top, green front, red right.
export const COLORS = {
  U: 0xf6f6f3, // white   (up,    +Y)
  D: 0xffd500, // yellow  (down,  -Y)
  F: 0x009b48, // green   (front, +Z)
  B: 0x0046ad, // blue    (back,  -Z)
  R: 0xb71234, // red     (right, +X)
  L: 0xff5800, // orange  (left,  -X)
};
const BODY_COLOR = 0x0b0b0d;

// notation -> [axisKey, layerValue, baseSign]
// baseSign = rotation sign about the +axis that produces a clockwise (unprimed) turn.
const FACE = {
  U: ['y',  1, -1], D: ['y', -1,  1],
  R: ['x',  1, -1], L: ['x', -1,  1],
  F: ['z',  1, -1], B: ['z', -1,  1],
};
// whole-cube reorientation -> [axisKey, baseSign]  (x≈R, y≈U, z≈F direction)
const WHOLE = { x: ['x', -1], y: ['y', -1], z: ['z', -1] };

const HALF = Math.PI / 2;
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// multiply a colour's HSL saturation/lightness in place (clamped) — used by the solve highlight
const clamp01 = x => Math.max(0, Math.min(1, x));
function hslMul(color, s, l) {
  const h = {};
  color.getHSL(h);
  color.setHSL(h.h, clamp01(h.s * s), clamp01(h.l * l));
}

// outward normal of each face, as an integer axis vector
export const FACE_NORMAL = {
  U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0],
};

const AXIS_INDEX = { x: 0, y: 1, z: 2 };
// rotate an integer vector by s*90deg (right-handed) about the given axis — mirrors state.js
function rotVec([x, y, z], axis, s) {
  if (axis === 'x') return [x, -s * z, s * y];
  if (axis === 'y') return [s * z, y, -s * x];
  return [-s * y, s * x, z];
}

/** Parse notation into { sym, axisKey, layer (null=whole cube), sign, quarters, whole }. */
export function parseMove(token) {
  const m = /^([UDLRFBxyz])(['2]?)$/.exec(token);
  if (!m) return null;
  const [, sym, mod] = m;
  const quarters = mod === '2' ? 2 : 1;
  if (WHOLE[sym]) {
    const [axisKey, base] = WHOLE[sym];
    return { sym, axisKey, layer: null, sign: mod === "'" ? -base : base, quarters, whole: true };
  }
  const [axisKey, layer, base] = FACE[sym];
  return { sym, axisKey, layer, sign: mod === "'" ? -base : base, quarters, whole: false };
}

/**
 * A 3x3 Rubik's cube: 27 cubies parented to `group`.
 * Every action is expressed as standard notation and pushed onto a serial
 * queue, so manual turns, drag turns and (later) solver playback share one engine.
 */
export class RubiksCube {
  constructor() {
    this.group = new THREE.Group();
    this.cubies = [];       // 27 cubie groups
    this.pickables = [];    // meshes usable for raycasting (bodies + stickers)
    this.state = new CubeState(); // logical model kept in lock-step with the 3D turns
    this._stickerByHome = new Map(); // "face:x,y,z" -> sticker mesh (for edit mode)
    this._colorSave = [];   // {mat, hex} of stickers dimmed by the solve highlight, for restore
    this._queue = [];
    this._running = false;
    this.turnDuration = 240; // ms per quarter turn
    this._build();
  }

  _build() {
    const bodyGeo = new RoundedBoxGeometry(BODY, BODY, BODY, 4, 0.09);
    const stickerGeo = new RoundedBoxGeometry(STICKER, STICKER, 0.06, 3, 0.06);
    const fromNormal = new THREE.Vector3(0, 0, 1); // sticker's default facing

    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const cubie = new THREE.Group();
          cubie.position.set(x * UNIT, y * UNIT, z * UNIT);
          cubie.userData.isCubie = true;

          const body = new THREE.Mesh(
            bodyGeo,
            new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.55, metalness: 0.0 }),
          );
          body.castShadow = true;
          body.receiveShadow = true;
          body.userData.cubie = cubie;
          cubie.add(body);
          this.pickables.push(body);

          const faces = [];
          if (y === 1)  faces.push(['U', new THREE.Vector3(0, 1, 0)]);
          if (y === -1) faces.push(['D', new THREE.Vector3(0, -1, 0)]);
          if (z === 1)  faces.push(['F', new THREE.Vector3(0, 0, 1)]);
          if (z === -1) faces.push(['B', new THREE.Vector3(0, 0, -1)]);
          if (x === 1)  faces.push(['R', new THREE.Vector3(1, 0, 0)]);
          if (x === -1) faces.push(['L', new THREE.Vector3(-1, 0, 0)]);

          for (const [face, normal] of faces) {
            const tile = new THREE.Mesh(
              stickerGeo,
              new THREE.MeshStandardMaterial({
                color: COLORS[face], roughness: 0.3, metalness: 0.0, envMapIntensity: 0.9,
              }),
            );
            tile.quaternion.setFromUnitVectors(fromNormal, normal);
            tile.position.copy(normal).multiplyScalar(0.5);
            tile.receiveShadow = true;
            tile.userData.cubie = cubie;
            tile.userData.isSticker = true;
            cubie.add(tile);
            this.pickables.push(tile);
            this._stickerByHome.set(`${face}:${x},${y},${z}`, tile);
          }

          this.cubies.push(cubie);
          this.group.add(cubie);
        }
  }

  // --- public move API ------------------------------------------------------

  /** Apply one move in standard notation, e.g. "R", "U'", "F2", "x", "y'". */
  move(token) {
    const m = /^([UDLRFBxyz])(['2]?)$/.exec(token);
    if (!m) return Promise.resolve();
    const [, sym, mod] = m;
    const quarters = mod === '2' ? 2 : 1;

    if (WHOLE[sym]) {
      const [axisKey, base] = WHOLE[sym];
      return this._enqueue(null, axisKey, mod === "'" ? -base : base, quarters);
    }
    const [axisKey, layer, base] = FACE[sym];
    return this._enqueue(layer, axisKey, mod === "'" ? -base : base, quarters);
  }

  /** Low-level: rotate the layer at `layer` along `axisKey` by sign*90deg. Used by drag-to-turn. */
  turnAxisLayer(axisKey, layer, sign, quarters = 1) {
    return this._enqueue(layer, axisKey, sign, quarters);
  }

  scramble(n = 20) {
    const faces = ['U', 'D', 'L', 'R', 'F', 'B'];
    const mods = ['', "'", '2'];
    let last = '';
    for (let i = 0; i < n; i++) {
      let f;
      do { f = faces[Math.floor(Math.random() * 6)]; } while (f === last);
      last = f;
      this.move(f + mods[Math.floor(Math.random() * 3)]);
    }
  }

  isBusy() { return this._running; }

  /** A clone of the current logical state, for the solver. */
  getState() { return this.state.clone(); }

  /** Colour currently shown at a face's home cell, e.g. colorShownAt('F',[0,0,1]). */
  colorShownAt(face, pos) { return this.state.colorAt(pos, FACE_NORMAL[face]); }

  /** Paint one sticker (mesh + logical facelet). Only meaningful with pieces at home. */
  paint(face, pos, letter) {
    const tile = this._stickerByHome.get(`${face}:${pos.join(',')}`);
    if (tile) tile.material.color.setHex(COLORS[letter]);
    const n = FACE_NORMAL[face];
    const f = this.state.facelets.find(f =>
      f.n[0] === n[0] && f.n[1] === n[1] && f.n[2] === n[2] &&
      f.p[0] === pos[0] && f.p[1] === pos[1] && f.p[2] === pos[2]);
    if (f) f.c = letter;
  }

  /**
   * Solve highlight ("variant C"): keep the moving layer's stickers vivid and mute
   * every other layer, so the layer you must turn pops without losing any hue.
   * Saves each sticker's true colour first so clearSolveHighlight restores it exactly.
   */
  setSolveHighlight(axisKey, layer) {
    this.clearSolveHighlight();
    for (const c of this.cubies) {
      const active = layer === null || Math.round(c.position[axisKey] / UNIT) === layer;
      for (const child of c.children) {
        if (!child.userData.isSticker) continue;
        const mat = child.material;
        this._colorSave.push({ mat, hex: mat.color.getHex() });
        if (active) hslMul(mat.color, 1.16, 1.12); // moving layer: richer + brighter
        else hslMul(mat.color, 0.62, 0.66);        // the rest: gently dimmed, still coloured (not gloomy)
      }
    }
  }

  clearSolveHighlight() {
    for (const s of this._colorSave) s.mat.color.setHex(s.hex);
    this._colorSave.length = 0;
  }

  dispose() {
    this._queue.length = 0;
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) o.material.dispose?.();
    });
    this.group.removeFromParent();
  }

  // --- serial queue + animation --------------------------------------------

  _enqueue(layer, axisKey, sign, quarters) {
    return new Promise(resolve => {
      this._queue.push(async () => {
        await this._run(layer, axisKey, sign, quarters);
        resolve();
      });
      this._drain();
    });
  }

  async _drain() {
    if (this._running) return;
    this._running = true;
    while (this._queue.length) await this._queue.shift()();
    this._running = false;
  }

  async _run(layer, axisKey, sign, quarters) {
    // keep the logical model in sync with the visual turn
    const ai = AXIS_INDEX[axisKey];
    for (let t = 0; t < quarters; t++)
      for (const f of this.state.facelets)
        if (layer === null || f.p[ai] === layer) {
          f.p = rotVec(f.p, axisKey, sign);
          f.n = rotVec(f.n, axisKey, sign);
        }

    const pivot = new THREE.Group();
    this.group.add(pivot);

    const affected = layer === null
      ? this.cubies.slice()
      : this.cubies.filter(c => Math.round(c.position[axisKey] / UNIT) === layer);
    affected.forEach(c => pivot.attach(c)); // reparent, preserving world transform

    const target = sign * HALF * quarters;
    await this._animate(pivot, axisKey, target, this.turnDuration * quarters);

    // snap to the exact angle, then hand cubies back to the cube root on the grid
    pivot.rotation[axisKey] = target;
    pivot.updateMatrixWorld(true);
    affected.forEach(c => {
      this.group.attach(c);
      c.position.set(
        Math.round(c.position.x / UNIT) * UNIT,
        Math.round(c.position.y / UNIT) * UNIT,
        Math.round(c.position.z / UNIT) * UNIT,
      );
    });
    this.group.remove(pivot);
  }

  _animate(pivot, axisKey, target, duration) {
    return new Promise(resolve => {
      if (duration <= 0) { pivot.rotation[axisKey] = target; resolve(); return; } // instant turn
      let start = null;
      const step = ts => {
        if (start === null) start = ts;
        const t = Math.min(1, (ts - start) / duration);
        pivot.rotation[axisKey] = target * easeInOutCubic(t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }
}
