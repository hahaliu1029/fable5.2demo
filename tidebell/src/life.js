// Marine life: GPU-animated fish schools, path-following creatures and jellyfish blooms.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { SITES, GORGE, heightAt } from './terrain.js';
import { shared } from './gfx.js';
import { propMaterial } from './world.js';
import * as S from './shaders.js';

const above = (x, z, h) => [x, heightAt(x, z) + h, z];

// mode 0: a stream following a Lissajous path. mode 1: a vortex ("bait ball") circling its home.
const SCHOOLS = [
  { geo: 'fish_darter', id: 'darter', n: 140, home: above(10, -60, 5), rad: [26, 2, 22], freq: [0.16, 0.23, 0.13], spread: [5, 1.6, 5], len: 0.42, scale: [1.1, 1.6] },
  { geo: 'fish_darter', id: 'darter', n: 160, home: above(-90, -130, 6), rad: [34, 2.5, 28], freq: [0.12, 0.2, 0.15], spread: [6, 2, 6], len: 0.42, scale: [1.1, 1.6] },
  { geo: 'fish_darter', id: 'darter', n: 120, home: above(110, -170, 6), rad: [28, 2, 30], freq: [0.14, 0.19, 0.11], spread: [5, 2, 5], len: 0.42, scale: [1.1, 1.6] },
  { geo: 'fish_chromlet', id: 'chromlet', n: 90, home: above(26, -96, 6.5), rad: [3, 0.8, 3], freq: [0.3, 0.5, 0.26], spread: [5, 2.2, 5], len: 0.3, scale: [1.0, 1.7], wag: 14 },
  { geo: 'fish_chromlet', id: 'chromlet', n: 80, home: above(-40, -70, 5), rad: [3, 0.8, 3], freq: [0.27, 0.4, 0.3], spread: [5, 2, 5], len: 0.3, scale: [1.0, 1.7], wag: 14 },
  { geo: 'fish_chromlet', id: 'chromlet', n: 80, home: above(70, -120, 5), rad: [3, 0.8, 3], freq: [0.25, 0.45, 0.3], spread: [6, 2, 5], len: 0.3, scale: [1.0, 1.7], wag: 14 },
  { geo: 'fish_chromlet', id: 'chromlet', n: 70, home: above(-120, -190, 5), rad: [3, 0.8, 3], freq: [0.3, 0.42, 0.24], spread: [5, 2, 6], len: 0.3, scale: [1.0, 1.7], wag: 14 },
  { geo: 'fish_parrot', id: 'parrot', n: 7, home: above(40, -140, 3.5), rad: [30, 1.2, 36], freq: [0.05, 0.11, 0.06], spread: [10, 1.5, 10], len: 1.0, scale: [0.9, 1.4], wag: 5, lag: 6 },
  { geo: 'fish_parrot', id: 'parrot', n: 6, home: above(-70, -80, 3.5), rad: [26, 1.2, 24], freq: [0.06, 0.1, 0.05], spread: [9, 1.5, 9], len: 1.0, scale: [0.9, 1.4], wag: 5, lag: 6 },
  { geo: 'fish_runner', id: 'runner', n: 60, home: above(60, -290, 14), rad: [60, 5, 30], freq: [0.11, 0.17, 0.14], spread: [6, 2.5, 6], len: 0.9, scale: [0.9, 1.3], wag: 9 },
  { geo: 'fish_runner', id: 'runner', n: 50, home: above(-150, -330, 12), rad: [40, 4, 40], freq: [0.13, 0.15, 0.1], spread: [6, 2.5, 6], len: 0.9, scale: [0.9, 1.3], wag: 9 },
  { geo: 'fish_darter', id: 'darter', n: 520, mode: 1, home: above(40, -380, 14), rad: [9, 7, 6], freq: [0.5, 0, 0], len: 0.42, scale: [1.0, 1.5] },
  { geo: 'fish_runner', id: 'runner', n: 170, mode: 1, home: above(SITES.wreck.x + 4, SITES.wreck.z, 24), rad: [16, 5, 5], freq: [0.22, 0, 0], len: 0.9, scale: [0.9, 1.2], wag: 8 },
  { geo: 'fish_minnow', id: 'minnow', n: 220, home: above(-60, -640, 12), rad: [50, 6, 40], freq: [0.07, 0.12, 0.09], spread: [8, 3, 8], len: 0.36, scale: [1.2, 1.9], emis: 3.2 },
  { geo: 'fish_minnow', id: 'minnow', n: 200, home: above(120, -720, 14), rad: [45, 6, 45], freq: [0.08, 0.1, 0.07], spread: [8, 3, 8], len: 0.36, scale: [1.2, 1.9], emis: 3.2 },
  { geo: 'fish_minnow', id: 'minnow', n: 180, home: above(30, -500, 20), rad: [10, 20, 30], freq: [0.09, 0.07, 0.08], spread: [5, 4, 5], len: 0.36, scale: [1.2, 1.9], emis: 3.2 },
  { geo: 'fish_minnow', id: 'minnow', n: 420, mode: 1, home: above(SITES.choir.x, SITES.choir.z, 16), rad: [20, 8, 3], freq: [0.2, 0, 0], len: 0.36, scale: [1.2, 1.9], emis: 3.2 },
];

