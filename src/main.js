import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RubiksCube, UNIT } from './cube.js';

const wrap = document.getElementById('scene');
const W = () => wrap.clientWidth;
const H = () => wrap.clientHeight;

// --- renderer ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W(), H());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
wrap.appendChild(renderer.domElement);

// --- scene / environment ----------------------------------------------------
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(38, W() / H(), 0.1, 100);
camera.position.set(3.4, 3.6, 8.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.enableRotate = false; // enabled only in free mode
controls.minDistance = 6;
controls.maxDistance = 15;
controls.target.set(0, 0, 0);

// --- lighting ---------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a33, 0.6));

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(6, 10, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 40;
key.shadow.camera.left = -6;
key.shadow.camera.right = 6;
key.shadow.camera.top = 6;
key.shadow.camera.bottom = -6;
key.shadow.bias = -0.0004;
key.shadow.radius = 6;
scene.add(key);

const fill = new THREE.DirectionalLight(0xa9c3ff, 0.5);
fill.position.set(-7, 3, -4);
scene.add(fill);

// soft contact shadow on the floor
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.ShadowMaterial({ opacity: 0.3 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -2.45;
ground.receiveShadow = true;
scene.add(ground);

// --- cube -------------------------------------------------------------------
let cube = new RubiksCube();
scene.add(cube.group);

// --- resize + render loop ---------------------------------------------------
addEventListener('resize', () => {
  camera.aspect = W() / H();
  camera.updateProjectionMatrix();
  renderer.setSize(W(), H());
});

(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
})();

// --- free mode toggle -------------------------------------------------------
let freeMode = false;
const freeToggle = document.getElementById('freeToggle');
function setFree(on) {
  freeMode = on;
  controls.enableRotate = on;
  freeToggle.classList.toggle('on', on);
  freeToggle.setAttribute('aria-pressed', String(on));
}
freeToggle.addEventListener('click', () => setFree(!freeMode));

// --- recenter: glide the camera back to the default face-on view ------------
const HOME_POS = new THREE.Vector3(3.4, 3.6, 8.4);
const HOME_TARGET = new THREE.Vector3(0, 0, 0);
let homing = false;
function homeView() {
  if (homing) return;
  homing = true;
  const p0 = camera.position.clone();
  const t0 = controls.target.clone();
  const wasRotate = controls.enableRotate;
  controls.enabled = false; // let the tween own the camera briefly
  const dur = 520;
  let start = null;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = ts => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / dur);
    const k = ease(t);
    camera.position.lerpVectors(p0, HOME_POS, k);
    controls.target.lerpVectors(t0, HOME_TARGET, k);
    camera.lookAt(controls.target);
    if (t < 1) requestAnimationFrame(step);
    else { controls.enabled = true; controls.enableRotate = wasRotate; homing = false; }
  };
  requestAnimationFrame(step);
}
document.getElementById('recenter').addEventListener('click', homeView);

// --- button + keyboard wiring ----------------------------------------------
document.querySelectorAll('[data-face]').forEach(btn => {
  btn.addEventListener('click', e => cube.move(btn.dataset.face + (e.shiftKey ? "'" : '')));
  btn.addEventListener('contextmenu', e => { e.preventDefault(); cube.move(btn.dataset.face + "'"); });
});
document.querySelectorAll('[data-move]').forEach(btn => {
  btn.addEventListener('click', () => cube.move(btn.dataset.move));
});
document.getElementById('scramble').addEventListener('click', () => cube.scramble(20));
document.getElementById('reset').addEventListener('click', () => {
  cube.dispose();
  cube = new RubiksCube();
  scene.add(cube.group);
});

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (/^[udlrfb]$/i.test(k)) cube.move(k.toUpperCase() + (e.shiftKey ? "'" : ''));
  else if (/^[xyz]$/i.test(k)) cube.move(k.toLowerCase() + (e.shiftKey ? "'" : ''));
  else if (k === 'c' || k === 'C') homeView();
  else if (k === ' ') { e.preventDefault(); setFree(!freeMode); }
});

// --- drag-to-turn -----------------------------------------------------------
// Grab a sticker and drag: pick the in-face direction closest to the drag,
// spin the layer around the remaining axis. Geometrically self-consistent,
// so it stays correct regardless of the notation sign convention.
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const axisKeyOf = v => (Math.abs(v.x) > 0.5 ? 'x' : Math.abs(v.y) > 0.5 ? 'y' : 'z');
let drag = null;

function toNDC(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
function toPixel(v) {
  const r = renderer.domElement.getBoundingClientRect();
  const p = v.clone().project(camera);
  return new THREE.Vector2((p.x * 0.5 + 0.5) * r.width, (-p.y * 0.5 + 0.5) * r.height);
}
function roundToAxis(v) {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(v.x), 0, 0);
  if (ay >= az) return new THREE.Vector3(0, Math.sign(v.y), 0);
  return new THREE.Vector3(0, 0, Math.sign(v.z));
}

renderer.domElement.addEventListener('pointerdown', e => {
  if (freeMode || cube.isBusy() || e.button !== 0) return;
  toNDC(e);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(cube.pickables, false)[0];
  if (!hit) return;

  const normal = roundToAxis(hit.face.normal.clone().transformDirection(hit.object.matrixWorld));
  const nKey = axisKeyOf(normal);
  drag = {
    normal,
    cubie: hit.object.userData.cubie,
    point: hit.point.clone(),
    tangents: AXES.filter(a => axisKeyOf(a) !== nKey), // the two in-face axes
    x: e.clientX,
    y: e.clientY,
    done: false,
  };
  renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener('pointermove', e => {
  if (!drag || drag.done) return;
  const dv = new THREE.Vector2(e.clientX - drag.x, e.clientY - drag.y);
  if (dv.length() < 10) return;

  // which in-face axis does the drag follow on screen?
  const base = toPixel(drag.point);
  let best = null;
  for (const t of drag.tangents) {
    const scr = toPixel(drag.point.clone().add(t.clone().multiplyScalar(0.5))).sub(base);
    const proj = dv.dot(scr) / (scr.length() || 1);
    if (!best || Math.abs(proj) > Math.abs(best.proj)) best = { t, proj };
  }
  const tAxis = best.t;                                    // dragged direction (in-face)
  const rotAxis = drag.tangents.find(a => a !== tAxis);    // layer spins around the other in-face axis
  const axisKey = axisKeyOf(rotAxis);
  const layer = Math.round(drag.cubie.position[axisKey] / UNIT);

  // sign about +rotAxis so the grabbed point moves along the drag
  const sign = Math.sign(new THREE.Vector3().crossVectors(rotAxis, drag.normal).dot(tAxis))
    * Math.sign(best.proj);

  drag.done = true;
  cube.turnAxisLayer(axisKey, layer, sign);
});

['pointerup', 'pointercancel'].forEach(ev =>
  renderer.domElement.addEventListener(ev, e => {
    drag = null;
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }),
);
