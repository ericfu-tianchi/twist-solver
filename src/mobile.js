// Twist Solver — MOBILE controller.
// Purpose-built, touch-first shell over the SAME engine as desktop: RubiksCube
// (3D + turn queue + solve highlight), both solvers, and buildMotionArrows. Only the
// UI shell differs. One flow: Scramble → pick method → Solve → follow arrows, tap Next.
// Dropped vs desktop (by design, for a clean mobile v1): the colour editor, drag-to-turn,
// zoom, the detailed side inspector/timeline. Kept: the whole guided-solve experience.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RubiksCube, parseMove, COLORS, FACE_NORMAL } from './cube.js';
import { CubeState, cubeError } from './state.js';
import { buildMotionArrows } from './solveVisuals.js';

const $ = id => document.getElementById(id);
const wrap = $('scene');
const W = () => wrap.clientWidth;
const H = () => wrap.clientHeight;

// --- renderer / scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W(), H());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.1, 100);
const TARGET = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FRONT_VIEW = new THREE.Vector3(0, 0, 11.5);
const SOLVE_VIEW = new THREE.Vector3(6.0, 4.8, 8.4);
const SOLVE_VIEW_B = new THREE.Vector3(7.1, 6.8, 7.1);
const solveViewFor = t => (t && t[0] === 'B' ? SOLVE_VIEW_B : SOLVE_VIEW);
camera.position.copy(FRONT_VIEW);
camera.lookAt(TARGET);

// --- lights (same rig as desktop) -------------------------------------------
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6b78, 1.0));
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const keyL = new THREE.DirectionalLight(0xffffff, 2.0); keyL.position.set(6, 10, 7); scene.add(keyL);
const fillL = new THREE.DirectionalLight(0xbcd0ff, 0.8); fillL.position.set(-7, 3, -4); scene.add(fillL);
const underL = new THREE.DirectionalLight(0xffffff, 0.55); underL.position.set(-3, -6, -5); scene.add(underL);

// --- soft contact shadow ----------------------------------------------------
function shadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(20,24,32,0.34)');
  grad.addColorStop(0.55, 'rgba(20,24,32,0.16)');
  grad.addColorStop(1, 'rgba(20,24,32,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const contactShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, toneMapped: false }),
);
contactShadow.rotation.x = -Math.PI / 2; scene.add(contactShadow);

