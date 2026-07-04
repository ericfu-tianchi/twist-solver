import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RubiksCube, UNIT, parseMove, COLORS, FACE_NORMAL } from './cube.js';
import { CubeState, cubeError } from './state.js';
import { buildMotionArrows } from './solveVisuals.js';
// solver.js is imported lazily (see ensureSolver) so the cube + editor still
// work even while the solver module is being finalised.

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

// --- camera control: seamless arcball rotate (free mode); wheel/pinch = zoom -----
// Standard "hero" orientation: front(green) toward you, white on top, red on the
// right — the conventional way a cube is depicted (F + U + R all visible).
const TARGET = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
// FRONT_VIEW: dead-on the front (green) face — the recenter / default view.
// SOLVE_VIEW: a fixed 3/4 (green front, white top, red right) that stays LOCKED for
// the whole guided solve, so every arrow reads without moving. The ONE exception is a
// Back (B) turn: the back slice's side stickers barely show from the front 3/4, so B
// steps nudge to SOLVE_VIEW_B (a touch higher + more right) to reveal their arrows.
// distances are pulled back a bit so the cube sits with breathing room inside the stage
// cell; arrow correctness depends only on the view DIRECTION, so this leaves them intact.
const FRONT_VIEW = new THREE.Vector3(0, 0, 10);
const SOLVE_VIEW = new THREE.Vector3(5.75, 4.62, 8.0);
const SOLVE_VIEW_B = new THREE.Vector3(6.75, 6.5, 6.75);
const solveViewFor = token => (token && token[0] === 'B' ? SOLVE_VIEW_B : SOLVE_VIEW);
camera.position.copy(FRONT_VIEW);
camera.lookAt(TARGET);

// Free-look = TURNTABLE + INERTIA (chosen in drag-lab): yaw around world-Y, pitch around
// world-X (clamped, so "up" always stays up — no roll, which makes a target angle easy to
// hit), plus a flick-to-spin that glides to a stop. Camera orbits on a sphere around TARGET.
let sphR = FRONT_VIEW.length(), sphTheta = 0, sphPhi = Math.PI / 2;
let spinVTheta = 0, spinVPhi = 0, spinning = false;
const PHI_MIN = 0.12, PHI_MAX = Math.PI - 0.12;
function syncSpherical() {
  const p = camera.position.clone().sub(TARGET);
  sphR = p.length();
  sphTheta = Math.atan2(p.x, p.z);
  sphPhi = Math.acos(Math.max(-1, Math.min(1, p.y / sphR)));
}
function applySpherical() {
  const s = Math.sin(sphPhi);
  camera.position.set(
    TARGET.x + sphR * s * Math.sin(sphTheta),
    TARGET.y + sphR * Math.cos(sphPhi),
    TARGET.z + sphR * s * Math.cos(sphTheta),
  );
  camera.up.copy(UP);
  camera.lookAt(TARGET);
}
function orbitDrag(dx, dy) {
  sphTheta -= dx * 0.008;
  sphPhi = Math.max(PHI_MIN, Math.min(PHI_MAX, sphPhi - dy * 0.008));
  applySpherical();
  spinVTheta = -dx * 0.008;
  spinVPhi = -dy * 0.008;
}
function stepInertia() {
  if (!spinning) return;
  sphTheta += spinVTheta;
  sphPhi = Math.max(PHI_MIN, Math.min(PHI_MAX, sphPhi + spinVPhi));
  applySpherical();
  spinVTheta *= 0.94; spinVPhi *= 0.94;
  if (Math.abs(spinVTheta) < 0.0008 && Math.abs(spinVPhi) < 0.0008) spinning = false;
}

// --- lighting ---------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6b78, 1.0)); // lighter ground term so downward faces aren't black
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(6, 10, 7); // lights the cube; shadow is a separate centred contact blob (below)
scene.add(key);

const fill = new THREE.DirectionalLight(0xbcd0ff, 0.8);
fill.position.set(-7, 3, -4);
scene.add(fill);

const under = new THREE.DirectionalLight(0xffffff, 0.55); // lifts shadowed / underside faces from any angle
under.position.set(-3, -6, -5);
scene.add(under);

// --- soft contact shadow ----------------------------------------------------
// A radial-gradient blob that sits directly under the cube centre, so it stays put
// (a real projected shadow drifted to the side under the angled key light).
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(20,24,32,0.34)');
  grad.addColorStop(0.55, 'rgba(20,24,32,0.16)');
  grad.addColorStop(1, 'rgba(20,24,32,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const contactShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, toneMapped: false }),
);
contactShadow.rotation.x = -Math.PI / 2;
scene.add(contactShadow);
// keep it under the cube, scaled to the current cube size
function updateContactShadow() {
  const s = 4.6 * cubeScale;
  contactShadow.scale.set(s, s, 1);
  contactShadow.position.y = -1.62 * cubeScale;
}
renderer.shadowMap.enabled = false; // using the contact blob instead of projected shadows

