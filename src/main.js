import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RubiksCube, UNIT, parseMove, COLORS } from './cube.js';
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

// --- camera control: seamless arcball rotate (free mode) + wheel dolly --------
// Standard "hero" orientation: front(green) toward you, white on top, red on the
// right — the conventional way a cube is depicted (F + U + R all visible).
const TARGET = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
// FRONT_VIEW: dead-on the front (green) face — the "正对" / recenter / default view.
// SOLVE_VIEW: a fixed 3/4 (green front, white top, red right) that stays LOCKED for
// the whole guided solve, so every arrow (even a Back turn) reads without moving.
const FRONT_VIEW = new THREE.Vector3(0, 0, 8);
const SOLVE_VIEW = new THREE.Vector3(4.6, 3.7, 6.4);
const SOLVE_LIFT = 1.35; // raise the cube during solve so bottom arrows clear the panel
const MIN_DIST = 5;
const MAX_DIST = 18;
camera.position.copy(FRONT_VIEW);
camera.lookAt(TARGET);

function dolly(factor) {
  const off = camera.position.clone().sub(TARGET);
  off.setLength(Math.max(MIN_DIST, Math.min(MAX_DIST, off.length() * factor)));
  camera.position.copy(TARGET).add(off);
  camera.lookAt(TARGET);
}
function orbitDrag(dx, dy) {
  const off = camera.position.clone().sub(TARGET);
  off.applyAxisAngle(UP, -dx * 0.008);                    // yaw around world up
  const right = new THREE.Vector3().crossVectors(camera.up, off).normalize();
  off.applyAxisAngle(right, -dy * 0.008);                 // pitch around camera-right (seamless over the poles)
  camera.up.applyAxisAngle(right, -dy * 0.008);
  camera.position.copy(TARGET).add(off);
  camera.lookAt(TARGET);
}

// --- lighting ---------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6b78, 1.0)); // lighter ground term so downward faces aren't black
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const key = new THREE.DirectionalLight(0xffffff, 2.0);
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

const fill = new THREE.DirectionalLight(0xbcd0ff, 0.8);
fill.position.set(-7, 3, -4);
scene.add(fill);

const under = new THREE.DirectionalLight(0xffffff, 0.55); // lifts shadowed / underside faces from any angle
under.position.set(-3, -6, -5);
scene.add(under);

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
let cubeScale = 0.8; // driven by the size slider
let cube = new RubiksCube();
cube.group.scale.setScalar(cubeScale);
scene.add(cube.group);

// --- resize + render loop ---------------------------------------------------
addEventListener('resize', () => {
  camera.aspect = W() / H();
  camera.updateProjectionMatrix();
  renderer.setSize(W(), H());
});

// render loop is started at the very end of the file, once the solve/tween
// state flags it reads (camMoving/homing/solving) have been declared.

// --- interaction gates ------------------------------------------------------
let freeMode = false;
let solving = false; // guided solve in progress
let editing = false; // editor modal open
const freeToggle = document.getElementById('freeToggle');
function setFree(on) {
  freeMode = on;
  freeToggle.classList.toggle('on', on);
  freeToggle.setAttribute('aria-pressed', String(on));
}
freeToggle.addEventListener('click', () => setFree(!freeMode));

