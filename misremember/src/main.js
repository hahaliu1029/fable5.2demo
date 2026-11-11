// MISREMEMBER — entry point: player, eyes, interaction, and the glue between the story reducer and the house.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { loadAssets } from './game/assets.js';
import { World, toThree } from './game/world.js';
import { populate } from './game/content.js';
import { createAudio } from './game/audio.js';
import { createDrift } from './core/drift.js';
import { createGesture } from './core/gaze.js';
import { inView } from './core/observe.js';
import { move } from './core/collide.js';
import { applyT } from './core/layout.js';
import { initial, advance, NOTES } from './core/story.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const NOLOCK = params.has('nolock');
const R = 0.25;
const EYE = 1.62;
const FOV = 66;
const LIGHT_K = 0.03; // real-time lamp strength per baked watt: a little direction and sparkle on top of the room's own light

const events = (() => {
  const subs = {};
  return { on: (k, f) => (subs[k] ??= []).push(f), emit: (k, ...a) => (subs[k] ?? []).forEach((f) => f(...a)) };
})();

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.92;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#000000');
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.03, 60);
camera.rotation.order = 'YXZ';
scene.add(camera);
// the picture goes through an HDR buffer so the lamps and windows can bloom; it needs a stencil for the portals
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.75, 1.0));
composer.addPass(new OutputPass());
const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

const assets = await loadAssets(window.__DATA, renderer);
const world = new World(scene, assets, events);
world.link('hall', 'kitchen', 'kitchen', 'hall');
world.link('hall', 'bed', 'bedroom', 'hall');
world.link('bedroom', 'nook', 'nook', 'bedroom', 'eyes');
world.link('kitchen', 'pantry', 'pantry', 'kitchen', 'solid');
const content = populate(world, assets);
const drift = createDrift();
for (const [id, s] of Object.entries(content.slots)) drift.add({ id, room: s.room, value: s.value });

world.captureEnvironments(renderer);
const lamps = Array.from({ length: 5 }, () => { const l = new THREE.PointLight('#ffffff', 0, 0, 2); scene.add(l); return l; });

let audio = null;
const gesture = createGesture();
const player = { pos: [0.9, 0.75], yaw: Math.PI / 2, pitch: 0, stride: 0, bob: 0 };
const eyes = { amount: 1, held: false, forced: 0, atClosed: [] };
const keys = new Set();
let story = initial();
const anchors = new Set(); // drift slots held true by an anchor
const ANCHORS = { watch: ['kitchen.clock', 'kitchen.chairs', 'kitchen.photo'], rings: ['kitchen.chairs', 'kitchen.photo', 'kitchen.frames'] };
// doorways that lead to the bedroom whenever they are opened (from the second evening, nearly all of them)
const toBedroom = new Set(['bed']);
let watchTaken = false;
let asleep = false;
let started = false;
let ended = false;
let asking = null;
let target = null;
let sayTimer = 0;

// ---------------------------------------------------------------- ui
const say = (text, secs = 5) => { $('say').textContent = text; $('say').style.opacity = 1; sayTimer = secs; };
{
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const im = g.createImageData(256, 256);
  for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0);
  $('grain').style.backgroundImage = `url(${c.toDataURL()})`;
}

// ---------------------------------------------------------------- story plumbing
function forceBlink(secs = 0.45, then = null) {
  eyes.forced = Math.max(eyes.forced, secs);
  if (then) eyes.atClosed.push(then);
}

function dispatch(ev) {
  const { state, effects } = advance(story, ev);
  story = state;
  for (const fx of effects) {
    if (fx.type === 'note') content.setNote(fx.id, fx.text, fx.show, fx.ask);
    else if (fx.type === 'drift') {
      if (fx.now) forceBlink(0.45, () => { drift.set(fx.id, fx.value, { permanent: fx.value === 'empty' }); content.slots[fx.id].apply(fx.value); });
      else drift.queue(fx.id, fx.value);
    } else if (fx.type === 'set') { drift.set(fx.id, fx.value); content.slots[fx.id].apply(fx.value); }
    else if (fx.type === 'truth') drift.setTruth(fx.id, fx.value);
    else if (fx.type === 'pantry') world.door('kitchen', 'pantry').state.veil = 'seen';
    else if (fx.type === 'night') night(fx);
    else if (fx.type === 'unveil') world.door(fx.room, fx.door).state.pendingUnveil = true;
    else if (fx.type === 'blink') forceBlink(0.6);
    else if (fx.type === 'say') say(fx.text);
    else if (fx.type === 'anchor' && fx.item === 'rings') {
      for (const id of ANCHORS.rings) anchors.add(id);
      world.rooms.kitchen.group.add(content.rings);
      content.rings.scale.setScalar(1);
      content.rings.position.copy(toThree(2.2, 2.52, 0.741));
      content.rings.rotation.set(0, 0.3, 0);
      audio?.settle();
    } else if (fx.type === 'anchor') {
      for (const id of ANCHORS.watch) anchors.add(id);
      world.rooms.kitchen.group.add(content.watch);
      content.watch.scale.setScalar(1);
      content.watch.position.copy(toThree(1.95, 2.45, 0.741));
      content.watch.rotation.set(0, 0.6, 0);
      audio?.settle();
      if (audio) { audio.emitters.watch.room = 'kitchen'; audio.emitters.watch.pos = [1.95, 2.45, 0.75]; audio.emitters.watch.carried = false; }
    } else if (fx.type === 'end') finish(fx);
  }
}

