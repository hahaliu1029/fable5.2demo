// The Wisp: the player's submersible, its controls, lamps and the chase camera.
import * as THREE from 'three';
import { stepSub, resolveSphere } from './physics.js';
import { shared, U } from './gfx.js';
import { propMaterial } from './world.js';
import { b2t } from './assets.js';
import { SITES } from './terrain.js';
import * as S from './shaders.js';

const UP = new THREE.Vector3(0, 1, 0);

export function createPlayer(scene, assets, camera, canvas, fx) {
  const group = new THREE.Group();
  const rigid = { uAnim: { value: 0 }, uPhase: { value: 0 }, uLen: { value: 1 }, uAmp: { value: 0 }, uBodyHalf: { value: 0 } };
  const hullMat = propMaterial({ vert: S.creatureVert, gloss: 0.8, detail: 0.04, emis: 2.2, uniforms: { ...rigid } });
  group.add(new THREE.Mesh(assets.geo.sub_hull, hullMat));
  const glass = new THREE.Mesh(assets.geo.sub_glass, new THREE.ShaderMaterial({
    vertexShader: S.creatureVert, fragmentShader: S.glassFrag, uniforms: shared({ ...rigid }), transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  glass.renderOrder = 2;
  group.add(glass);
  const props = assets.meta.sub_hull.props.map((p) => {
    const m = new THREE.Mesh(assets.geo.sub_prop, hullMat);
    m.position.set(...b2t(p));
    group.add(m);
    return m;
  });
  const lampLocal = assets.meta.sub_hull.lamps.map((p) => new THREE.Vector3(...b2t(p)));
  const coneGeo = new THREE.CylinderGeometry(7.5, 0.12, 34, 64, 8, true);
  coneGeo.translate(0, 17, 0);
  coneGeo.rotateZ(-Math.PI / 2);
  const coneMat = new THREE.ShaderMaterial({
    vertexShader: S.beamVert, fragmentShader: S.beamFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: shared({ uColor: { value: new THREE.Color(1.0, 0.93, 0.78) }, uPower: { value: 0 }, uFalloff: { value: 2.6 } }),
  });
  for (const p of lampLocal) {
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(p);
    cone.rotation.z = -0.06;
    cone.renderOrder = 8;
    cone.frustumCulled = false;
    group.add(cone);
  }
  group.traverse((o) => {
    o.frustumCulled = false;
  });
  scene.add(group);

  const sub = { pos: [SITES.spawn.x, -8, SITES.spawn.z], vel: [0, 0, 0] };
  const look = { yaw: 0, pitch: -0.05 };
  const facing = { yaw: 0, pitch: 0, roll: 0 };
  const keys = new Set();
  const pressed = new Set();
  let lampOn = false;
  let lampLevel = 0;
  let enabled = false;
  let locked = false; // input ignored (logbook open) without leaving play mode
  let dragging = false;
  let bubbleAcc = 0;
  let titleAngle = 0.6;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    // macOS swallows keyup for keys released while Cmd is down, which would leave them stuck.
    if (e.key === 'Meta') keys.clear();
  });
  window.addEventListener('blur', () => keys.clear());
  const turn = (dx, dy) => {
    look.yaw -= dx * 0.0023;
    look.pitch = Math.max(-1.35, Math.min(1.35, look.pitch - dy * 0.0023));
  };
  canvas.addEventListener('mousedown', () => {
    dragging = true;
    if (enabled && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
  });
  window.addEventListener('mouseup', () => (dragging = false));
  window.addEventListener('mousemove', (e) => {
    if (!enabled || locked) return;
    if (document.pointerLockElement === canvas || dragging) turn(e.movementX, e.movementY);
  });

  const lookDir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const camGoal = new THREE.Vector3();
  const camPos = [0, 0, 0];
  const target = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const tmp = new THREE.Vector3();
  const position = new THREE.Vector3(...sub.pos);
  const input = { thrust: [0, 0, 0], boost: false };
  let first = true;

  function update(dt, env, time) {
    const k = (a, b) => (!locked && (keys.has(a) || keys.has(b)) ? 1 : 0);
    if (enabled) {
      const rate = 1.5 * dt;
      look.yaw += (k('ArrowLeft') - k('ArrowRight')) * rate;
      look.pitch = Math.max(-1.35, Math.min(1.35, look.pitch + (k('ArrowUp') - k('ArrowDown')) * rate));
    } else {
      titleAngle += dt * 0.05;
    }
    lookDir.set(-Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), -Math.cos(look.yaw) * Math.cos(look.pitch));
    right.crossVectors(lookDir, UP).normalize();
    const f = enabled ? k('KeyW') - k('KeyS') : 0;
    const s = enabled ? k('KeyD') - k('KeyA') : 0;
    const v = enabled ? k('Space') - k('KeyC', 'KeyX') : 0;
    tmp.set(0, 0, 0).addScaledVector(lookDir, f).addScaledVector(right, s).addScaledVector(UP, v);
    if (tmp.lengthSq() > 1) tmp.normalize();
    input.thrust[0] = tmp.x;
    input.thrust[1] = tmp.y;
    input.thrust[2] = tmp.z;
    input.boost = enabled && k('ShiftLeft', 'ShiftRight') === 1;
    const res = stepSub(sub, input, dt, env);
    position.set(sub.pos[0], sub.pos[1], sub.pos[2]);
    const speed = Math.hypot(sub.vel[0], sub.vel[1], sub.vel[2]);

    // The hull eases round to face where the pilot is looking, banking into turns.
    const ease = 1 - Math.exp(-3.2 * dt);
    let dy = look.yaw - facing.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    facing.yaw += dy * ease;
    facing.pitch += (look.pitch * 0.75 - facing.pitch) * ease;
    facing.roll += (Math.max(-0.6, Math.min(0.6, -dy * 1.4 - s * 0.25)) - facing.roll) * (1 - Math.exp(-4 * dt));
    fwd.set(-Math.sin(facing.yaw) * Math.cos(facing.pitch), Math.sin(facing.pitch), -Math.cos(facing.yaw) * Math.cos(facing.pitch));
    const r = tmp.crossVectors(fwd, UP).normalize().clone();
    const u = new THREE.Vector3().crossVectors(r, fwd);
    u.applyAxisAngle(fwd, facing.roll);
    r.crossVectors(fwd, u);
    basis.makeBasis(fwd, u, r);
    group.quaternion.setFromRotationMatrix(basis);
    group.position.copy(position);
    group.position.y += Math.sin(time * 0.9) * 0.06;
    group.updateMatrixWorld(true);
    for (const p of props) p.rotation.x += (4 + speed * 3.5) * dt;

    // Lamps.
    lampLevel += ((lampOn ? 1 : 0) - lampLevel) * (1 - Math.exp(-6 * dt));
    U.uLampOn.value = lampLevel;
    U.uLampDir.value.copy(fwd).addScaledVector(UP, -0.06).normalize();
    lampLocal.forEach((p, i) => U.uLampPos.value[i].copy(p).applyMatrix4(group.matrixWorld));
    const depth = -sub.pos[1];
    coneMat.uniforms.uPower.value = lampLevel * (0.02 + 0.09 * Math.min(1, Math.max(0, (depth - 8) / 80)));
    U.uSubPos.value.copy(position);

    // Prop wash.
    bubbleAcc += dt * (f !== 0 || s !== 0 || v !== 0 ? 14 + speed * 2.2 : 1.2);
    while (bubbleAcc > 1) {
      bubbleAcc -= 1;
      const p = props[Math.random() < 0.5 ? 0 : 1].getWorldPosition(tmp);
      fx.emitBubble(p, { x: -fwd.x * 2 + (Math.random() - 0.5), y: Math.random() * 0.5, z: -fwd.z * 2 + (Math.random() - 0.5) }, 0.03 + Math.random() * 0.07, 1.6 + Math.random() * 2);
    }

    // Camera.
    if (enabled) {
      camGoal.copy(position).addScaledVector(lookDir, -8.6).addScaledVector(UP, 2.1);
      target.copy(position).addScaledVector(lookDir, 5).addScaledVector(UP, 0.9);
    } else {
      camGoal.set(position.x + Math.cos(titleAngle) * 9.5, position.y + 1.3 + Math.sin(titleAngle * 0.7) * 0.6, position.z + Math.sin(titleAngle) * 9.5);
      target.copy(position).addScaledVector(UP, 0.4);
    }
    if (first) {
      camera.position.copy(camGoal);
      first = false;
    }
    camera.position.lerp(camGoal, 1 - Math.exp(-(enabled ? 9 : 2.5) * dt));
    camPos[0] = camera.position.x;
    camPos[1] = Math.min(camera.position.y, -0.5);
    camPos[2] = camera.position.z;
    resolveSphere(camPos, null, 0.8, env);
    camera.position.set(camPos[0], camPos[1], camPos[2]);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return { speed, over: res.over, hit: res.hit, thrust: Math.abs(f) + Math.abs(s) + Math.abs(v) > 0, boost: input.boost };
  }

  return {
    sub, position, look, update,
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = v;
      if (v) look.yaw = facing.yaw;
    },
    get lamp() {
      return lampOn;
    },
    setLamp(v) {
      lampOn = v;
    },
    setInputLocked(v) {
      locked = v;
    },
    // Consume a key press (edge-triggered).
    took(code) {
      const had = pressed.has(code);
      pressed.delete(code);
      return had;
    },
    held: (code) => keys.has(code),
    endFrame: () => pressed.clear(),
    teleport(x, y, z) {
      sub.pos[0] = x;
      sub.pos[1] = y;
      sub.pos[2] = z;
      sub.vel.fill(0);
      first = true;
    },
  };
}