// --- cube -------------------------------------------------------------------
let cubeScale = 0.8; // driven by the size slider
let cube = new RubiksCube();
cube.group.scale.setScalar(cubeScale);
scene.add(cube.group);

// --- resize + render loop ---------------------------------------------------
function onResize() {
  camera.aspect = W() / H();
  camera.updateProjectionMatrix();
  renderer.setSize(W(), H());
}
addEventListener('resize', onResize);

// render loop is started at the very end of the file, once the solve/tween
// state flags it reads (camMoving/homing/solving) have been declared.

// --- interaction gates ------------------------------------------------------
let freeMode = false;
let solving = false; // guided solve in progress
let editing = false; // editor modal open
const freeToggle = document.getElementById('freeToggle');
function setFree(on) {
  freeMode = on;
  if (!on) spinning = false; // leaving free-look stops any flick
  freeToggle.classList.toggle('on', on);
  freeToggle.setAttribute('aria-pressed', String(on));
  renderer.domElement.style.cursor = on ? 'grab' : ''; // hand cursor signals Free mode
}
freeToggle.addEventListener('click', () => setFree(!freeMode));

// Space = momentary Free-look: hold to orbit, release to return. We ignore the OS
// key-repeat (e.repeat) so it stays steadily ON while held — the button keeps its
// green active state and the cursor stays a grab-hand (no flicker). Releasing (or
// losing focus) turns it back off, but only if Space is what enabled it.
let spaceFreeActive = false;
function spaceFreeDown() { if (freeMode) return; spaceFreeActive = true; setFree(true); }
function spaceFreeUp() { if (!spaceFreeActive) return; spaceFreeActive = false; setFree(false); }
addEventListener('keyup', e => { if (e.key === ' ') spaceFreeUp(); });
addEventListener('blur', spaceFreeUp);

// --- recenter: glide the camera back to the standard hero view --------------
let homing = false;
// Glide back to the hero view ON THE VIEW SPHERE — slerp the direction + lerp the radius.
// (A naive position lerpVectors cuts a chord through the sphere, so the cube would dip
// closer — zoom in — then back out mid-glide. This keeps the distance monotonic.)
function homeView() {
  if (homing || camMoving) return;
  homing = true;
  spinning = false;
  const d0 = camera.position.clone().normalize();
  const d1 = FRONT_VIEW.clone().normalize();
  const r0 = camera.position.length(), r1 = FRONT_VIEW.length();
  const up0 = camera.up.clone();
  const full = new THREE.Quaternion().setFromUnitVectors(d0, d1);
  const idq = new THREE.Quaternion();
  const dur = 520;
  let start = null;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = ts => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / dur);
    const k = ease(t);
    const q = new THREE.Quaternion().slerpQuaternions(idq, full, k);
    camera.position.copy(d0.clone().applyQuaternion(q).multiplyScalar(r0 + (r1 - r0) * k));
    camera.up.lerpVectors(up0, UP, k).normalize();
    camera.lookAt(TARGET);
    if (t < 1) requestAnimationFrame(step);
    else { camera.up.copy(UP); homing = false; }
  };
  requestAnimationFrame(step);
}
document.getElementById('recenter').addEventListener('click', homeView);

// --- button + keyboard wiring ----------------------------------------------
document.querySelectorAll('[data-face]').forEach(btn => {
  btn.addEventListener('click', e => cube.move(btn.dataset.face + (e.shiftKey ? "'" : '')).then(refreshStatus));
  btn.addEventListener('contextmenu', e => { e.preventDefault(); cube.move(btn.dataset.face + "'").then(refreshStatus); });
});
document.querySelectorAll('[data-move]').forEach(btn => {
  btn.addEventListener('click', () => cube.move(btn.dataset.move)); // whole-cube reorient — no status change
});
// --- scramble as a start/stop toggle (you control how scrambled it gets) -----
let scrambleTimer = null;
const scrambleBtn = document.getElementById('scramble');
const scrambleTip = document.getElementById('scrambleTip');
const SCRAMBLE_FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const SCRAMBLE_MODS = ['', "'", '2'];
let scrambleLast = '';
function stopScramble() {
  if (!scrambleTimer) return;
  clearInterval(scrambleTimer);
  scrambleTimer = null;
  scrambleBtn.classList.remove('active');
  scrambleTip.textContent = 'Scramble';
  refreshStatus();
}
function toggleScramble() {
  if (scrambleTimer) { stopScramble(); return; }
  if (solving || editing) return;
  scrambleBtn.classList.add('active');
  scrambleTip.textContent = 'Stop';
  scrambleTimer = setInterval(() => {
    if (cube.isBusy()) return;
    let f;
    do { f = SCRAMBLE_FACES[Math.floor(Math.random() * 6)]; } while (f === scrambleLast);
    scrambleLast = f;
    cube.move(f + SCRAMBLE_MODS[Math.floor(Math.random() * 3)]);
  }, 170);
}
scrambleBtn.addEventListener('click', toggleScramble);