function finish(fx) {
  ended = true;
  eyes.forced = 1e9;
  audio?.fade(0.0, 4);
  $('endTitle').textContent = 'END OF THE SECOND EVENING';
  $('endSub').textContent = fx.anchored ? 'Three places were laid tonight. There were only ever three.' : 'The table is still being counted.';
  $('endBody').innerHTML = 'Evening three — OUTSIDE — has not been remembered yet.';
  setTimeout(() => { $('end').style.opacity = 1; document.exitPointerLock?.(); }, 1400);
}

// Sleep: the eyes stay shut behind a title card while the house is rearranged for the next evening.
function night(fx) {
  asleep = true;
  drift.clearAll(); // nothing left over from this evening may land during the next
  eyes.forced = 8;
  $('endTitle').textContent = 'EVENING TWO';
  $('endSub').textContent = 'count';
  $('endBody').innerHTML = fx.watch === 'placed' ? 'The kitchen held still last night.' : fx.watch === 'held' ? 'You fell asleep holding the watch.' : 'The kitchen was still wrong when you slept.';
  setTimeout(() => { $('end').style.opacity = 1; }, 900);
  setTimeout(() => {
    anchors.clear();
    if (fx.watch === 'placed') anchors.add('kitchen.clock');
    if (fx.watch === 'held') { // it is on the bedside table in the morning, and it has stopped being listened to
      world.rooms.bedroom.group.add(content.watch);
      content.watch.scale.setScalar(1);
      content.watch.position.copy(toThree(0.64, 3.6, 0.546));
      content.watch.rotation.set(0, 1.1, 0);
      if (audio) { audio.emitters.watch.room = 'bedroom'; audio.emitters.watch.pos = [0.64, 3.6, 0.55]; audio.emitters.watch.carried = false; }
    }
    for (const room of Object.values(world.rooms)) for (const d of Object.values(room.doors)) { d.state.open = 0; d.state.target = 0; d.state.opener = null; }
    for (const id of ['living', 'bath', 'extra1', 'extra2']) toBedroom.add(id);
    world.current = 'bedroom';
    player.pos = [1.9, 1.45]; player.yaw = Math.PI; player.pitch = 0;
    content.layTable();
    host.active = false; host.cool = 30; content.host.visible = false;
    dispatch({ type: 'wake' });
  }, 3200);
  setTimeout(() => { $('end').style.opacity = 0; }, 5200);
  setTimeout(() => { asleep = false; eyes.forced = 0.4; }, 6600);
}

events.on('enter', (room) => { audio?.latch(0.0); dispatch({ type: 'enter', room }); });
events.on('door-open', () => audio?.creak());
events.on('door-shut', (d, dist) => { if (dist < 6) audio?.latch(0.5); });
events.on('unveiled', () => audio?.cue());
events.on('need-blink', () => forceBlink(0.3));