// --- recenter: glide the camera back to the standard hero view --------------
let homing = false;
function homeView() {
  if (homing) return;
  homing = true;
  const p0 = camera.position.clone();
  const up0 = camera.up.clone();
  const dur = 520;
  let start = null;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = ts => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / dur);
    const k = ease(t);
    camera.position.lerpVectors(p0, FRONT_VIEW, k);
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
  btn.addEventListener('click', e => cube.move(btn.dataset.face + (e.shiftKey ? "'" : '')));
  btn.addEventListener('contextmenu', e => { e.preventDefault(); cube.move(btn.dataset.face + "'"); });
});
document.querySelectorAll('[data-move]').forEach(btn => {
  btn.addEventListener('click', () => cube.move(btn.dataset.move));
});
// --- scramble as a start/stop toggle (you control how scrambled it gets) -----
let scrambleTimer = null;
const scrambleBtn = document.getElementById('scramble');
const SCRAMBLE_FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const SCRAMBLE_MODS = ['', "'", '2'];
let scrambleLast = '';
function stopScramble() {
  if (!scrambleTimer) return;
  clearInterval(scrambleTimer);
  scrambleTimer = null;
  scrambleBtn.textContent = '打乱 Scramble';
  scrambleBtn.classList.remove('on');
}
function toggleScramble() {
  if (scrambleTimer) { stopScramble(); return; }
  if (solving || editing) return;
  scrambleBtn.textContent = '停止 Stop';
  scrambleBtn.classList.add('on');
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
});

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
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
  if (freeMode) { orbiting = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); return; }
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
    drag = null;
    orbiting = null;
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }),
);

// wheel to zoom (works in every mode)
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  dolly(e.deltaY > 0 ? 1.08 : 0.926);
}, { passive: false });

// ===========================================================================
// Phase 2 — guided solve + cube editor
// ===========================================================================

// DOM refs
const dock = document.querySelector('.dock');
const solvePanel = document.getElementById('solvePanel');
const solvePhase = document.getElementById('solvePhase');
const solveMove = document.getElementById('solveMove');
const solveHint = document.getElementById('solveHint');
const solveCounter = document.getElementById('solveCounter');
const solveBar = document.getElementById('solveBar');
const solvePrev = document.getElementById('solvePrev');
const solveAuto = document.getElementById('solveAuto');
const editModal = document.getElementById('editModal');
const cubeNet = document.getElementById('cubeNet');
const palette = document.getElementById('palette');
const editMsg = document.getElementById('editMsg');

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

// --- directional arrow ------------------------------------------------------
const ARROW_MAT = new THREE.MeshStandardMaterial({
  color: 0xfff1c2, emissive: 0xff9d10, emissiveIntensity: 0.9,
  roughness: 0.28, metalness: 0.0, toneMapped: false, // glow, and...
  depthTest: false, depthWrite: false,                // ...always draw on top, so even a Back arrow shows
});
let arrowObj = null;
let camMoving = false;

function clearArrow() {
  if (arrowObj) {
    cube.group.remove(arrowObj);
    arrowObj.traverse(o => o.geometry?.dispose?.());
    arrowObj = null;
  }
  cube.clearHighlight();
}

// gentle breathing glow on the arrow and the highlighted layer (no crude redraw)
function animateArrow() {
  if (!arrowObj) return;
  const now = performance.now();
  const b = 0.5 + 0.5 * Math.sin(now / 380);
  ARROW_MAT.emissiveIntensity = 0.6 + 0.35 * b;
  arrowObj.scale.setScalar(1 + 0.03 * b);
  cube.pulseHighlight(0.12 + 0.4 * b); // gentle own-colour breathing (0.12–0.52)
  requestAnimationFrame(animateArrow);
}

function showArrow(token) {
  clearArrow();
  const info = parseMove(token);
  if (!info) return;
  cube.setHighlight(info.axisKey, info.whole ? null : info.layer);
  arrowObj = buildArc(info.axisKey, info.whole ? 0 : info.layer, info.sign, info.quarters);
  cube.group.add(arrowObj); // child of the cube so it scales with the size slider
  animateArrow();
}

