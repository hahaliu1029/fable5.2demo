// MOTHLIGHT // NIGHT RUN — entry point: renderer, the car, the gate run and the frame loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { generateCity, buildIndex, districtAt, DISTRICTS } from './city.js';
import { CAR, newCar, stepCar, makeRoute, crossesGate, trafficAt } from './drive.js';
import { buildWorld } from './world.js';
import { buildDrive } from './car.js';
import { U, GradeShader, SanitizeShader } from './shaders.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { ECHOES, FINALE } from './story.js';
import { parseGLB, decodeBase64 } from './models.js';

const SAVE_KEY = 'mothlight.drive.v1';
const SCAN_SPEED = 120, SCAN_COOLDOWN = 4;
const INTRO = [
  'VESPER-9 // rain index 0.93 // curfew suspended',
  'LUMEN ran every lamp in this city until Halcyon switched it off and sold the dark back to us.',
  'Twelve echoes of it are strung across the streets. The gates will only open in order.',
  'Take every gate. Bring it home to the Spire. The clock starts when you move.',
];

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 6000);

const city = generateCity(9);
const route = makeRoute();
// The echoes now hang in the light gates, so the existing crystals, beams, minimap and compass follow the route.
city.shards = route.gates.map((g) => ({ x: g.x, y: 1.1, z: g.z, roof: false, lift: -1, district: g.district }));
const query = buildIndex(city.colliders);
city.route = route; // the minimap draws it
const MODELS = parseGLB(decodeBase64(document.getElementById('glb').textContent.trim()));
const MODEL_META = JSON.parse(document.getElementById('meta').textContent);
const world = buildWorld(scene, city, MODELS);
const drive = buildDrive(scene, route, MODELS, MODEL_META);
const hud = new Hud(city);
const audio = new Audio();

// ---- post-processing chain: scene -> bloom -> grade -> tone map
const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.65, 0.9);
const grade = new ShaderPass(GradeShader);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new ShaderPass(SanitizeShader));
composer.addPass(bloom);
composer.addPass(grade);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  world.swarm.material.uniforms.uScale.value = h * pixelRatio;
  drive.setScale(h * pixelRatio);
}
window.addEventListener('resize', resize);
resize();

// ---- state
// collected: gates taken (always 0..n-1 in order). revealed/districts/logs keep the HUD's existing shape.
const state = { collected: new Set(), revealed: new Set(), districts: new Set(), logs: new Set(), finale: false, time: 0, best: null, running: false };
const car = newCar(route.start.x, route.start.z, route.start.yaw);
const fmt = (s) => { const t = Math.round(s * 10); return `${String(Math.floor(t / 600)).padStart(2, '0')}:${((t % 600) / 10).toFixed(1).padStart(4, '0')}`; };

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ gates: state.collected.size, districts: [...state.districts], finale: state.finale, time: state.time, best: state.best }));
  } catch { /* storage unavailable: play without saving */ }
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!s || typeof s !== 'object') return false;
    const n = Number.isInteger(s.gates) ? Math.max(0, Math.min(route.gates.length, s.gates)) : 0;
    for (let i = 0; i < n; i++) state.collected.add(i);
    for (const d of Array.isArray(s.districts) ? s.districts : []) if (Number.isInteger(d) && d >= 0 && d < DISTRICTS.length) state.districts.add(d);
    state.finale = !!s.finale && n === route.gates.length;
    state.time = Number.isFinite(s.time) ? Math.max(0, s.time) : 0;
    state.best = Number.isFinite(s.best) && s.best > 0 ? s.best : null;
    return n > 0 || state.best !== null;
  } catch { return false; }
}
// Put the car at the last gate taken (or the start line), pointing at the next one.
function respawn() {
  const n = state.collected.size, from = n ? route.gates[n - 1] : route.start;
  const to = n < route.gates.length ? route.gates[n] : route.finish;
  Object.assign(car, newCar(from.x, from.z, n ? Math.atan2(-(to.x - from.x), -(to.z - from.z)) : route.start.yaw), { boost: car.boost });
  if (n) { // sit in the lane rather than under the gate beam, squared to the road
    const g = route.gates[n - 1];
    car.yaw = g.axis === 'x' ? (to.x >= g.x ? -Math.PI / 2 : Math.PI / 2) : (to.z >= g.z ? Math.PI : 0);
  }
  camPos.set(car.x + Math.sin(car.yaw) * 8, 3, car.z + Math.cos(car.yaw) * 8);
  drive.resetTrails();
}
function syncWorld() {
  const n = state.collected.size;
  state.revealed.clear();
  route.gates.forEach((_, i) => {
    if (i === n) state.revealed.add(i);
    world.setShard(i, { collected: i < n, revealed: i === n });
    drive.setGate(i, i < n ? 'done' : i === n ? 'next' : 'ahead');
  });
  drive.setFinish(n === route.gates.length && !state.finale);
  hud.counters(state);
  hud.time(fmt(state.time));
}

