// Tidebell: entry point and game loop.
import * as THREE from 'three';
import { createGfx, U } from './gfx.js';
import { loadAssets } from './assets.js';
import { buildWorld } from './world.js';
import { buildLife } from './life.js';
import { buildFx } from './fx.js';
import { createPlayer } from './player.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { heightAt, normalAt, zoneAt, ZONES, SITES } from './terrain.js';
import { createGame, awaken, discover, depthLimit, serialize, SPECIES, BELL_COUNT } from './game.js';
import { NUM_GLOW } from './shaders.js';

const SAVE_KEY = 'tidebell.save.v1';
const loadSave = () => {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const store = (g) => {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(g)));
  } catch {
    /* storage unavailable: progress simply lasts for this session */
  }
};

async function boot() {
  const canvas = document.getElementById('view');
  const gfx = createGfx(canvas);
  const assets = await loadAssets();
  const world = buildWorld(gfx.scene, assets);
  const life = buildLife(gfx.scene, assets, world);
  const fx = buildFx(gfx.scene, world);
  const player = createPlayer(gfx.scene, assets, gfx.camera, canvas, fx);
  const hud = createHud();
  const audio = createAudio();
  const game = createGame(loadSave());

  const env = { heightAt, normalAt, colliders: world.colliders, depthLimit: depthLimit(game) };
  for (const b of world.bells) {
    b.awake = game.bells.has(b.index);
    b.energy = b.awake ? 1 : 0;
  }
  hud.bells(game.bells);
  hud.rating(env.depthLimit);
  if (game.finale) life.startFinale();

  let mode = 'title';
  let time = 0;
  let zone = '';
  let hold = 0;
  let sonarR = 0;
  let sonarFresh = 0;
  let scanClock = 0;
  let logOpen = false;
  let lampAuto = true;
  let creakClock = 0;
  let glowTarget = game.finale ? 2.2 : 1;
  let flash = 0;
  let fade = 0;
  let slow = 0;
  let quality = 1;
  const targets = [];
  const subPos = player.position;

  function logSpecies(id) {
    if (!discover(game, id)) return;
    hud.toast(`Logged · ${game.log.size} of ${Object.keys(SPECIES).length}`, SPECIES[id].name, SPECIES[id].note);
    if (logOpen) hud.logbook(true, game.log);
    audio.log();
    store(game);
  }

  function wake(bell) {
    const events = awaken(game, bell.index);
    for (const ev of events) {
      if (ev.type === 'bell') {
        bell.awake = true;
        flash = 1;
        gfx.post.uFlashCol.value.set(bell.glow.color.r, bell.glow.color.g, bell.glow.color.b);
        audio.bell(bell.index, ev.count);
        hud.bells(game.bells);
        hud.story(ev.line);
        U.uSonar.value.set(bell.pos.x, bell.pos.y, bell.pos.z, 0.01);
        sonarR = 0.01;
      } else if (ev.type === 'rating') {
        env.depthLimit = ev.limit;
        hud.rating(ev.limit);
        setTimeout(() => hud.toast('Hull retuned', Number.isFinite(ev.limit) ? `Rated to ${ev.limit} m` : 'Rated for any depth', 'The bells have taught the hull to bear more of the sea.'), 2500);
      } else if (ev.type === 'finale') {
        setTimeout(() => {
          life.startFinale();
          audio.whaleSong();
          glowTarget = 2.2;
        }, 5000);
        setTimeout(() => hud.finale(), 16000);
      }
    }
    store(game);
  }

  hud.onStart(() => {
    if (mode !== 'title') return;
    mode = 'play';
    audio.start();
    hud.begin();
    player.setEnabled(true);
    canvas.requestPointerLock?.()?.catch?.(() => {});
    setTimeout(() => hud.story('Seven bells sleep beneath this bay. The nearest is just ahead — follow its light.', 8000), 5200);
  });

  const order = [];
  function updateGlows(camPos) {
    order.length = 0;
    for (const g of world.glows) if (g.power > 0.001) order.push(g);
    for (const g of order) g._d = g.pos.distanceToSquared(camPos) / (g.radius * g.radius);
    order.sort((a, b) => a._d - b._d);
    for (let i = 0; i < NUM_GLOW; i++) {
      const g = order[i];
      if (g) {
        U.uGlowPos.value[i].set(g.pos.x, g.pos.y, g.pos.z, g.radius);
        U.uGlowCol.value[i].set(g.color.r * g.power, g.color.g * g.power, g.color.b * g.power);
      } else {
        U.uGlowPos.value[i].set(0, -9999, 0, 1);
        U.uGlowCol.value[i].set(0, 0, 0);
      }
    }
  }

  function frame(dt) {
    time += dt;
    U.uTime.value = time;
    const st = player.update(dt, env, time);
    const depth = -player.sub.pos[1];
    // A scripted camera (used by the promo renderer) replaces the chase camera for this frame.
    const cine = window.__tb?.cine;
    if (cine) {
      gfx.camera.position.set(cine.pos[0], Math.min(cine.pos[1], -0.5), cine.pos[2]);
      gfx.camera.lookAt(cine.look[0], cine.look[1], cine.look[2]);
      gfx.camera.updateMatrixWorld();
    }

    if (mode === 'play') {
      if (player.took('KeyM')) hud.toast('Sound', audio.toggleMute() ? 'Muted' : 'On');
      if (player.took('KeyH')) hud.toggleHidden();
      if (player.took('Tab')) {
        logOpen = !logOpen;
        hud.logbook(logOpen, game.log);
        // The logbook covers the view, so the sub holds still and the cursor is released while it is open.
        player.setInputLocked(logOpen);
        if (logOpen) document.exitPointerLock?.();
      }
      if (!logOpen && player.took('KeyF')) {
        lampAuto = false;
        player.setLamp(!player.lamp);
        audio.lamp();
      }
      if (lampAuto && !player.lamp && depth > 42) {
        player.setLamp(true);
        audio.lamp();
        hud.toast('Lamps', 'Headlamps on', 'The colour comes back wherever you point them. F to toggle.');
      }
      if (!logOpen && player.took('KeyQ') && sonarR <= 0) {
        sonarR = 0.01;
        U.uSonar.value.set(subPos.x, subPos.y, subPos.z, sonarR);
        sonarFresh = 14;
        audio.sonar();
      }

      // Bells: hold E nearby to wake one.
      let near = null;
      if (!logOpen) for (const b of world.bells) if (!b.awake && b.pos.distanceTo(subPos) < 11) near = b;
      if (near) {
        hold = player.held('KeyE') ? hold + dt / 1.5 : Math.max(0, hold - dt * 2);
        hud.prompt('E', 'Hold to wake the bell', Math.min(hold, 1));
        if (hold >= 1) {
          hold = 0;
          wake(near);
        }
      } else {
        hold = 0;
        hud.prompt('', '');
      }

      // Logbook sightings, a few times a second.
      scanClock -= dt;
      if (scanClock <= 0) {
        scanClock = 0.35;
        for (const t of life.targets(targets)) if (t.pos.distanceToSquared(subPos) < t.radius * t.radius) logSpecies(t.id);
        for (const [type, id] of [['kelp', 'kelp'], ['lantern_stalk', 'lantern'], ['tube_worms', 'worms']]) {
          if (game.log.has(id)) continue;
          for (const p of world.samples[type] ?? []) {
            if (p.distanceToSquared(subPos) < 100) {
              logSpecies(id);
              break;
            }
          }
        }
        if (Math.hypot(subPos.x - SITES.whaleFall.x, subPos.z - SITES.whaleFall.z) < 22 && depth > 150) logSpecies('whalefall');
        const z = zoneAt(subPos.x, subPos.y, subPos.z);
        if (z !== zone) {
          zone = z;
          hud.zone(ZONES[z]);
        }
      }

      if (st.over > 0.5) {
        creakClock -= dt;
        if (creakClock <= 0) {
          creakClock = 1.6 + Math.random() * 1.5;
          audio.creak();
        }
      }
      hud.depth(depth, env.depthLimit, st.over);
      sonarFresh = Math.max(0, sonarFresh - dt);
      hud.markers(world.bells, gfx.camera, sonarFresh > 0, subPos);
      audio.update({ depth, thrust: st.thrust, boost: st.boost, pressure: Math.min(1, st.over / 6) });
    }

    // Sonar ring.
    if (sonarR > 0) {
      sonarR += dt * 58;
      U.uSonar.value.w = sonarR;
      if (sonarR > 170) {
        sonarR = 0;
        U.uSonar.value.w = 0;
      }
    }

    // Bells glow up once awake.
    for (const b of world.bells) {
      b.energy += ((b.awake ? 1 : 0) - b.energy) * (1 - Math.exp(-1.2 * dt));
      const pulse = 0.85 + 0.15 * Math.sin(time * 1.7 + b.index);
      b.mat.uniforms.uEmis.value = 0.3 + b.energy * 4.2 * pulse;
      b.pillarMat.uniforms.uPower.value = 0.07 + b.energy * 0.42 * pulse;
      b.glow.power = 0.25 + b.energy * 1.5 * pulse;
      b.glow.radius = 9 + b.energy * 17;
    }

    U.uGlobalGlow.value += (glowTarget - U.uGlobalGlow.value) * (1 - Math.exp(-0.25 * dt));
    world.cull(gfx.camera.position);
    life.update(dt, time);
    fx.update(dt, time);
    updateGlows(gfx.camera.position);

    // Eye adaptation, pressure and transitions.
    const camDepth = -gfx.camera.position.y;
    const targetExp = 0.8 + 1.6 * Math.min(1, Math.max(0, (camDepth - 15) / 150));
    gfx.post.uExposure.value += (targetExp - gfx.post.uExposure.value) * (1 - Math.exp(-0.8 * dt));
    gfx.post.uPressure.value += (Math.min(1, st.over / 7) - gfx.post.uPressure.value) * (1 - Math.exp(-3 * dt));
    flash *= Math.exp(-1.6 * dt);
    gfx.post.uFlash.value = flash;
    fade = Math.min(1, fade + dt * 0.6);
    gfx.post.uFade.value = fade;
    gfx.render();
    player.endFrame();
  }

  let last = performance.now();
  function tick(now) {
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(raw, 0.05);
    if (!window.__tb.paused) frame(dt);
    // Drop resolution if the machine cannot keep up.
    // Stalls (a backgrounded tab, shader compilation) say nothing about the machine's speed: ignore them.
    if (raw < 0.25) slow = raw > 0.03 ? slow + raw : Math.max(0, slow - raw * 0.5);
    if (slow > 3 && quality > 0.61) {
      quality = Math.round((quality - 0.2) * 10) / 10;
      gfx.setQuality(quality);
      slow = 0;
    }
    requestAnimationFrame(tick);
  }

  // Hooks for automated acceptance tests and photo capture.
  window.__tb = {
    game, world, player, life, gfx, U, heightAt,
    paused: false,
    cine: null,
    get mode() {
      return mode;
    },
    get zone() {
      return zone;
    },
    teleport: (x, y, z, yaw = 0, pitch = 0) => {
      player.teleport(x, y ?? heightAt(x, z) + 4, z);
      player.look.yaw = yaw;
      player.look.pitch = pitch;
    },
    gotoBell: (i) => {
      const b = world.bells[i];
      player.teleport(b.pos.x + 6, b.pos.y + 2, b.pos.z + 6);
      player.look.yaw = Math.PI / 4;
      player.look.pitch = -0.1;
    },
    wake: (i) => wake(world.bells[i]),
    step: (n = 1, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) frame(dt);
    },
    reset: () => {
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    },
    BELL_COUNT,
  };

  frame(1 / 60);
  last = performance.now();
  hud.ready();
  requestAnimationFrame(tick);
}

boot().catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (!l) return;
  const head = document.createElement('div');
  head.className = 'caps';
  head.textContent = 'could not start';
  const body = document.createElement('div');
  body.style.cssText = 'max-width:560px;text-align:center;opacity:.7;font-size:13px';
  body.textContent = String(err.message ?? err);
  l.replaceChildren(head, body);
});
