import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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
            cubie.add(tile);
            this.pickables.push(tile);
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