// ---- input
const keys = new Set();
const pressed = new Set(); // edge-triggered, cleared every frame
let mode = 'title';
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  keys.add(e.code);
  if (mode === 'title' && e.code === 'Enter') start(false);
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.key === 'Meta') keys.clear(); });
window.addEventListener('blur', () => keys.clear());
const held = (...codes) => codes.some((c) => keys.has(c));

function start(fresh) {
  if (fresh) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ best: state.best })); } catch { /* ignore */ }
    location.reload(); // echo swarms are rebuilt cleanly on reload; the best time is kept
    return;
  }
  if (mode === 'play') return; // a still-focused title button must not restart the intro
  mode = 'play';
  document.activeElement?.blur();
  document.getElementById('title').classList.add('off');
  hud.show(true);
  audio.start();
  audio.blip();
  if (state.collected.size === 0) hud.say('NIGHT RUN', INTRO, 2400);
  else hud.say('LINK RESTORED', `${state.collected.size} of 12 echoes carried. ${state.finale ? 'The city is yours to drive.' : 'The next gate is lit.'}`);
  lastDistrict = -1;
}
document.getElementById('btn-start').addEventListener('click', () => start(false));
document.getElementById('btn-new').addEventListener('click', () => start(true));

// ---- rules
let lastDistrict = -1, scanT = -100, finaleK = 0, flashAt = 14;
let shake = 0, hitCd = 0, camMode = 0, steer = 0, fovNow = 64;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tp = {};
const envHide = [world.ground]; // kept out of the car's reflection cube
const drv = { steer: 0, brake: false, boosting: false, slip: 0, accel: 0 };

function flash() { const fl = document.getElementById('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go'); }

function takeGate(i) {
  state.collected.add(i);
  audio.pickup(); flash();
  U.uPulse.value.set(route.gates[i].x, route.gates[i].z, 0, 1); scanT = clock.t;
  const n = state.collected.size;
  hud.clear();
  hud.say(`ECHO ${String(n).padStart(2, '0')} / 12   ·   ${fmt(state.time)}`, `"${ECHOES[n - 1]}"`, 3600);
  if (n === route.gates.length) hud.say('ALL ECHOES CARRIED', 'Bring them home. The ring in front of the Spire is lit.', 4200);
  syncWorld(); save();
}

function finishRun() {
  state.finale = true; state.running = false;
  const record = state.best === null || state.time < state.best;
  if (record) state.best = state.time;
  audio.finale(); flash(); hud.clear();
  hud.say(`SIGNAL RELEASED   ·   ${fmt(state.time)}${record ? '   ·   NEW BEST' : `   ·   best ${fmt(state.best)}`}`, FINALE, 4200);
  U.uPulse.value.set(0, 0, 0, 1); scanT = clock.t;
  syncWorld(); save();
}

function updateCar(dt) {
  const thr = (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0);
  const want = (held('KeyA', 'ArrowLeft') ? 1 : 0) - (held('KeyD', 'ArrowRight') ? 1 : 0);
  steer += (want - steer) * Math.min(1, dt * (want === 0 ? 9 : 6)); // the wheel takes a moment to turn
  const input = { throttle: thr, steer, handbrake: held('Space'), boost: held('ShiftLeft', 'ShiftRight') };
  const x0 = car.x, z0 = car.z, v0 = car.speed;
  const res = stepCar(car, input, dt, query);
  if (!state.running && !state.finale && car.speed > 0.5) state.running = true;

  // Ground traffic is solid: shove the player out and scrub speed.
  for (const tc of drive.cars) {
    trafficAt(tc, clock.t, tp);
    const dx = car.x - tp.x, dz = car.z - tp.z, d = Math.hypot(dx, dz);
    const along = Math.abs(tc.axis === 'x' ? dx : dz), across = Math.abs(tc.axis === 'x' ? dz : dx); // in the lane's frame: cars are long
    if (along < 4.6 && across < 2.0 && d > 1e-3 && tp.edge > 0.5) {
      const push = Math.max(0.05, Math.min(4.6 - along, 2.0 - across));
      car.x += (dx / d) * push; car.z += (dz / d) * push;
      res.hit = Math.max(res.hit, car.speed * 0.6);
      car.vx = car.vx * 0.5 + (dx / d) * 4; car.vz = car.vz * 0.5 + (dz / d) * 4;
    }
  }
  hitCd -= dt;
  if (res.hit > 6 && hitCd <= 0) { hitCd = 0.35; shake = Math.min(0.5, res.hit / 60); audio.crash(Math.min(1, res.hit / 45)); }

  const n = state.collected.size;
  if (n < route.gates.length && crossesGate(route.gates[n], x0, z0, car.x, car.z)) takeGate(n);
  else if (n === route.gates.length && !state.finale && Math.hypot(car.x - route.finish.x, car.z - route.finish.z) < route.finish.r) finishRun();

  Object.assign(drv, { steer, brake: thr < 0 || input.handbrake, boosting: res.boosting, slip: res.slip, accel: (car.speed - v0) / Math.max(dt, 1e-3) / 20 });
  audio.engine(Math.min(1, car.speed / CAR.boostSpeed), thr, Math.min(1, Math.abs(res.slip) / 12), res.boosting);
}