function buildSchool(scene, assets, cfg, seed) {
  const rng = mulberry32(seed);
  const base = assets.geo[cfg.geo];
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('normal', base.getAttribute('normal'));
  g.setAttribute('aColor', base.getAttribute('aColor'));
  const off = new Float32Array(cfg.n * 4);
  const parm = new Float32Array(cfg.n * 4);
  const mode = cfg.mode ?? 0;
  for (let i = 0; i < cfg.n; i++) {
    if (mode === 0) {
      // Gaussian-ish blob so the school has a dense core.
      const gx = rng() + rng() + rng() - 1.5;
      const gy = rng() + rng() + rng() - 1.5;
      const gz = rng() + rng() + rng() - 1.5;
      off.set([gx * cfg.spread[0], gy * cfg.spread[1], gz * cfg.spread[2], rng() * 6.283], i * 4);
      parm.set([0.85 + rng() * 0.3, cfg.scale[0] + rng() * (cfg.scale[1] - cfg.scale[0]), rng() * (cfg.lag ?? 1.2), rng()], i * 4);
    } else {
      const r = cfg.rad[0] * (0.25 + 0.75 * Math.sqrt(rng()));
      off.set([r, (rng() - 0.5) * 2 * cfg.rad[1], 0, rng() * 6.283], i * 4);
      parm.set([0.85 + rng() * 0.3, cfg.scale[0] + rng() * (cfg.scale[1] - cfg.scale[0]), 0, rng()], i * 4);
    }
  }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.setAttribute('aParm', new THREE.InstancedBufferAttribute(parm, 4));
  g.instanceCount = cfg.n;
  const home = new THREE.Vector3(...cfg.home);
  const reach = mode === 0 ? Math.max(...cfg.rad) + Math.max(...cfg.spread) * 2 : cfg.rad[0] * 1.2 + cfg.rad[2];
  g.boundingSphere = new THREE.Sphere(home, reach + 8);
  const ph = new THREE.Vector3(rng() * 6.283, rng() * 6.283, rng() * 6.283);
  const mat = propMaterial({
    vert: S.schoolVert, gloss: 0.7, detail: 0.0, emis: cfg.emis ?? 0,
    uniforms: {
      uHome: { value: home }, uRad: { value: new THREE.Vector3(...cfg.rad) }, uFreq: { value: new THREE.Vector3(...cfg.freq) },
      uPh: { value: ph }, uMode: { value: mode }, uLen: { value: cfg.len }, uWag: { value: cfg.wag ?? 11 },
    },
  });
  const mesh = new THREE.Mesh(g, mat);
  scene.add(mesh);
  // The same path the shader follows, so discovery checks know where the school is.
  const center = (t, out) => {
    if (mode === 0) {
      return out.set(home.x + Math.sin(t * cfg.freq[0] + ph.x) * cfg.rad[0], home.y + Math.sin(t * cfg.freq[1] + ph.y) * cfg.rad[1],
        home.z + Math.cos(t * cfg.freq[2] + ph.z) * cfg.rad[2]);
    }
    return out.set(home.x + Math.sin(t * 0.07 + ph.x) * cfg.rad[2], home.y, home.z + Math.cos(t * 0.06 + ph.z) * cfg.rad[2]);
  };
  return { id: cfg.id, center, radius: mode === 0 ? Math.max(...cfg.spread) + 6 : cfg.rad[0] + 6, pos: new THREE.Vector3() };
}