function buildArc(axisKey, layer, sign, quarters) {
  const g = new THREE.Group();
  const a = new THREE.Vector3(axisKey === 'x' ? 1 : 0, axisKey === 'y' ? 1 : 0, axisKey === 'z' ? 1 : 0);
  const helper = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(helper, a).normalize();
  const v = new THREE.Vector3().crossVectors(a, u).normalize();
  const R = 2.6;
  const offset = layer * 1.5;
  const span = quarters >= 2 ? 2.4 : 1.55; // radians of arc shown
  const dir = sign >= 0 ? 1 : -1;
  const th0 = -dir * span / 2;
  const th1 = dir * span / 2;
  const P = th => new THREE.Vector3()
    .addScaledVector(u, R * Math.cos(th))
    .addScaledVector(v, R * Math.sin(th))
    .addScaledVector(a, offset);
  const pts = [];
  for (let i = 0; i <= 48; i++) pts.push(P(th0 + (th1 - th0) * (i / 48)));
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 72, 0.075, 14, false), ARROW_MAT,
  );
  tube.renderOrder = 999;
  g.add(tube);
  const tip = P(th1);
  const tangent = new THREE.Vector3()
    .addScaledVector(u, -Math.sin(th1))
    .addScaledVector(v, Math.cos(th1))
    .multiplyScalar(dir).normalize();
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.56, 24), ARROW_MAT);
  head.position.copy(tip);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  head.renderOrder = 999;
  g.add(head);
  return g;
}