function updateRules(now, dt) {
  if (state.running) state.time += dt;
  const d = districtAt(car.x, car.z);
  if (d !== lastDistrict) {
    lastDistrict = d; hud.district(d);
    if (!state.districts.has(d)) { state.districts.add(d); hud.banner(DISTRICTS[d].name, DISTRICTS[d].tag); hud.counters(state); save(); }
  }
  const r = (now - scanT) * SCAN_SPEED;
  if (r < 260) { U.uPulse.value.z = r; U.uPulse.value.w = Math.max(0, 1 - r / 260); } else U.uPulse.value.w = 0;
  if (pressed.has('KeyQ')) {
    if (now - scanT < SCAN_COOLDOWN) audio.deny();
    else { scanT = now; U.uPulse.value.set(car.x, car.z, 0, 1); audio.scan(); }
  }
  if (pressed.has('KeyR')) { respawn(); audio.blip(); }
  if (pressed.has('KeyC')) camMode = (camMode + 1) % 2;
  if (pressed.has('KeyM')) hud.say('AUDIO', audio.toggleMute() ? 'Muted.' : 'Sound on.', 900);

  const n = state.collected.size;
  const tgt = n < route.gates.length ? route.gates[n] : state.finale ? null : route.finish;
  hud.drawCompass(car.yaw, tgt ? { dx: tgt.x - car.x, dz: tgt.z - car.z, color: n < route.gates.length ? '#5ff2ff' : '#ff4d9d' } : null);
  hud.prompt(tgt && car.speed < 1.5 && state.running ? '[R] back to the last gate' : '');
  hud.status(car.speed * 3.6, drv.boosting ? 'BOOST' : Math.abs(drv.slip) > 5 ? 'DRIFT' : 'GRIP', car.boost);
  hud.time(fmt(state.time));
}

function updateCamera(dt) {
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), sp = Math.min(1, car.speed / CAR.boostSpeed);
  const back = camMode === 0 ? 6.0 + 2.0 * sp : 0.5, up = camMode === 0 ? 2.0 + 0.45 * sp : 1.55; // mode 1: over the roof, clear of the body
  const gx = car.x - fx * back, gz = car.z - fz * back;
  camPos.x += (gx - camPos.x) * Math.min(1, dt * (camMode === 0 ? 15 : 30));
  camPos.z += (gz - camPos.z) * Math.min(1, dt * (camMode === 0 ? 15 : 30));
  camPos.y += (up - camPos.y) * Math.min(1, dt * 5);
  // keep the chase camera out of walls: if it ends up inside a box, slide it toward the car
  if (camMode === 0) {
    for (let k = 0; k < 6; k++) {
      const inside = query(camPos.x - 0.4, camPos.x + 0.4, camPos.z - 0.4, camPos.z + 0.4)
        .some((b) => camPos.x > b.minX - 0.4 && camPos.x < b.maxX + 0.4 && camPos.z > b.minZ - 0.4 && camPos.z < b.maxZ + 0.4 && camPos.y < b.y1 && camPos.y > b.y0 - 0.2);
      if (!inside) break;
      camPos.x += (car.x - camPos.x) * 0.25; camPos.z += (car.z - camPos.z) * 0.25;
    }
  }
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += Math.sin(clock.t * 91) * shake * 0.5; camera.position.y += Math.sin(clock.t * 77 + 1) * shake * 0.4;
    shake = Math.max(0, shake - dt * 1.4);
  }
  camLook.set(car.x + fx * (6 + 6 * sp), 1.0, car.z + fz * (6 + 6 * sp));
  camera.lookAt(camLook);
  fovNow += ((camMode === 0 ? 62 : 74) + 20 * sp * sp + (drv.boosting ? 6 : 0) - fovNow) * Math.min(1, 4 * dt);
}