function creatureMaterial(anim, len, amp, bodyHalf, o = {}) {
  return propMaterial({
    vert: S.creatureVert, gloss: o.gloss ?? 0.45, detail: o.detail ?? 0.12, emis: o.emis ?? 0,
    uniforms: { uAnim: { value: anim }, uPhase: { value: 0 }, uLen: { value: len }, uAmp: { value: amp }, uBodyHalf: { value: bodyHalf } },
  });
}

// Creatures swim closed loops: an ellipse with a vertical bob. Models face +X.
const CREATURES = [
  { geo: 'turtle', id: 'turtle', anim: 2, len: 2.0, amp: 0.2, half: 0.42, scale: 1.5, c: [-20, -90], r: [38, 26], h: 5, bob: 2, speed: 1.3, beat: 2.0 },
  { geo: 'turtle', id: 'turtle', anim: 2, len: 2.0, amp: 0.2, half: 0.42, scale: 1.2, c: [100, -150], r: [30, 40], h: 6, bob: 2.5, speed: 1.1, beat: 2.2, dir: -1 },
  { geo: 'turtle', id: 'turtle', anim: 2, len: 2.0, amp: 0.2, half: 0.42, scale: 1.7, c: [-110, -250], r: [36, 24], h: 12, bob: 3, speed: 1.2, beat: 1.8 },
  { geo: 'shark', id: 'shark', anim: 1, len: 3.0, amp: 0.045, half: 0, scale: 1.25, c: [-100, -400], r: [52, 38], h: 12, bob: 3, speed: 3.0, beat: 3.2 },
  { geo: 'shark', id: 'shark', anim: 1, len: 3.0, amp: 0.045, half: 0, scale: 1.0, c: [90, -410], r: [60, 30], h: 9, bob: 3, speed: 2.6, beat: 3.4, dir: -1 },
  { geo: 'manta', id: 'manta', anim: 2, len: 5.2, amp: 0.2, half: 0.25, scale: 1.5, c: [-112, -402], r: [34, 30], h: 26, bob: 5, speed: 2.4, beat: 1.25 },
  { geo: 'manta', id: 'manta', anim: 2, len: 5.2, amp: 0.2, half: 0.25, scale: 1.2, c: [-100, -410], r: [46, 40], h: 34, bob: 6, speed: 2.2, beat: 1.35, phase: 2.5 },
  { geo: 'manta', id: 'manta', anim: 2, len: 5.2, amp: 0.2, half: 0.25, scale: 1.7, c: [120, -470], r: [50, 26], h: 30, bob: 6, speed: 2.5, beat: 1.15, dir: -1 },
  { geo: 'angler', id: 'angler', anim: 1, len: 1.2, amp: 0.03, half: 0, scale: 2.2, c: [-90, -660], r: [26, 34], h: 7, bob: 3, speed: 0.7, beat: 1.4, emis: 3.5, lure: true },
  { geo: 'angler', id: 'angler', anim: 1, len: 1.2, amp: 0.03, half: 0, scale: 1.8, c: [70, -590], r: [30, 22], h: 9, bob: 4, speed: 0.6, beat: 1.5, emis: 3.5, lure: true, dir: -1 },
  { geo: 'angler', id: 'angler', anim: 1, len: 1.2, amp: 0.03, half: 0, scale: 2.6, c: [150, -770], r: [28, 28], h: 8, bob: 3, speed: 0.65, beat: 1.3, emis: 3.5, lure: true },
];