// ---------------------------------------------------------------- input
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (!started || ended || asleep) return;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyE' && target && eyes.amount < 0.5) target.act();
  if (asking && (e.code === 'KeyY' || e.code === 'KeyN')) answer(e.code === 'KeyY' ? 'yes' : 'no');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('mousemove', (e) => {
  if (!started || ended || (!NOLOCK && document.pointerLockElement !== canvas)) return;
  if (NOLOCK && !(e.buttons & 1)) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - e.movementY * 0.0022));
  if (asking) { const a = gesture.feed(e.movementX, e.movementY, performance.now() / 1000); if (a) answer(a); }
});
function answer(value) {
  const id = asking.id;
  asking = null;
  gesture.reset();
  dispatch({ type: 'answer', note: id, value });
}
function begin() {
  if (started) { if (!NOLOCK && !ended) canvas.requestPointerLock(); return; }
  started = true;
  audio = createAudio();
  audio.addEmitter('fridge', 'kitchen', [3.98, 4.62, 0.9], 0.06, audio.hum);
  Object.assign(audio.addEmitter('clock', 'kitchen', [4.4, 3.4, 1.95], 0.5), { rate: 1, freq: 2300, dur: 0.012, beat: 0 });
  Object.assign(audio.addEmitter('watch', 'nook', [0.8, 0.7, 0.9], 0.4), { rate: 0.2, freq: 5200, dur: 0.006, beat: 0 });
  audio.start();
  if (!NOLOCK) canvas.requestPointerLock();
  $('title').style.opacity = 0;
  $('title').style.pointerEvents = 'none';
  eyes.forced = 1.2;
  $('hint').style.opacity = 0.75;
  setTimeout(() => { $('hint').style.opacity = 0; }, 14000);
}
$('title').addEventListener('click', begin);
$('pause').addEventListener('click', begin);
canvas.addEventListener('click', begin);
document.addEventListener('pointerlockchange', () => {
  $('pause').style.display = started && !ended && !NOLOCK && document.pointerLockElement !== canvas ? 'flex' : 'none';
});

// ---------------------------------------------------------------- interaction
function interactables() {
  const cur = world.rooms[world.current];
  const list = [];
  for (const d of Object.values(cur.doors)) {
    const st = d.state;
    if (st.veil !== 'none' || st.open > 0 || st.target > 0) continue;
    const linked = st.ends.length === 2;
    const home = cur.name === 'hall' && toBedroom.has(d.id); // every such door opens onto your own room
    list.push({
      pos: [d.frame.inner[0], d.frame.inner[1], 1.45], cone: 0.55, reach: 2.0, label: 'open',
      act: () => {
        // the bedroom can only be moved behind another door once its current doorway has shut
        const held = !linked && home && (world.other('bedroom', world.door('bedroom', 'hall'))?.door.state.open ?? 0) > 0;
        if (held) { audio?.rattle(); return; }
        if (!linked && home) world.relink('hall', d.id, 'bedroom', 'hall');
        if (linked || home) world.open(world.door(cur.name, d.id));
        else { audio?.rattle(); say(NOTES.notyet.replace(/\n/g, ' ')); }
      },
    });
  }
  if (cur.name === 'kitchen') {
    if (story.evening === 1 && !story.ate) list.push({ pos: [2.55, 2.08, 0.78], cone: 0.3, reach: 1.7, label: 'eat', act: () => dispatch({ type: 'eat' }) });
    if (story.carrying === 'watch') list.push({ pos: [2.1, 2.35, 0.76], cone: 0.4, reach: 1.9, label: 'put the watch down', act: () => dispatch({ type: 'place', item: 'watch', room: 'kitchen' }) });
  }
  if (cur.name === 'bedroom') list.push({ pos: [1.9, 3.2, 0.62], cone: 0.4, reach: 2.1, label: 'sleep', act: () => dispatch({ type: 'sleep' }) });
  if (cur.name === 'kitchen' && story.carrying === 'rings') list.push({ pos: [2.2, 2.4, 0.76], cone: 0.45, reach: 2.0, label: 'put the rings down', act: () => dispatch({ type: 'place', item: 'rings', room: 'kitchen' }) });
  if (cur.name === 'pantry' && story.evening === 2 && !story.carrying && !story.rings) {
    list.push({ pos: [1.72, 1.15, 1.07], cone: 0.4, reach: 1.7, label: 'take the rings', act: takeRings });
  }
  if (cur.name === 'nook' && story.evening === 1 && !story.carrying && !watchTaken) {
    list.push({ pos: [0.8, 0.7, 0.92], cone: 0.35, reach: 1.6, label: 'take the watch', act: takeWatch });
  }
  return list;
}

function takeRings() {
  camera.add(content.rings);
  content.rings.position.set(0.2, -0.19, -0.5);
  content.rings.rotation.set(0.35, 0.3, 0);
  content.rings.scale.setScalar(0.85);
  audio?.pickup();
  dispatch({ type: 'pickup', item: 'rings' });
}

function takeWatch() {
  watchTaken = true;
  camera.add(content.watch);
  content.watch.position.set(0.17, -0.16, -0.36);
  content.watch.rotation.set(1.05, 0.25, 0.1);
  content.watch.scale.setScalar(1.25);
  audio?.pickup();
  if (audio) audio.emitters.watch.carried = true;
  dispatch({ type: 'pickup', item: 'watch' });
}