// ---- frame loop
const clock = { t: 0, last: performance.now() };
let slow = 0, frames = 0, shot = null;

function tick(dt) {
  clock.t += dt;
  const t = clock.t;
  U.uTime.value = t;
  grade.uniforms.uTime.value = t;

  if (mode === 'play') {
    const steps = dt > 0.02 ? 2 : 1;
    for (let i = 0; i < steps; i++) updateCar(dt / steps);
    updateRules(t, dt);
    updateCamera(dt);
    if (frames % 3 === 0) hud.drawMap(car, state, t);
  } else {
    // Title screen: slow orbit of the Spire, the car waiting on the start line.
    const a = t * 0.05 + 0.9;
    camera.position.set(Math.cos(a) * 290, 225 + Math.sin(t * 0.1) * 10, Math.sin(a) * 290);
    camera.lookAt(0, 120, 0);
    fovNow = 74;
  }
  const cine = window.__game && window.__game.cine; // scripted camera (film renderer)
  if (cine) { camera.position.set(...cine.pos); camera.lookAt(cine.look[0], cine.look[1], cine.look[2]); if (cine.fov) fovNow = cine.fov; }
  if (Math.abs(camera.fov - fovNow) > 0.05) { camera.fov = fovNow; camera.updateProjectionMatrix(); }
  pressed.clear();
  hud.update(dt);
  drive.update(car, drv, t, dt);

  // Lightning: a sky flash now and then, thunder a moment later.
  if (t > flashAt) { flashAt = t + 22 + Math.random() * 30; U.uFlash.value = 1; setTimeout(() => audio.thunder(), 900 + Math.random() * 1500); }
  U.uFlash.value *= Math.exp(-dt * (U.uFlash.value > 0.6 ? 14 : 3)) * (Math.random() < 0.08 && U.uFlash.value > 0.2 ? 1.6 : 1);

  if (state.finale && finaleK < 1) { finaleK = Math.min(1, finaleK + dt / 7); world.setFinale(finaleK * finaleK * (3 - 2 * finaleK)); }
  bloom.strength = 0.55 + 0.12 * finaleK + 0.1 * Math.min(1, car.speed / CAR.boostSpeed);

  world.update(t, dt, camera);
  drive.updateEnv(renderer, envHide);
  composer.render();
  frames++;
}

function frame(nowMs) {
  requestAnimationFrame(frame);
  const raw = (nowMs - clock.last) / 1000;
  clock.last = nowMs;
  if (window.__game.paused) return;
  tick(Math.min(0.05, Math.max(0.001, raw)));

  if (shot) {
    const { name, done } = shot; shot = null;
    canvas.toBlob((blob) => fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob }).then(() => done(true), () => done(false)), 'image/png');
  }
  // Drop resolution if the machine cannot hold ~40 fps (stalls such as a hidden tab do not count).
  if (raw < 0.25) slow = raw > 0.026 ? slow + 1 : Math.max(0, slow - 2);
  if (slow > 90 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); slow = 0; resize(); }
}

// ---- boot
const hasSave = load();
document.getElementById('btn-start').textContent = hasSave && state.collected.size ? 'CONTINUE' : 'IGNITION';
document.getElementById('btn-new').style.display = hasSave ? '' : 'none';
if (state.finale) { finaleK = 1; world.setFinale(1); }
respawn();
syncWorld();
setInterval(() => { if (mode === 'play') save(); }, 10000);

// Hooks used by the acceptance pass and the film renderer; not needed for play.
window.__game = {
  car, state, city, route, start, world, drive, U,
  paused: false, cine: null,
  get mode() { return mode; },
  place(x, z, yaw = car.yaw) { Object.assign(car, { x, z, yaw, vx: 0, vz: 0 }); camPos.set(x + Math.sin(yaw) * 8, 3, z + Math.cos(yaw) * 8); drive.resetTrails(); },
  press(code) { pressed.add(code); },
  hold(code, on = true) { if (on) keys.add(code); else keys.delete(code); },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt); },
  shot: (name) => new Promise((done) => { shot = { name, done }; }),
  stats: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pixelRatio, mode }),
};
requestAnimationFrame(frame);