function buildJellies(scene, assets) {
  const rng = mulberry32(99);
  const base = assets.geo.jelly;
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('normal', base.getAttribute('normal'));
  g.setAttribute('aColor', base.getAttribute('aColor'));
  const spots = [];
  const add = (x, y, z, scale) => spots.push([x, y, z, rng() * 6.283, scale, rng(), 1 + rng() * 3]);
  for (let i = 0; i < 230; i++) {
    const s = GORGE.s0 + 10 + rng() * (GORGE.s1 - GORGE.s0 - 5);
    const x = GORGE.x + 16 * Math.sin(s * 0.021) + (rng() + rng() - 1) * 24;
    const floor = heightAt(x, -s);
    add(x, floor + 3 + rng() * rng() * 60, -s, 0.7 + rng() * rng() * 2.4);
  }
  for (let i = 0; i < 70; i++) {
    const x = (rng() - 0.5) * 420;
    const z = -470 - rng() * 110;
    add(x, Math.min(heightAt(x, z) + 6 + rng() * 40, -60), z, 0.8 + rng() * 1.6);
  }
  for (let i = 0; i < 40; i++) {
    const a = rng() * 6.283;
    const r = 20 + rng() * 60;
    add(SITES.choir.x + Math.cos(a) * r, heightAt(SITES.choir.x, SITES.choir.z) + 10 + rng() * 40, SITES.choir.z + Math.sin(a) * r, 1 + rng() * 2.5);
  }
  const off = new Float32Array(spots.length * 4);
  const parm = new Float32Array(spots.length * 4);
  spots.forEach((s, i) => {
    off.set([s[0], s[1], s[2], s[3]], i * 4);
    parm.set([s[4], s[5], s[6], 0], i * 4);
  });
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.setAttribute('aParm', new THREE.InstancedBufferAttribute(parm, 4));
  g.instanceCount = spots.length;
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    vertexShader: S.jellyVert, fragmentShader: S.jellyFrag, uniforms: shared(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  scene.add(mesh);
  return spots.filter((_, i) => i % 3 === 0).map((s) => new THREE.Vector3(s[0], s[1], s[2]));
}

export function buildLife(scene, assets, world) {
  const schools = SCHOOLS.map((cfg, i) => buildSchool(scene, assets, cfg, 100 + i));
  const jellySpots = buildJellies(scene, assets);
  const lureLocal = new THREE.Vector3(0.94, 0.56, 0);

  const creatures = CREATURES.map((cfg, i) => {
    const mat = creatureMaterial(cfg.anim, cfg.len, cfg.amp, cfg.half, { emis: cfg.emis });
    const mesh = new THREE.Mesh(assets.geo[cfg.geo], mat);
    mesh.scale.setScalar(cfg.scale);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    const glow = cfg.lure ? { pos: new THREE.Vector3(), color: new THREE.Color(0.55, 1.0, 0.9), radius: 9, power: 1.3 } : null;
    if (glow) world.glows.push(glow);
    // Fly the loop at a fixed height that clears the highest ground under it, so nothing swims through the seabed.
    let top = -Infinity;
    for (let a = 0; a < 96; a++) {
      const ang = (a / 96) * Math.PI * 2;
      top = Math.max(top, heightAt(cfg.c[0] + Math.cos(ang) * cfg.r[0], cfg.c[1] + Math.sin(ang) * cfg.r[1]));
    }
    cfg.base = Math.min(top + cfg.h, -3 - cfg.bob);
    return { cfg, mesh, mat, angle: (cfg.phase ?? i * 1.7), glow, pos: new THREE.Vector3() };
  });

  // The Singer: hidden until the seventh bell.
  const whaleMat = creatureMaterial(3, 24, 0.035, 2.2, { emis: 0, gloss: 0.3, detail: 0.2 });
  const whale = new THREE.Mesh(assets.geo.whale, whaleMat);
  whale.matrixAutoUpdate = false;
  whale.frustumCulled = false;
  whale.visible = false;
  scene.add(whale);
  const whaleState = { active: false, t: 0, pos: new THREE.Vector3(), glow: { pos: new THREE.Vector3(), color: new THREE.Color(0.4, 1.0, 0.9), radius: 40, power: 0 } };
  world.glows.push(whaleState.glow);

  const f = new THREE.Vector3();
  const u = new THREE.Vector3();
  const r = new THREE.Vector3();
  const next = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const scaleV = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  // Orient a +X-forward model along its direction of travel with some bank into the turn.
  function pose(mesh, pos, ahead, scale, bank) {
    f.copy(ahead).sub(pos).normalize();
    r.crossVectors(f, UP).normalize();
    u.crossVectors(r, f);
    u.addScaledVector(r, bank).normalize();
    r.crossVectors(f, u);
    basis.makeBasis(f, u, r);
    mesh.matrix.copy(basis).scale(scaleV.setScalar(scale)).setPosition(pos);
    mesh.matrixWorld.copy(mesh.matrix);
  }
  const loop = (cfg, a, out) => {
    const x = cfg.c[0] + Math.cos(a) * cfg.r[0];
    const z = cfg.c[1] + Math.sin(a) * cfg.r[1];
    return out.set(x, cfg.base + Math.sin(a * 2.0 + cfg.c[0]) * cfg.bob, z);
  };
  const whalePath = (t, out) => {
    const c = SITES.choir;
    // Descends in a wide spiral from above, then circles the choir.
    const settle = Math.min(t / 50, 1);
    const ease = settle * settle * (3 - 2 * settle);
    const rad = 150 - 88 * ease;
    const a = 2.2 + t * 0.045;
    return out.set(c.x + Math.cos(a) * rad, heightAt(c.x, c.z) + 95 - 68 * ease + Math.sin(t * 0.11) * 5, c.z + Math.sin(a) * rad * 0.8);
  };

  return {
    whale: whaleState,
    startFinale() {
      whaleState.active = true;
      whaleState.t = 0;
      whale.visible = true;
    },
    update(dt, time) {
      for (const c of creatures) {
        const cfg = c.cfg;
        const circ = Math.PI * (cfg.r[0] + cfg.r[1]);
        c.angle += ((cfg.dir ?? 1) * cfg.speed * dt * 2 * Math.PI) / circ;
        loop(cfg, c.angle, c.pos);
        loop(cfg, c.angle + (cfg.dir ?? 1) * 0.05, next);
        pose(c.mesh, c.pos, next, cfg.scale, (cfg.dir ?? 1) * 0.25);
        c.mat.uniforms.uPhase.value = time * cfg.beat + c.angle;
        if (c.glow) c.glow.pos.copy(lureLocal).applyMatrix4(c.mesh.matrix);
      }
      if (whaleState.active) {
        whaleState.t += dt;
        whalePath(whaleState.t, whaleState.pos);
        whalePath(whaleState.t + 0.5, next);
        pose(whale, whaleState.pos, next, 1.0, 0.12);
        whaleMat.uniforms.uPhase.value = time * 0.75;
        whaleMat.uniforms.uEmis.value = Math.min(whaleState.t / 12, 1) * 1.3;
        whaleState.glow.pos.copy(whaleState.pos);
        whaleState.glow.power = Math.min(whaleState.t / 12, 1) * 0.5;
      }
      for (const s of schools) s.center(time, s.pos);
    },
    // Things the player can log: [{ id, pos, radius }]
    targets(out) {
      out.length = 0;
      for (const s of schools) out.push({ id: s.id, pos: s.pos, radius: s.radius + 6 });
      for (const c of creatures) out.push({ id: c.cfg.id, pos: c.pos, radius: 16 });
      for (const p of jellySpots) out.push({ id: 'jelly', pos: p, radius: 9 });
      if (whaleState.active && whaleState.t > 8) out.push({ id: 'whale', pos: whaleState.pos, radius: 80 });
      return out;
    },
  };
}