document.getElementById('reset').addEventListener('click', () => {
  stopScramble();
  cube.dispose();
  cube = new RubiksCube();
  cube.group.scale.setScalar(cubeScale);
  scene.add(cube.group);
  refreshStatus();
});

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // typing in a field (e.g. the zoom input) owns its own keys — Enter there just
  // confirms the value; it must NOT also trigger the solve "next step".
  if (e.target instanceof HTMLInputElement) return;
  if (editing) { if (e.key === 'Escape') closeEditor(); return; }
  if (solving) {
    if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextStep(); }
    else if (e.key === 'ArrowLeft') prevStep();
    else if (e.key === 'Escape') exitSolve(false);
    return;
  }
  const k = e.key;
  if (/^[udlrfb]$/i.test(k)) cube.move(k.toUpperCase() + (e.shiftKey ? "'" : ''));
  else if (/^[xyz]$/i.test(k)) cube.move(k.toLowerCase() + (e.shiftKey ? "'" : ''));
  else if (k === 'c' || k === 'C') homeView();
  else if (k === ' ') { e.preventDefault(); if (!e.repeat) spaceFreeDown(); }
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
let orbiting = null; // free-mode camera drag

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
  if (e.button !== 0) return;
  if (freeMode) {
    spinning = false;      // grab cancels any in-flight flick
    syncSpherical();       // capture the current view into turntable coords
    orbiting = { x: e.clientX, y: e.clientY };
    renderer.domElement.style.cursor = 'grabbing'; // closed fist while dragging
    renderer.domElement.setPointerCapture(e.pointerId);
    return;
  }
  if (solving || editing || cube.isBusy()) return;
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
  if (orbiting) {
    orbitDrag(e.clientX - orbiting.x, e.clientY - orbiting.y);
    orbiting.x = e.clientX;
    orbiting.y = e.clientY;
    return;
  }
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
    // a flick at release keeps the turntable spinning, then it glides to a stop
    if (orbiting && (Math.abs(spinVTheta) > 0.002 || Math.abs(spinVPhi) > 0.002)) spinning = true;
    drag = null;
    orbiting = null;
    if (freeMode) renderer.domElement.style.cursor = 'grab'; // back to open hand
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }),
);


// ===========================================================================
// Phase 2 — guided solve + cube editor
// ===========================================================================

// DOM refs
const app = document.getElementById('app');
const inspIdle = document.getElementById('inspIdle');
const inspSolve = document.getElementById('inspSolve');
const timelineEl = document.getElementById('timeline');
const solutionSteps = document.getElementById('solutionSteps');
const progStep = document.getElementById('progStep');
const progPct = document.getElementById('progPct');
const progBar = document.getElementById('progBar');
const tlStrip = document.getElementById('tlStrip');
const tlCounter = document.getElementById('tlCounter');
const solvePrev = document.getElementById('solvePrev');
const solveAuto = document.getElementById('solveAuto');
const moveBadge = document.getElementById('moveBadge');
const badgeGlyph = document.getElementById('badgeGlyph');
const badgeLabel = document.getElementById('badgeLabel');
const stateSolver = document.getElementById('stateSolver');
const stateText = document.getElementById('stateText');
const statePill = document.getElementById('statePill');
const methodLabel = document.getElementById('methodLabel');
const editModal = document.getElementById('editModal');
const cubeNet = document.getElementById('cubeNet');
const palette = document.getElementById('palette');
const editMsg = document.getElementById('editMsg');

// Reflect the cube's state (solved / scrambled) in the top pill + meta line.
// While solving, the pill shows solve progress instead, so we skip.
function refreshStatus() {
  if (solving) return;
  const solved = cube.getState().isSolved();
  stateText.textContent = solved ? 'Solved' : 'Scrambled';
  statePill.classList.toggle('scrambled', !solved);
  statePill.classList.remove('solving');
}

// Net layout: for each face, the 9 home cubie positions in display (row-major) order.
const rows = (rowVals, colVals, mk) => {
  const a = [];
  for (const r of rowVals) for (const c of colVals) a.push(mk(r, c));
  return a;
};
const FACELET_POS = {
  U: rows([-1, 0, 1], [-1, 0, 1], (z, x) => [x, 1, z]),
  F: rows([1, 0, -1], [-1, 0, 1], (y, x) => [x, y, 1]),
  R: rows([1, 0, -1], [1, 0, -1], (y, z) => [1, y, z]),
  L: rows([1, 0, -1], [-1, 0, 1], (y, z) => [-1, y, z]),
  B: rows([1, 0, -1], [1, 0, -1], (y, x) => [x, y, -1]),
  D: rows([1, 0, -1], [-1, 0, 1], (z, x) => [x, -1, z]),
};
const NET_ORDER = ['U', 'L', 'F', 'R', 'B', 'D'];
const hex = letter => '#' + COLORS[letter].toString(16).padStart(6, '0');