// --- cube + zoom (pinch to scale, clamped 50–150%; no on-screen zoom bar) ----
const ZOOM_BASE = 0.66; // 100% = fits a portrait screen with breathing room
let zoomPct = 100;
let cubeScale = ZOOM_BASE;
let cube = new RubiksCube();
cube.group.scale.setScalar(cubeScale);
scene.add(cube.group);
function updateContactShadow() {
  contactShadow.scale.set(4.6 * cubeScale, 4.6 * cubeScale, 1);
  contactShadow.position.y = -1.62 * cubeScale;
}
function setZoom(pct) {
  zoomPct = Math.max(50, Math.min(150, pct));
  cubeScale = ZOOM_BASE * (zoomPct / 100);
  cube.group.scale.setScalar(cubeScale);
  updateContactShadow();
}
function glideZoom(targetPct, dur = 420) {
  const from = zoomPct, to = Math.max(50, Math.min(150, targetPct));
  if (Math.abs(from - to) < 0.5) return;
  let start = null; const ease = t => 1 - Math.pow(1 - t, 3);
  const step = ts => { if (start === null) start = ts; const t = Math.min(1, (ts - start) / dur); setZoom(from + (to - from) * ease(t)); if (t < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
updateContactShadow();

function onResize() {
  camera.aspect = W() / H();
  camera.updateProjectionMatrix();
  renderer.setSize(W(), H());
}
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 200));

// --- camera: touch-drag orbit + pinch-zoom + glides -------------------------
let homing = false, camMoving = false;
// Free-look = TURNTABLE + INERTIA (chosen in drag-lab): yaw world-Y, pitch world-X
// (clamped, no roll), plus a flick that glides to a stop. 1 finger orbits, 2 pinch-zoom.
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
  camera.position.set(TARGET.x + sphR * s * Math.sin(sphTheta), TARGET.y + sphR * Math.cos(sphPhi), TARGET.z + sphR * s * Math.cos(sphTheta));
  camera.up.copy(UP); camera.lookAt(TARGET);
}
function orbitDrag(dx, dy) {
  sphTheta -= dx * 0.008;
  sphPhi = Math.max(PHI_MIN, Math.min(PHI_MAX, sphPhi - dy * 0.008));
  applySpherical();
  spinVTheta = -dx * 0.008; spinVPhi = -dy * 0.008;
}
function stepInertia() {
  if (!spinning) return;
  sphTheta += spinVTheta;
  sphPhi = Math.max(PHI_MIN, Math.min(PHI_MAX, sphPhi + spinVPhi));
  applySpherical();
  spinVTheta *= 0.94; spinVPhi *= 0.94;
  if (Math.abs(spinVTheta) < 0.0008 && Math.abs(spinVPhi) < 0.0008) spinning = false;
}
const activePointers = new Map();
let orbiting = null, pinch = null;
const twoDist = () => { const [a, b] = [...activePointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
renderer.domElement.addEventListener('pointerdown', e => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* noop */ }
  spinning = false; // any touch cancels a flick
  if (activePointers.size === 2) { orbiting = null; pinch = { d0: twoDist(), pct0: zoomPct }; }
  else if (activePointers.size === 1 && !camMoving && !homing) { syncSpherical(); orbiting = { x: e.clientX, y: e.clientY }; }
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && activePointers.size >= 2) { if (pinch.d0 > 0) setZoom(pinch.pct0 * (twoDist() / pinch.d0)); return; }
  if (orbiting && activePointers.size === 1) {
    orbitDrag(e.clientX - orbiting.x, e.clientY - orbiting.y);
    orbiting.x = e.clientX; orbiting.y = e.clientY;
  }
});
const endPtr = e => {
  const wasOrbiting = orbiting && activePointers.size === 1;
  activePointers.delete(e.pointerId);
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  if (activePointers.size < 2) pinch = null;
  if (activePointers.size === 1 && !camMoving && !homing) { syncSpherical(); const [p] = [...activePointers.values()]; orbiting = { x: p.x, y: p.y }; }
  else if (activePointers.size === 0) {
    if (wasOrbiting && (Math.abs(spinVTheta) > 0.002 || Math.abs(spinVPhi) > 0.002)) spinning = true; // flick → glide
    orbiting = null;
  }
};
['pointerup', 'pointercancel'].forEach(ev => renderer.domElement.addEventListener(ev, endPtr));

// Glide home ON THE VIEW SPHERE (slerp direction + lerp radius) so the cube never dips
// closer — zoom in — then back out mid-glide (a naive lerpVectors chords the sphere).
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
  const dur = 480;
  let start = null; const ease = t => 1 - Math.pow(1 - t, 3);
  const step = ts => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / dur), k = ease(t);
    const q = new THREE.Quaternion().slerpQuaternions(idq, full, k);
    camera.position.copy(d0.clone().applyQuaternion(q).multiplyScalar(r0 + (r1 - r0) * k));
    camera.up.lerpVectors(up0, UP, k).normalize();
    camera.lookAt(TARGET);
    if (t < 1) requestAnimationFrame(step); else { camera.up.copy(UP); homing = false; }
  };
  requestAnimationFrame(step);
}
function orbitCameraTo(target, dur = 600) {
  return new Promise(resolve => {
    spinning = false;
    camMoving = true;
    const d0 = camera.position.clone().normalize(), d1 = target.clone().normalize();
    const r0 = camera.position.length(), r1 = target.length(), up0 = camera.up.clone();
    const full = new THREE.Quaternion().setFromUnitVectors(d0, d1), idq = new THREE.Quaternion();
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    let start = null;
    const step = ts => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / dur), k = ease(t);
      const q = new THREE.Quaternion().slerpQuaternions(idq, full, k);
      camera.position.copy(d0.clone().applyQuaternion(q).multiplyScalar(r0 + (r1 - r0) * k));
      camera.up.lerpVectors(up0, UP, k).normalize();
      camera.lookAt(TARGET);
      if (t < 1) requestAnimationFrame(step); else { camera.up.copy(UP); camMoving = false; resolve(); }
    };
    requestAnimationFrame(step);
  });
}
async function ensureSolveView(token) {
  if (camMoving) return;
  const target = solveViewFor(token);
  if (camera.position.distanceTo(target) > 0.4 || camera.up.distanceTo(UP) > 0.04) await orbitCameraTo(target);
}

// --- solve highlight + arrows (reused visuals) ------------------------------
let arrowObj = null;
function clearArrow() {
  cube.clearSolveHighlight();
  if (arrowObj) { cube.group.remove(arrowObj); arrowObj = null; }
}
function showArrow(token) {
  clearArrow();
  const info = parseMove(token);
  if (!info || info.whole) return;
  cube.setSolveHighlight(info.axisKey, info.layer);
  arrowObj = buildMotionArrows(cube, info.axisKey, info.layer, info.sign);
  cube.group.add(arrowObj);
}