function pick(list, eye, fwd) {
  let best = null;
  let bestAng = Infinity;
  for (const it of list) {
    const d = [it.pos[0] - eye[0], it.pos[1] - eye[1], it.pos[2] - eye[2]];
    const len = Math.hypot(...d);
    if (len > it.reach) continue;
    const ang = Math.acos(Math.min(1, (d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2]) / len));
    if (ang < it.cone && ang < bestAng) { best = it; bestAng = ang; }
  }
  return best;
}

// ---------------------------------------------------------------- the Host
// It stands somewhere you are not looking. At the edge of your vision it is solid; turn towards it and it is not there.
const HOST_SPOTS = { hall: [0.9, 6.95], kitchen: [0.5, 4.05], bedroom: [2.75, 0.5] };
const host = { active: false, cool: 14, room: null, pos: null, faded: 0 };
function updateHost(dt, cam, closed) {
  const mesh = content.host;
  if (!story.ate || ended) { mesh.visible = false; return; }
  if (!host.active) {
    host.cool -= dt;
    const spot = HOST_SPOTS[world.current];
    if (host.cool > 0 || !spot) return;
    const far = Math.hypot(spot[0] - player.pos[0], spot[1] - player.pos[1]) > 3.4;
    if (!far || (!closed && inView(cam, [spot[0], spot[1], 1.2], 1.3, 0.3))) return;
    host.active = true; host.room = world.current; host.pos = spot; host.faded = 0;
    world.rooms[host.room].group.add(mesh);
    mesh.position.copy(toThree(spot[0], spot[1], 0));
    mesh.visible = true;
    return;
  }
  const d = [host.pos[0] - player.pos[0], host.pos[1] - player.pos[1]];
  const dist = Math.hypot(...d);
  const ang = Math.acos(Math.max(-1, Math.min(1, (d[0] * cam.fwd[0] + d[1] * cam.fwd[1]) / (dist * Math.hypot(cam.fwd[0], cam.fwd[1]) || 1))));
  mesh.rotation.y = Math.atan2(-d[1], -d[0]) - Math.PI / 2;
  const edge = Math.min(1, Math.max(0, (ang - 0.32) / 0.22));
  if (!closed && (ang < 0.32 || dist < 2.8)) host.faded += dt * 5;
  content.hostMat.opacity = edge * edge * (3 - 2 * edge) * Math.max(0, 1 - host.faded);
  if (host.room !== world.current || host.faded >= 1) {
    host.active = false; host.cool = 22 + Math.random() * 26;
    mesh.visible = false;
  }
}