function orbitCameraTo(target, dur = 620) {
  return new Promise(resolve => {
    camMoving = true;
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

// raise/lower the whole cube (used during solve so bottom arrows clear the panel)
function liftCube(to, dur = 520) {
  const from = cube.group.position.y;
  const ease = t => 1 - Math.pow(1 - t, 3);
  let start = null;
  const step = ts => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / dur);
    cube.group.position.y = from + (to - from) * ease(t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// --- human-readable hint for a move ----------------------------------------
const FACE_CN = {
  U: '顶层 (上面)', D: '底层 (下面)', L: '左面', R: '右面', F: '前面', B: '后面 (背面)',
  x: '整个魔方 (绕左右轴)', y: '整个魔方 (绕上下轴)', z: '整个魔方 (绕前后轴)',
};
function hintFor(token) {
  const m = /^([UDLRFBxyz])(['2]?)$/.exec(token);
  if (!m) return '';
  const [, sym, mod] = m;
  const name = FACE_CN[sym] || sym;
  if (mod === '2') return `${name}　转 180°`;
  return `${name}　${mod === "'" ? '逆时针' : '顺时针'} 90°`;
}

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

async function startSolve() {
  if (solving || editing || cube.isBusy()) return;
  stopScramble();
  solving = true;
  if (freeMode) setFree(false);
  // rare: reorient so centres are canonical, so the solver's face moves line up
  for (const t of orientMoves(cube.getState())) await cube.move(t);

  const state = cube.getState();
  if (state.isSolved()) { solving = false; toast('已经是还原状态啦 🎉'); return; }

  let steps;
  try {
    if (solveMode === 'short') toast('计算最短路径中…（首次约 1–2 秒）');
    await new Promise(r => setTimeout(r, 30)); // let the toast paint before init blocks
    const solve = await ensureSolver(solveMode);
    steps = solve(state).steps;
  } catch (err) {
    solving = false;
    console.error(err);
    toast('这个状态无法求解，检查一下颜色输入 😅');
    return;
  }

  const flat = [];
  for (const st of steps) for (const mv of st.moves) flat.push({ token: mv, phase: st.name });
  if (!flat.length) { solving = false; toast('已经是还原状态啦 🎉'); return; }

  session = { flat, idx: 0, auto: false };
  cube.turnDuration = Math.round(420 / playbackSpeed); // calmer turns to follow along
  dock.hidden = true;
  solvePanel.hidden = false;
  solveAuto.classList.remove('on');
  solveAuto.textContent = '自动 ▶';
  liftCube(SOLVE_LIFT); // raise the cube so bottom-face arrows clear the panel
  await orbitCameraTo(SOLVE_VIEW); // lock to the fixed 3/4 for the whole solve
  await showStep();
}

async function showStep() {
  const { flat, idx } = session;
  const cur = flat[idx];
  solvePhase.textContent = cur.phase;
  solveMove.textContent = cur.token;
  solveHint.textContent = hintFor(cur.token);
  solveCounter.textContent = `第 ${idx + 1} / ${flat.length} 步`;
  solveBar.style.width = `${(idx / flat.length) * 100}%`;
  solvePrev.disabled = idx === 0;
  showArrow(cur.token); // camera stays locked at SOLVE_VIEW for the whole solve
}

async function nextStep() {
  if (!session || cube.isBusy() || camMoving) return;
  const cur = session.flat[session.idx];
  clearArrow();
  await cube.move(cur.token);
  session.idx++;
  if (session.idx >= session.flat.length) { solveBar.style.width = '100%'; exitSolve(true); return; }
  await showStep();
  if (session.auto) session.autoTimer = setTimeout(nextStep, Math.round(700 / playbackSpeed));
}

async function prevStep() {
  if (!session || cube.isBusy() || camMoving || session.idx === 0) return;
  session.idx--;
  clearArrow();
  await cube.move(invertToken(session.flat[session.idx].token));
  await showStep();
}

function toggleAuto() {
  if (!session) return;
  session.auto = !session.auto;
  solveAuto.classList.toggle('on', session.auto);
  solveAuto.textContent = session.auto ? '暂停 ⏸' : '自动 ▶';
  if (session.auto && !cube.isBusy()) nextStep();
}

function exitSolve(finished) {
  if (session?.autoTimer) clearTimeout(session.autoTimer);
  clearArrow();
  session = null;
  solving = false;
  cube.turnDuration = 240; // snappy again for manual play
  solvePanel.hidden = true;
  dock.hidden = false;
  liftCube(0); // lower the cube back to centre
  homeView(); // back to the standard front view
  if (finished) toast('还原完成，恭喜 🎉');
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
  const count = { U: 0, D: 0, F: 0, B: 0, R: 0, L: 0 };
  for (const f of NET_ORDER) for (const c of netData[f]) count[c]++;
  const bad = Object.entries(count).filter(([, n]) => n !== 9);
  if (bad.length) {
    editMsg.className = 'edit-msg err';
    editMsg.textContent = '每种颜色必须正好 9 个：' + bad.map(([c, n]) => `${c}=${n}`).join('  ');
    return;
  }
  // rebuild the cube at home positions, painted with the entered colours
  cube.dispose();
  cube = new RubiksCube();
  cube.group.scale.setScalar(cubeScale);
  scene.add(cube.group);
  for (const face of NET_ORDER)
    for (let idx = 0; idx < 9; idx++)
      cube.paint(face, FACELET_POS[face][idx], netData[face][idx]);

  try {
    const solve = await ensureSolver(solveMode);
    solve(cube.getState()); // solvability check
  } catch (err) {
    editMsg.className = 'edit-msg err';
    editMsg.textContent = '这个配色拼不出可解的魔方，检查一下是不是记错/贴错了某一块。';
    console.error(err);
    return;
  }
  closeEditor();
  homeView();
  toast('已载入你的魔方，点「求解」开始跟练 →');
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
document.getElementById('solve').addEventListener('click', startSolve);
document.getElementById('edit').addEventListener('click', openEditor);
document.getElementById('solveExit').addEventListener('click', () => exitSolve(false));
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

// solve method: 最短 (short) / 基础 (basic)
document.querySelectorAll('[data-mode]').forEach(btn =>
  btn.addEventListener('click', () => {
    solveMode = btn.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b === btn));
  }));

// cube size slider (left rail)
const sizeSlider = document.getElementById('sizeSlider');
if (sizeSlider) {
  sizeSlider.value = String(cubeScale);
  sizeSlider.addEventListener('input', () => {
    cubeScale = parseFloat(sizeSlider.value);
    cube.group.scale.setScalar(cubeScale);
  });
}

// --- render loop ------------------------------------------------------------
(function loop() {
  requestAnimationFrame(loop);
  renderer.render(scene, camera);
})();