// --- notation / hint helpers (shared with desktop) --------------------------
const FACE_EN = { U: 'Up face', D: 'Down face', L: 'Left face', R: 'Right face', F: 'Front face', B: 'Back face' };
function hintLabel(token) {
  const m = /^([UDLRFB])(['2]?)$/.exec(token);
  if (!m) return '';
  const [, sym, mod] = m;
  const dir = mod === '2' ? 'half turn' : (mod === "'" ? 'counter-clockwise' : 'clockwise');
  return `<b>${FACE_EN[sym] || sym}</b> · ${dir}`;
}
function tokHTML(m) {
  const base = m[0], mod = m.slice(1);
  if (mod === "'") return `${base}<span class="prime">'</span>`;
  if (mod === '2') return `${base}<span class="two">2</span>`;
  return base;
}
const invert = t => (t.endsWith('2') ? t : t.endsWith("'") ? t[0] : t + "'");

// --- DOM refs ---------------------------------------------------------------
const statePill = $('statePill'), stateText = $('stateText');
const dockIdle = $('dockIdle'), dockSolve = $('dockSolve');
const strip = $('strip'), badge = $('moveBadge'), badgeGlyph = $('badgeGlyph'), badgeLabel = $('badgeLabel');
const stepCounter = $('stepCounter'), stateSolver = $('stateSolver'), progBar = $('progBar');
const mautoIcon = $('mautoIcon'), mautoText = $('mautoText');
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>';
function setAutoBtn(playing) {
  mauto.classList.toggle('on', playing);
  mautoIcon.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  mautoText.textContent = playing ? 'Pause' : 'Auto';
}
const prevBtn = $('prev'), scrambleBtn = $('scramble'), mauto = $('mauto');

// compact phase labels for the strip dividers (same scheme B as desktop)
const PHASE_SHORT = {
  'Bottom cross': 'Btm cross', 'Bottom corners': 'Btm corners', 'Middle edges': 'Mid edges',
  'Top cross': 'Top cross', 'Top face': 'Top face', 'Corner positions': 'LL corners', 'Edge positions': 'LL edges',
};
const phaseLabel = name => PHASE_SHORT[name] || name;

// --- status -----------------------------------------------------------------
let solving = false, busy = false, editing = false;
function refreshStatus() {
  if (solving) return;
  const solved = cube.getState().isSolved();
  stateText.textContent = solved ? 'Solved' : 'Scrambled';
  statePill.classList.toggle('scrambled', !solved);
  statePill.classList.remove('solving');
}

// --- toast ------------------------------------------------------------------
let toastEl = null;
function toast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// --- scramble (one tap = a quick, fully-random shuffle) ----------------------
const SFACES = ['U', 'D', 'L', 'R', 'F', 'B'], SMODS = ['', "'", '2'];
async function doScramble() {
  if (solving || busy || editing || cube.isBusy()) return;
  busy = true; scrambleBtn.classList.add('active');
  cube.turnDuration = 70;                          // fast, satisfying shuffle
  let last = '';
  for (let i = 0; i < 24; i++) {
    let f; do { f = SFACES[Math.floor(Math.random() * 6)]; } while (f === last); last = f;
    await cube.move(f + SMODS[Math.floor(Math.random() * 3)]);
  }
  cube.turnDuration = 240;
  busy = false; scrambleBtn.classList.remove('active');
  refreshStatus();
}
function resetCube() {
  if (solving || busy) return;
  cube.dispose();
  cube = new RubiksCube();
  cube.group.scale.setScalar(cubeScale);
  scene.add(cube.group);
  updateContactShadow();
  homeView();
  refreshStatus();
}

// --- method -----------------------------------------------------------------
let mode = 'short';
const METHOD_NAME = { short: 'Shortest', basic: 'Beginner' };
const SRC = { short: './solverShort.js', basic: './solver.js' };
const fns = {};
async function ensureSolver(m) { if (!fns[m]) ({ solve: fns[m] } = await import(SRC[m])); return fns[m]; }
function setMode(m) {
  mode = m;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
}

// --- guided solve -----------------------------------------------------------
let session = null, playbackSpeed = 1;
function buildStrip(flat) {
  const groups = [];
  flat.forEach((s, i) => {
    if (!groups.length || groups[groups.length - 1].phase !== s.phase) groups.push({ phase: s.phase, items: [] });
    groups[groups.length - 1].items.push({ token: s.token, i });
  });
  const solo = groups.length <= 1; // Shortest = one phase -> compact, no labels
  let html = '';
  groups.forEach(g => {
    html += '<div class="grp">';
    if (!solo && g.phase) html += `<div class="glabel">${phaseLabel(g.phase)}</div>`;
    html += '<div class="gchips">';
    g.items.forEach(s => { html += `<span class="chip" data-i="${s.i}"><span class="box">${tokHTML(s.token)}</span></span>`; });
    html += '</div></div>';
  });
  strip.innerHTML = html;
  strip.classList.toggle('solo', solo);
}
function updateUI() {
  const { flat, idx } = session, total = flat.length;
  strip.querySelectorAll('.chip').forEach(el => {
    const i = +el.dataset.i;
    el.classList.toggle('done', i < idx);
    el.classList.toggle('cur', i === idx);
    el.classList.toggle('up', i > idx);
  });
  strip.querySelector('.chip.cur')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  stepCounter.innerHTML = `Step <b>${idx + 1}</b> / ${total}`;
  progBar.style.width = `${Math.round((idx / total) * 100)}%`;
  const cur = flat[idx];
  badgeGlyph.innerHTML = tokHTML(cur.token);
  badgeLabel.innerHTML = hintLabel(cur.token);
  badge.hidden = false;
}
async function showStep() {
  updateUI();
  prevBtn.disabled = session.idx === 0;
  const cur = session.flat[session.idx];
  await ensureSolveView(cur.token);
  showArrow(cur.token);
}
async function startSolve(m) {
  if (solving || busy || editing || cube.isBusy()) return;
  if (m) setMode(m);
  const state = cube.getState();
  if (state.isSolved()) { toast('Already solved 🎉'); return; }

  // 1) enter the solve layout + glide to the solve view BEFORE planning, so the first
  //    (table-building) solve never stutters the transition. Cube ends up positioned;
  //    the brief plan is then just a pause, not a jump.
  solving = true;
  strip.innerHTML = '';
  stateSolver.innerHTML = `<b>${METHOD_NAME[mode]}</b>`;
  setAutoBtn(false);
  statePill.classList.remove('scrambled'); statePill.classList.add('solving');
  stateText.textContent = 'Solving';
  dockIdle.hidden = true; dockSolve.hidden = false;
  onResize();
  if (mode === 'short') toast('Planning the shortest solution…');
  await ensureSolveView(null);

  // 2) plan
  let steps;
  try {
    await new Promise(r => setTimeout(r, 20));
    const solve = await ensureSolver(mode);
    steps = solve(state).steps;
  } catch (err) {
    console.error(err);
    solving = false;
    dockSolve.hidden = true; dockIdle.hidden = false;
    onResize(); homeView(); refreshStatus();
    toast("This cube can't be solved.");
    return;
  }
  // split 180° moves into two 90° steps — one unambiguous quarter turn per step
  const flat = [];
  for (const st of steps) for (const mv of st.moves) {
    if (mv.endsWith('2')) flat.push({ token: mv[0], phase: st.name }, { token: mv[0], phase: st.name });
    else flat.push({ token: mv, phase: st.name });
  }
  if (!flat.length) {
    solving = false;
    dockSolve.hidden = true; dockIdle.hidden = false;
    onResize(); homeView(); refreshStatus();
    toast('Already solved 🎉');
    return;
  }

  // 3) build the strip + reveal the first arrows (camera already at the solve view)
  session = { flat, idx: 0, auto: false };
  cube.turnDuration = Math.round(380 / playbackSpeed);
  buildStrip(flat);
  await showStep();
}
async function nextStep() {
  if (!session || cube.isBusy() || camMoving) return;
  const cur = session.flat[session.idx];
  await ensureSolveView(cur.token);
  clearArrow(); badge.hidden = true;
  await cube.move(cur.token);
  session.idx++;
  if (session.idx >= session.flat.length) { progBar.style.width = '100%'; exitSolve(true); return; }
  await showStep();
  if (session.auto) session.autoTimer = setTimeout(nextStep, Math.round(700 / playbackSpeed));
}
// auto-play: advance on a timer so users can follow along without tapping Next
function setSpeed(s) {
  playbackSpeed = s;
  cube.turnDuration = Math.round(380 / s);
  document.querySelectorAll('#mspeed [data-speed]').forEach(b => b.classList.toggle('on', parseFloat(b.dataset.speed) === s));
}
function toggleAuto() {
  if (!session) return;
  session.auto = !session.auto;
  setAutoBtn(session.auto);
  if (session.auto && !cube.isBusy() && !camMoving) nextStep();
}
async function prevStep() {
  if (!session || cube.isBusy() || camMoving || session.idx === 0) return;
  await ensureSolveView(session.flat[session.idx].token);
  session.idx--;
  clearArrow(); badge.hidden = true;
  await cube.move(invert(session.flat[session.idx].token));
  await showStep();
}
function exitSolve(finished) {
  if (session?.autoTimer) clearTimeout(session.autoTimer);
  clearArrow();
  session = null; solving = false;
  cube.turnDuration = 240;
  dockSolve.hidden = true; dockIdle.hidden = false;
  badge.hidden = true;
  setAutoBtn(false);
  onResize();
  homeView();
  refreshStatus();
  if (finished) toast('Solved — nice work 🎉');
}

// recenter = reset the view: glide zoom back to 100% + return to the natural angle
// (best solve-view mid-solve, else the front hero view)
function recenter() {
  glideZoom(100);
  if (solving && !camMoving) { const cur = session.flat[session.idx]; ensureSolveView(cur.token).then(() => showArrow(cur.token)); }
  else homeView();
}

// --- colour editor (enter your real cube) -----------------------------------
// Same model + validation as desktop: a 6-face net → a throwaway CubeState that's
// checked by cubeError + a trial LBL solve (catches a lone flipped edge) BEFORE it
// ever replaces the on-screen cube. Only the net's visual layout is mobile-tuned.
const rows = (rowVals, colVals, mk) => { const a = []; for (const r of rowVals) for (const c of colVals) a.push(mk(r, c)); return a; };
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

const editSheet = $('editSheet'), cubeNet = $('cubeNet'), palette = $('palette'), editMsg = $('editMsg');
let selColor = 'U', netData = null, netBuilt = false;

function buildEditor() {
  for (const f of ['U', 'D', 'F', 'B', 'R', 'L']) {
    const sw = document.createElement('button');
    sw.className = 'swatch' + (f === selColor ? ' sel' : '');
    sw.style.background = hex(f);
    sw.setAttribute('aria-label', f);
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
      const cell = document.createElement('button');
      cell.className = 'cell' + (idx === 4 ? ' center' : '');
      cell.dataset.face = face; cell.dataset.idx = idx;
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
  if (solving || busy || editing) return;
  if (!netBuilt) buildEditor();
  netData = {};
  for (const f of NET_ORDER) netData[f] = Array(9).fill(f);
  loadCurrentIntoNet();
  renderNet();
  editMsg.textContent = ''; editMsg.className = 'edit-msg';
  editing = true;
  editSheet.hidden = false;
}
function closeEditor() { editing = false; editSheet.hidden = true; }

async function applyEditor() {
  // validate a throwaway state so an invalid entry never clobbers the live cube
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
  const problem = cubeError(test);
  if (problem) { showErr(`Not a solvable cube — ${problem}.`); return; }
  try { const lbl = await ensureSolver('basic'); lbl(test.clone()); }
  catch { showErr('Not a solvable cube — an edge looks flipped.'); return; }

  // valid → load onto the on-screen cube
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

// --- wiring -----------------------------------------------------------------
scrambleBtn.addEventListener('click', doScramble);
$('edit').addEventListener('click', openEditor);
$('editApply').addEventListener('click', applyEditor);
$('editCancel').addEventListener('click', closeEditor);
$('editLoad').addEventListener('click', () => { loadCurrentIntoNet(); renderNet(); });
$('editReset').addEventListener('click', () => { for (const f of NET_ORDER) netData[f] = Array(9).fill(f); renderNet(); });
$('reset').addEventListener('click', resetCube);
$('solve').addEventListener('click', () => startSolve());
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('next').addEventListener('click', nextStep);
prevBtn.addEventListener('click', prevStep);
$('exit').addEventListener('click', () => exitSolve(false));
$('recenter').addEventListener('click', recenter);
mauto.addEventListener('click', toggleAuto);
document.querySelectorAll('#mspeed [data-speed]').forEach(b => b.addEventListener('click', () => setSpeed(parseFloat(b.dataset.speed))));

// --- boot -------------------------------------------------------------------
onResize();
setMode('short');
setSpeed(1);
refreshStatus();
requestAnimationFrame(onResize);
(function loop() { requestAnimationFrame(loop); stepInertia(); renderer.render(scene, camera); })();
