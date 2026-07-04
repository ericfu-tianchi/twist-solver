import * as THREE from 'three';
import { UNIT } from './cube.js';

// Per-sticker motion arrows for a guided move (Eric's locked concept, validated in
// arrow-lab5/6). For the layer that must turn, we draw a small SOLID BLACK arrow on
// each camera-facing SIDE sticker, pointing the way that sticker travels. The outer
// (axis) face and any sticker facing away from the camera are skipped.
//
// This is the ONE shared code path: both the app (main.js) and the screenshot
// verify harness import it, so what gets tested is exactly what ships.

const AXIS_I = { x: 0, y: 1, z: 2 };

// solid near-black arrow (arrow-lab6 pick #1) — flat, unlit, reads cleanly on bright stickers
export const ARROW_MAT = new THREE.MeshBasicMaterial({
  color: 0x141414, side: THREE.DoubleSide, toneMapped: false,
});

// flat extruded arrow glyph lying in its local XY plane: shaft along +X, faces +Z
function arrowGeometry(len = 0.62, w = 0.15, headL = 0.26, headW = 0.36, thick = 0.04) {
  const s = new THREE.Shape();
  const x0 = -len / 2, x1 = len / 2, xh = x1 - headL;
  s.moveTo(x0, w / 2); s.lineTo(xh, w / 2); s.lineTo(xh, headW / 2); s.lineTo(x1, 0);
  s.lineTo(xh, -headW / 2); s.lineTo(xh, -w / 2); s.lineTo(x0, -w / 2); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  return g;
}
// shared across every arrow mesh — never dispose it per-step
export const ARROW_GEO = arrowGeometry();

// snap a near-axis direction to a clean integer ±unit axis vector
function roundToAxis(v) {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(v.x), 0, 0);
  if (ay >= az) return new THREE.Vector3(0, Math.sign(v.y), 0);
  return new THREE.Vector3(0, 0, Math.sign(v.z));
}

const _wp = new THREE.Vector3();
const _wd = new THREE.Vector3();

/**
 * Build the arrow group for one quarter turn.
 * An arrow is placed on EVERY side sticker of the moving layer (all four faces around
 * the axis), not just the camera-facing ones — so when the user orbits in free mode the
 * back faces are marked too. Depth-testing hides the ones currently facing away.
 * @param cube    the RubiksCube (arrows read its live, possibly-rotated cubies)
 * @param axisKey 'x' | 'y' | 'z'
 * @param layer   -1 | 0 | 1  (the turning layer along axisKey)
 * @param sign    rotation sign about +axis (parseMove().sign — already handles primes)
 * @returns THREE.Group meant to be added under cube.group (scales with it)
 */
export function buildMotionArrows(cube, axisKey, layer, sign) {
  const g = new THREE.Group();
  const ai = AXIS_I[axisKey];
  const omega = new THREE.Vector3(axisKey === 'x' ? 1 : 0, axisKey === 'y' ? 1 : 0, axisKey === 'z' ? 1 : 0)
    .multiplyScalar(sign);
  cube.group.updateMatrixWorld(true); // ensure sticker world transforms are current

  for (const cubie of cube.cubies) {
    if (Math.round(cubie.position[axisKey] / UNIT) !== layer) continue;
    for (const ch of cubie.children) {
      if (!ch.userData.isSticker) continue;
      // A layer's cubies get rotated by past turns, so a sticker's LOCAL position no
      // longer equals its facing. Read both from the live world transform instead.
      const pos = cube.group.worldToLocal(ch.getWorldPosition(_wp).clone()); // rel. to cube centre
      const n = roundToAxis(ch.getWorldDirection(_wd));                      // integer face normal
      if (Math.abs([n.x, n.y, n.z][ai]) > 0.5) continue; // skip the layer's outer/axis face

      const v = new THREE.Vector3().crossVectors(omega, pos); // tangential velocity of this sticker
      v.addScaledVector(n, -v.dot(n));                        // project onto the face plane
      if (v.lengthSq() < 1e-6) continue;
      v.normalize();
      const up = new THREE.Vector3().crossVectors(n, v).normalize();

      const m = new THREE.Mesh(ARROW_GEO, ARROW_MAT);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v, up, n));
      m.position.copy(pos).addScaledVector(n, 0.055); // float just above the sticker
      g.add(m);
    }
  }
  return g;
}