// ---------------------------------------------------------------- frame
const clock = new THREE.Clock();
let lastRoom = null;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const cur = () => world.rooms[world.current];
  const live = started && !ended && !asleep && (NOLOCK || document.pointerLockElement === canvas);

  // eyes
  eyes.forced = Math.max(0, eyes.forced - dt);
  const blind = world.inBlindDoorway(player.pos, R);
  const want = !started || eyes.forced > 0 || blind || (live && keys.has('Space')) ? 1 : 0;
  eyes.amount = want ? Math.min(1, eyes.amount + dt / 0.14) : Math.max(0, eyes.amount - dt / 0.2);
  const closed = eyes.amount > 0.96;
  if (closed && eyes.atClosed.length) { for (const f of eyes.atClosed.splice(0)) f(); }
  const lid = `${eyes.amount * 51}vh`;
  $('lidT').style.height = `calc(${lid} + ${eyes.amount > 0.01 ? 60 : 0}px)`;
  $('lidB').style.height = `calc(${lid} + ${eyes.amount > 0.01 ? 60 : 0}px)`;

  // movement
  if (live) {
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const len = Math.hypot(f, s);
    if (len > 0) {
      const speed = (closed ? 1.25 : 1.95) * dt / len;
      const c = Math.cos(player.yaw);
      const sn = Math.sin(player.yaw);
      const delta = [(c * f + sn * s) * speed, (sn * f - c * s) * speed];
      const room = cur();
      const next = move({ room: room.def, frames: Object.values(room.doors).map((d) => d.frame), open: world.passable(closed), colliders: room.colliders, r: R }, player.pos, delta);
      const moved = Math.hypot(next[0] - player.pos[0], next[1] - player.pos[1]);
      const through = world.cross(player.pos, next, closed);
      if (through) { player.pos = through.pos; player.yaw += through.turn; } else player.pos = next;
      player.stride += moved;
      player.bob += moved * 4.4;
      if (player.stride > 0.72) { player.stride = 0; audio?.step(cur().def.floor); }
    }
  }
  camera.position.set(player.pos[0], EYE + Math.sin(player.bob) * 0.018, -player.pos[1]);
  camera.rotation.y = player.yaw - Math.PI / 2;
  camera.rotation.x = player.pitch;

  // what the player can see, in the current room's plan coordinates
  const cp = Math.cos(player.pitch);
  const fwd = [Math.cos(player.yaw) * cp, Math.sin(player.yaw) * cp, Math.sin(player.pitch)];
  const right = [Math.sin(player.yaw), -Math.cos(player.yaw), 0];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const eye = [player.pos[0], player.pos[1], EYE];
  const cam = { pos: eye, fwd, right, up, tanH: tanV * camera.aspect, tanV };

  world.update(dt, { eyesClosed: closed, cam, pos: player.pos, camWorld: camera.position });

  // drift: only what nobody is looking at
  const observed = (id) => {
    const s = content.slots[id];
    if (closed) return false;
    if (s.room === world.current) return inView(cam, s.center, s.radius, 0.12) || (s.also ?? []).some(([c, r]) => inView(cam, c, r, 0.12));
    return world.visible.has(s.room);
  };
  // a room merely drawn through a doorway holds still, but only what is on screen in this room counts as seen
  const witnessed = (id) => content.slots[id].room === world.current && observed(id);
  for (const ch of drift.tick(dt, observed, (room, id) => anchors.has(id), witnessed)) {
    content.slots[ch.id].apply(ch.to);
    if (started) audio?.cue();
    if (!asleep) dispatch({ type: 'drifted', id: ch.id, value: ch.to });
  }
  content.update();
  updateHost(dt, cam, closed);

  // lamps for the loose props
  if (lastRoom !== world.current) {
    lastRoom = world.current;
    cur().lights.forEach((l, i) => {
      if (!lamps[i]) return;
      lamps[i].position.copy(toThree(...l.at));
      lamps[i].color.setRGB(...l.color);
      lamps[i].intensity = l.w * LIGHT_K;
    });
    for (let i = cur().lights.length; i < lamps.length; i++) lamps[i].intensity = 0;
    scene.environment = cur().env;
  }

  // notes and things to use
  let caption = null;
  asking = null;
  target = null;
  if (live && eyes.amount < 0.5) {
    const notes = Object.values(content.notes).filter((n) => n.show && n.room === world.current)
      .map((n) => ({ pos: n.pos, cone: 0.3, reach: 2.4, note: n }));
    const hit = pick(notes, eye, fwd);
    if (hit) {
      caption = hit.note.text;
      if (!hit.note.read) { hit.note.read = true; dispatch({ type: 'read', note: hit.note.id }); }
      if (hit.note.ask) asking = hit.note;
    }
    target = pick(interactables(), eye, fwd);
  }
  $('caption').textContent = caption ?? $('caption').textContent;
  $('caption').style.opacity = caption ? 1 : 0;
  const prompt = asking ? 'nod — yes &nbsp;·&nbsp; shake — no' : target ? `<b>E</b>${target.label}` : '';
  if ($('prompt').dataset.v !== prompt) { $('prompt').dataset.v = prompt; if (prompt) $('prompt').innerHTML = prompt; }
  $('prompt').style.opacity = prompt ? 0.9 : 0;
  if (!asking) gesture.reset();
  if (sayTimer > 0) { sayTimer -= dt; if (sayTimer <= 0) $('say').style.opacity = 0; }
  $('grain').style.backgroundPosition = `${Math.floor(Math.random() * 256)}px ${Math.floor(Math.random() * 256)}px`;

  if (audio) {
    const lf = [fwd[0], fwd[2], -fwd[1]];
    audio.update({ pos: [camera.position.x, camera.position.y, camera.position.z], fwd: lf }, (em) => {
      if (em.carried) return { pos: new THREE.Vector3(camera.position.x + lf[0] * 0.3, 1.2, camera.position.z + lf[2] * 0.3), gain: 0.5 };
      if (em.room === world.current) return { pos: toThree(...em.pos), gain: 1 };
      const d = Object.values(cur().doors).find((x) => x.T && world.other(world.current, x)?.room.name === em.room);
      if (!d) return null;
      const p = applyT(d.T, em.pos);
      return { pos: toThree(p[0], p[1], em.pos[2]), gain: 0.4 };
    }, closed);
  }

  if (!closed) composer.render(dt);
}

$('go').textContent = 'click to come in';
window.__game = {
  world, player, drift, content, eyes, dispatch, renderer, scene, camera, host, anchors,
  get story() { return story; },
  tp(room, x, y, yawDeg = 90, pitch = 0) { world.current = room; player.pos = [x, y]; player.yaw = THREE.MathUtils.degToRad(yawDeg); player.pitch = pitch; },
  begin,
};
frame();
if (params.has('autostart')) begin();