// --- directional guidance: variant-C highlight + per-sticker motion arrows ---
// The turning layer stays vivid while the rest is muted (cube.setSolveHighlight),
// and a solid black arrow sits on each camera-facing side sticker pointing the way
// it travels (buildMotionArrows). Camera is locked at SOLVE_VIEW during the solve,
// so these read the same on every step. See src/solveVisuals.js.
let arrowObj = null;
let camMoving = false;

function clearArrow() {
  cube.clearSolveHighlight(); // restore the muted stickers to their true colours
  if (arrowObj) {
    cube.group.remove(arrowObj); // geometry + material are shared singletons — don't dispose
    arrowObj = null;
  }
}

function showArrow(token) {
  clearArrow();
  const info = parseMove(token);
  if (!info || info.whole) return;
  cube.setSolveHighlight(info.axisKey, info.layer);
  arrowObj = buildMotionArrows(cube, info.axisKey, info.layer, info.sign);
  cube.group.add(arrowObj); // child of the cube so it scales with it
}

function orbitCameraTo(target, dur = 620) {
  return new Promise(resolve => {
    camMoving = true;
    spinning = false;
    const d0 = camera.position.clone().normalize();
    const d1 = target.clone().normalize();
    const r0 = camera.position.length();
    const r1 = target.length();
    const up0 = camera.up.clone();
    const full = new THREE.Quaternion().setFromUnitVectors(d0, d1);
    const idq = new THREE.Quaternion();
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    let start = null;
    const step = ts => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / dur);
      const k = ease(t);
      const q = new THREE.Quaternion().slerpQuaternions(idq, full, k);
      camera.position.copy(d0.clone().applyQuaternion(q).multiplyScalar(r0 + (r1 - r0) * k));
      camera.up.lerpVectors(up0, UP, k).normalize();
      camera.lookAt(TARGET);
      if (t < 1) requestAnimationFrame(step);
      else { camera.up.copy(UP); camMoving = false; resolve(); }
    };
    requestAnimationFrame(step);
  });
}

// --- human-readable hint + notation helpers --------------------------------
const FACE_EN = {
  U: 'Up face', D: 'Down face', L: 'Left face', R: 'Right face', F: 'Front face', B: 'Back face',
  x: 'Whole cube', y: 'Whole cube', z: 'Whole cube',
};
function hintFor(token) {
  const m = /^([UDLRFBxyz])(['2]?)$/.exec(token);
  if (!m) return '';
  const [, sym, mod] = m;
  const name = FACE_EN[sym] || sym;
  if (mod === '2') return `${name} · half turn`;
  return `${name} · ${mod === "'" ? 'counter-clockwise' : 'clockwise'}`;
}
function hintLabel(token) {
  const m = /^([UDLRFBxyz])(['2]?)$/.exec(token);
  if (!m) return '';
  const [, sym, mod] = m;
  const dir = mod === '2' ? 'half turn' : (mod === "'" ? 'counter-clockwise' : 'clockwise');
  return `<b>${FACE_EN[sym] || sym}</b> · ${dir}`;
}
// notation token with the ' and 2 styled
function tokHTML(m) {
  const base = m[0], mod = m.slice(1);
  if (mod === "'") return `${base}<span class="prime">'</span>`;
  if (mod === '2') return `${base}<span class="two">2</span>`;
  return base;
}
// matched mirror pair (symmetric about the vertical axis) so the arrow column
// right-aligns into a straight line regardless of CW vs CCW.
const CW_ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
const CCW_ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
const arrowHTML = m => (m.includes("'") ? CCW_ARROW : CW_ARROW);
const FACE_VAR = { U: '--w', D: '--y', L: '--o', R: '--r', F: '--g', B: '--b' };

// --- orientation normaliser (bring white to top, green to front) -----------
function orientMoves(state) {
  const ok = s => s.colorAt([0, 1, 0], [0, 1, 0]) === 'U' && s.colorAt([0, 0, 1], [0, 0, 1]) === 'F';
  if (ok(state)) return [];
  const WH = ['x', "x'", 'y', "y'", 'z', "z'"];
  let frontier = [{ s: state, path: [] }];
  for (let d = 0; d < 4; d++) {
    const next = [];
    for (const { s, path } of frontier) {
      for (const mv of WH) {
        const s2 = s.clone().move(mv);
        if (ok(s2)) return [...path, mv];
        next.push({ s: s2, path: [...path, mv] });
      }
    }
    frontier = next;
  }
  return [];
}

// --- guided solve controller ------------------------------------------------
let session = null; // { flat: [{token, phase}], idx, auto, autoTimer }
let playbackSpeed = 1; // auto-play speed multiplier (0.5 / 1 / 2)
const invertToken = t => (t.endsWith('2') ? t : t.endsWith("'") ? t[0] : t + "'");

function setSpeed(s) {
  playbackSpeed = s;
  cube.turnDuration = Math.round(420 / s);
  document.querySelectorAll('[data-speed]').forEach(b =>
    b.classList.toggle('on', parseFloat(b.dataset.speed) === s));
}

let solveMode = 'short'; // 'short' (Kociemba ~20 moves) or 'basic' (LBL ~130)
const SOLVER_SRC = { short: './solverShort.js', basic: './solver.js' };
const solveFns = {};
async function ensureSolver(mode) {
  if (!solveFns[mode]) ({ solve: solveFns[mode] } = await import(SOLVER_SRC[mode]));
  return solveFns[mode];
}

// group a flat step list into consecutive same-phase runs
function phaseGroups(flat) {
  const groups = [];
  flat.forEach(s => {
    if (!groups.length || groups[groups.length - 1].name !== s.phase) groups.push({ name: s.phase, moves: [] });
    groups[groups.length - 1].moves.push(s);
  });
  return groups;
}

// build the inspector's phase-grouped solution list; each .step carries its flat index
function buildSolutionList(flat) {
  let html = '', i = 0;
  phaseGroups(flat).forEach((g, gi) => {
    html += `<div class="phase"><span class="idx">P${gi + 1}</span><span class="name">${g.name}</span>`
      + `<span class="line"></span><span class="ct">${g.moves.length}</span></div>`;
    g.moves.forEach(s => {
      const fc = FACE_VAR[s.token[0]] || '--muted';
      html += `<div class="step" data-i="${i}">`
        + `<span class="num">${String(i + 1).padStart(2, '0')}</span>`
        + `<span class="facechip" style="background:var(${fc})"></span>`
        + `<span class="token">${tokHTML(s.token)}</span>`
        + `<span class="desc">${hintFor(s.token)}</span>`
        + `<span class="arrow">${arrowHTML(s.token)}</span></div>`;
      i++;
    });
  });
  solutionSteps.innerHTML = html;
}

// compact, unambiguous phase labels for the timeline dividers (the inspector keeps the
// full names). Scheme B: layer + part — distinguishes bottom-vs-top cross/corners.
const PHASE_SHORT = {
  'Bottom cross': 'Btm cross', 'Bottom corners': 'Btm corners', 'Middle edges': 'Mid edges',
  'Top cross': 'Top cross', 'Top face': 'Top face', 'Corner positions': 'LL corners', 'Edge positions': 'LL edges',
};
const phaseLabel = name => PHASE_SHORT[name] || name;

// build the move strip as grouped phase columns (label + its chips). A single-phase
// solve (Shortest) renders compact with no labels; multi-phase (Beginner) shows them.
function buildTimeline(flat) {
  const groups = phaseGroups(flat);
  const solo = groups.length <= 1;
  let html = '', i = 0;
  groups.forEach(g => {
    html += '<div class="grp">';
    if (!solo) html += `<div class="glabel">${phaseLabel(g.name)}</div>`;
    html += '<div class="gchips">';
    g.moves.forEach(s => { html += `<span class="chip" data-i="${i}"><span class="box">${tokHTML(s.token)}</span></span>`; i++; });
    html += '</div></div>';
  });
  tlStrip.innerHTML = html;
  tlStrip.classList.toggle('solo', solo);
}

// paint current/done state across the list, timeline, progress bars and the move badge
function updateSolveUI() {
  const { flat, idx } = session, total = flat.length;
  solutionSteps.querySelectorAll('.step').forEach(el => {
    const i = +el.dataset.i;
    el.classList.toggle('done', i < idx);
    el.classList.toggle('cur', i === idx);
  });
  // keep the current step around the middle of the panel (never pinned to the bottom
  // edge, which made it always the last visible row) so upcoming steps stay in view
  const curEl = solutionSteps.querySelector('.step.cur');
  if (curEl) {
    const cRect = solutionSteps.getBoundingClientRect();
    const rRect = curEl.getBoundingClientRect();
    const delta = (rRect.top - cRect.top) - cRect.height * 0.5 + rRect.height * 0.5;
    solutionSteps.scrollBy({ top: delta, behavior: 'smooth' });
  }
  tlStrip.querySelectorAll('.chip').forEach(el => {
    const i = +el.dataset.i;
    el.classList.toggle('done', i < idx);
    el.classList.toggle('cur', i === idx);
    el.classList.toggle('up', i > idx);
  });
  tlStrip.querySelector('.chip.cur')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const pct = Math.round((idx / total) * 100);
  progStep.textContent = `Step ${idx + 1} / ${total}`;
  progPct.textContent = `${pct}%`;
  progBar.style.width = `${pct}%`;
  tlCounter.innerHTML = `Step <b>${idx + 1}</b> / ${total}`;
  const cur = flat[idx];
  badgeGlyph.innerHTML = tokHTML(cur.token);
  badgeLabel.innerHTML = hintLabel(cur.token);
  moveBadge.hidden = false;
}

async function startSolve(mode) {
  if (solving || editing || cube.isBusy()) return;
  if (mode) setMethod(mode); // method chosen from the Solve hover-popover (default stays Shortest)
  stopScramble();
  solving = true;
  if (freeMode) setFree(false);
  // rare: reorient so centres are canonical, so the solver's face moves line up
  for (const t of orientMoves(cube.getState())) await cube.move(t);

  const state = cube.getState();
  if (state.isSolved()) { solving = false; toast('Already solved 🎉'); return; }

  // 1) Enter the solve LAYOUT first (stage now at its final size), then glide to the
  //    locked 3/4 BEFORE planning. The first Kociemba solve builds pruning tables and
  //    briefly blocks the main thread; gliding first keeps the transition consistently
  //    smooth instead of stuttering mid-orbit.
  const enterSolveLayout = () => {
    inspIdle.hidden = true; inspSolve.hidden = false; timelineEl.hidden = false;
    app.classList.add('solving');
    statePill.classList.remove('scrambled'); statePill.classList.add('solving');
    stateText.textContent = 'Solving';
    solutionSteps.innerHTML = ''; tlStrip.innerHTML = '';
    solveAuto.classList.remove('on'); solveAuto.textContent = 'Auto ▶';
    onResize();
  };
  const revertToIdle = () => {
    solving = false;
    app.classList.remove('solving');
    inspSolve.hidden = true; inspIdle.hidden = false; timelineEl.hidden = true;
    onResize(); homeView(); refreshStatus();
  };
  enterSolveLayout();
  if (solveMode === 'short') toast('Planning the shortest solution…');
  await ensureSolveView(null); // smooth glide to the solve view at the final stage size

  // 2) Plan (may briefly block the first time — cube is already positioned, so no jump).
  let steps;
  try {
    await new Promise(r => setTimeout(r, 20));
    const solve = await ensureSolver(solveMode);
    steps = solve(state).steps;
  } catch (err) {
    console.error(err);
    revertToIdle();
    toast("This cube can't be solved — check the colors you entered.");
    return;
  }

  // split every 180° move into two clean 90° steps — the eye can't tell 90° from
  // 180° at a glance, so each guided step is a single unambiguous quarter turn.
  const flat = [];
  for (const st of steps) for (const mv of st.moves) {
    if (mv.endsWith('2')) {
      flat.push({ token: mv[0], phase: st.name }, { token: mv[0], phase: st.name });
    } else {
      flat.push({ token: mv, phase: st.name });
    }
  }
  if (!flat.length) { revertToIdle(); toast('Already solved 🎉'); return; }

  // 3) Build the lists + reveal the first step's arrows (camera already at the solve view).
  session = { flat, idx: 0, auto: false };
  cube.turnDuration = Math.round(420 / playbackSpeed); // calmer turns to follow along
  buildSolutionList(flat);
  buildTimeline(flat);
  await showStep();
}

async function showStep() {
  updateSolveUI();
  const cur = session.flat[session.idx];
  solvePrev.disabled = session.idx === 0;
  await ensureSolveView(cur.token); // locked 3/4 (or the B nudge) for THIS move
  showArrow(cur.token);
}

// glide to the solve view for `token` (locked 3/4, or the B nudge) — also used to
// snap back after free-observing
async function ensureSolveView(token) {
  if (freeMode) setFree(false);
  if (camMoving) return;
  const target = solveViewFor(token);
  if (camera.position.distanceTo(target) > 0.4 || camera.up.distanceTo(UP) > 0.04) {
    await orbitCameraTo(target);
  }
}

async function nextStep() {
  if (!session || cube.isBusy() || camMoving) return;
  const cur = session.flat[session.idx];
  await ensureSolveView(cur.token); // be at the right view before this move turns
  clearArrow();
  moveBadge.hidden = true; // hide the label while the layer turns
  await cube.move(cur.token);
  session.idx++;
  if (session.idx >= session.flat.length) {
    progStep.textContent = `Step ${session.flat.length} / ${session.flat.length}`;
    progPct.textContent = '100%';
    progBar.style.width = '100%';
    exitSolve(true);
    return;
  }
  await showStep();
  if (session.auto) session.autoTimer = setTimeout(nextStep, Math.round(700 / playbackSpeed));
}

async function prevStep() {
  if (!session || cube.isBusy() || camMoving || session.idx === 0) return;
  await ensureSolveView(session.flat[session.idx].token); // right view before reversing
  session.idx--;
  clearArrow();
  moveBadge.hidden = true;
  await cube.move(invertToken(session.flat[session.idx].token));
  await showStep();
}

function toggleAuto() {
  if (!session) return;
  session.auto = !session.auto;
  solveAuto.classList.toggle('on', session.auto);
  solveAuto.textContent = session.auto ? 'Pause ⏸' : 'Auto ▶';
  if (session.auto && !cube.isBusy()) nextStep();
}

function exitSolve(finished) {
  if (session?.autoTimer) clearTimeout(session.autoTimer);
  clearArrow();
  session = null;
  solving = false;
  cube.turnDuration = 240; // snappy again for manual play
  app.classList.remove('solving');
  inspSolve.hidden = true;
  inspIdle.hidden = false;
  timelineEl.hidden = true;
  moveBadge.hidden = true;
  solveAuto.classList.remove('on');
  solveAuto.textContent = 'Auto ▶';
  onResize(); // the stage cell grew back
  homeView(); // back to the standard front view
  refreshStatus();
  if (finished) toast('Solved — nice work 🎉');
}

// --- cube editor ------------------------------------------------------------
let selColor = 'U';
let netData = null;
let netBuilt = false;

function buildEditor() {
  for (const f of ['U', 'D', 'F', 'B', 'R', 'L']) {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (f === selColor ? ' sel' : '');
    sw.style.background = hex(f);
    sw.title = f;
    sw.addEventListener('click', () => {
      selColor = f;
      [...palette.children].forEach(c => c.classList.remove('sel'));
      sw.classList.add('sel');
    });
    palette.appendChild(sw);
  }
  for (const face of NET_ORDER) {
    const fe = document.createElement('div');
    fe.className = 'net-face ' + face.toLowerCase();
    for (let idx = 0; idx < 9; idx++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (idx === 4 ? ' center' : '');
      cell.dataset.face = face;
      cell.dataset.idx = idx;
      if (idx !== 4) cell.addEventListener('click', () => setCell(face, idx, selColor));
      fe.appendChild(cell);
    }
    cubeNet.appendChild(fe);
  }
  netBuilt = true;
}

function setCell(face, idx, letter) {
  netData[face][idx] = letter;
  cubeNet.querySelector(`.cell[data-face="${face}"][data-idx="${idx}"]`).style.background = hex(letter);
}
function renderNet() {
  for (const face of NET_ORDER)
    for (let idx = 0; idx < 9; idx++)
      cubeNet.querySelector(`.cell[data-face="${face}"][data-idx="${idx}"]`).style.background = hex(netData[face][idx]);
}
function loadCurrentIntoNet() {
  for (const face of NET_ORDER)
    for (let idx = 0; idx < 9; idx++)
      netData[face][idx] = cube.colorShownAt(face, FACELET_POS[face][idx]) || face;
}

function openEditor() {
  if (solving) return;
  stopScramble();
  if (!netBuilt) buildEditor();
  netData = {};
  for (const f of NET_ORDER) netData[f] = Array(9).fill(f);
  loadCurrentIntoNet();
  renderNet();
  editMsg.textContent = '';
  editMsg.className = 'edit-msg';
  editing = true;
  editModal.hidden = false;
}
function closeEditor() { editing = false; editModal.hidden = true; }

async function applyEditor() {
  // Validate a throwaway state built from the entered colours WITHOUT touching the live
  // cube, so an invalid entry never replaces what's on screen.
  const test = new CubeState();
  for (const face of NET_ORDER)
    for (let idx = 0; idx < 9; idx++) {
      const pos = FACELET_POS[face][idx], n = FACE_NORMAL[face];
      const f = test.facelets.find(f =>
        f.p[0] === pos[0] && f.p[1] === pos[1] && f.p[2] === pos[2] &&
        f.n[0] === n[0] && f.n[1] === n[1] && f.n[2] === n[2]);
      if (f) f.c = netData[face][idx];
    }
  const showErr = msg => { editMsg.className = 'edit-msg err'; editMsg.textContent = msg; };
  // counts, valid pieces, all pieces present, corner-twist total, permutation parity
  const problem = cubeError(test);
  if (problem) { showErr(`Not a solvable cube — ${problem}.`); return; }
  // final gate: a lone flipped edge passes every structural check but is still impossible;
  // attempting the (local, always-terminating) layer solver reliably catches it.
  try {
    const lbl = await ensureSolver('basic');
    lbl(test.clone());
  } catch {
    showErr('Not a solvable cube — an edge looks flipped.');
    return;
  }

  // valid — load it onto the on-screen cube
  cube.dispose();
  cube = new RubiksCube();
  cube.group.scale.setScalar(cubeScale);
  scene.add(cube.group);
  updateContactShadow();
  for (const face of NET_ORDER)
    for (let idx = 0; idx < 9; idx++)
      cube.paint(face, FACELET_POS[face][idx], netData[face][idx]);
  closeEditor();
  homeView();
  refreshStatus();
  toast('Cube loaded — hit Solve to start →');
}

// --- toast ------------------------------------------------------------------
let toastEl = null;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// --- wiring -----------------------------------------------------------------
// Solve: clicking the button uses the current method (defaults to Shortest); the
// hover-popover options solve directly with that method.
document.getElementById('solve').addEventListener('click', () => startSolve());
document.getElementById('edit').addEventListener('click', openEditor);
document.getElementById('solveExit').addEventListener('click', () => exitSolve(false));
document.getElementById('solveView').addEventListener('click', async () => {
  if (!session || camMoving) return;
  const cur = session.flat[session.idx];
  await ensureSolveView(cur.token);
  showArrow(cur.token);
});
document.getElementById('solveNext').addEventListener('click', nextStep);
solvePrev.addEventListener('click', prevStep);
solveAuto.addEventListener('click', toggleAuto);
document.getElementById('editApply').addEventListener('click', applyEditor);
document.getElementById('editCancel').addEventListener('click', closeEditor);
document.getElementById('editLoad').addEventListener('click', () => { loadCurrentIntoNet(); renderNet(); });
document.getElementById('editReset').addEventListener('click', () => {
  for (const f of NET_ORDER) netData[f] = Array(9).fill(f);
  renderNet();
});

// playback speed (auto mode)
document.querySelectorAll('[data-speed]').forEach(btn =>
  btn.addEventListener('click', () => setSpeed(parseFloat(btn.dataset.speed))));

// Holding Shift previews the counter-clockwise (primed) notation on the Turn-a-layer
// buttons — matching Shift-click (U → U'). Standard cube notation. Sync from the actual
// modifier state on every key/pointer event (+ clear on blur) so a missed keyup — e.g.
// releasing Shift after alt-tabbing away — can't leave the prime stuck on.
const syncShift = e => app.classList.toggle('shifting', !!e.shiftKey);
addEventListener('keydown', syncShift);
addEventListener('keyup', syncShift);
addEventListener('pointerdown', syncShift);
addEventListener('blur', () => app.classList.remove('shifting'));

// solve method — chosen from the Solve hover-popover. Shortest (Kociemba) is default.
const METHOD_NAME = { short: 'Shortest', basic: 'Beginner' };
const ENGINE_LABEL = { short: 'Kociemba two-phase', basic: 'Layer-by-layer' };
function setMethod(mode) {
  solveMode = mode;
  // solver readout shown next to the top-bar "Solving" pill (only visible mid-solve)
  if (stateSolver) stateSolver.innerHTML = `<b>${METHOD_NAME[mode]}</b><span class="d">·</span>${ENGINE_LABEL[mode]}`;
  if (methodLabel) methodLabel.textContent = METHOD_NAME[mode];
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('sel', b.dataset.mode === mode));
}
// each popover option solves directly with its method
document.querySelectorAll('[data-mode]').forEach(btn =>
  btn.addEventListener('click', () => startSolve(btn.dataset.mode)));

// cube size — zoom control on the stage (100% = default size)
// zoom = cube size, shown as a percent (100% = default). Range 50–150%.
const zoomInput = document.getElementById('zoomVal');
const ZOOM_MIN = 50, ZOOM_MAX = 150, ZOOM_BASE = 0.8;
let zoomPct = 100;
function setZoom(pct, fromInput) {
  zoomPct = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(pct)));
  cubeScale = ZOOM_BASE * (zoomPct / 100);
  cube.group.scale.setScalar(cubeScale);
  updateContactShadow();
  if (!fromInput) zoomInput.value = `${zoomPct}%`;
}
document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoomPct + 10));
document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoomPct - 10));
zoomInput.addEventListener('focus', () => zoomInput.select());
zoomInput.addEventListener('change', () => {
  const n = parseInt(zoomInput.value, 10);
  if (Number.isFinite(n)) setZoom(n); else zoomInput.value = `${zoomPct}%`;
});
zoomInput.addEventListener('keydown', e => { if (e.key === 'Enter') zoomInput.blur(); });
// wheel / trackpad pinch zooms the cube and keeps the number in sync
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  setZoom(zoomPct - e.deltaY * 0.12);
}, { passive: false });

// --- boot -------------------------------------------------------------------
onResize();                        // size the canvas to the stage cell now the grid is laid out
setZoom(100);
setMethod('short');                // default method + popover highlight
refreshStatus();
requestAnimationFrame(onResize);   // catch late layout (web-font swap, etc.)

// --- render loop ------------------------------------------------------------
(function loop() {
  requestAnimationFrame(loop);
  stepInertia(); // free-look flick glides to a stop
  renderer.render(scene, camera);
})();
