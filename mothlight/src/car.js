// Everything you see of the driving game: the player's car and its lights, the light gates, ground traffic.
import * as THREE from 'three';
import { modelGeometry } from './models.js';
import { carMaterial, glowMaterial, carEnv, U } from './shaders.js';
import { makeTraffic, trafficAt, ROADS } from './drive.js';
import { mulberry32 } from './rng.js';

const b2t = (p) => [p[0], p[2], -p[1]]; // Blender (Z-up) point -> three (Y-up)
const TRAIL_N = 28;

function ribbon(color, power) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(TRAIL_N * 6), uv = new Float32Array(TRAIL_N * 4), age = new Float32Array(TRAIL_N * 2), idx = [];
  for (let i = 0; i < TRAIL_N; i++) {
    uv.set([0, i / (TRAIL_N - 1), 1, i / (TRAIL_N - 1)], i * 4); age[i * 2] = age[i * 2 + 1] = i / (TRAIL_N - 1);
    if (i < TRAIL_N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aAge', new THREE.BufferAttribute(age, 1)); g.setIndex(idx);
  const m = new THREE.Mesh(g, glowMaterial(1, color, power));
  m.frustumCulled = false; m.renderOrder = 3;
  return { mesh: m, pos, hist: [] };
}

export function buildDrive(scene, route, models, meta) {

  // ---- the player's car
  const car = new THREE.Group();
  const bodyMat = carMaterial({ gloss: 1.0, emis: 3.4, paint: [0.0, 0.14, 0.22], paintB: [0.3, 0.015, 0.4] }); // teal face-on, violet at the edges
  car.add(new THREE.Mesh(modelGeometry(models.car_body), bodyMat));
  const wheelGeo = modelGeometry(models.car_wheel);
  const wheelMat = carMaterial({ gloss: 0.6, emis: 2.6, paint: [0.5, 0.52, 0.58] });
  const wheels = meta.car_body.wheels.map((w) => {
    const pivot = new THREE.Group(), spin = new THREE.Mesh(wheelGeo, wheelMat);
    pivot.position.set(...b2t(w)); pivot.add(spin); car.add(pivot);
    return { pivot, spin, front: w[1] > 0 };
  });
  // headlamp pool on the wet road, a neon glow under the sills, and a faint wash behind the brake lights
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(15, 30).rotateX(-Math.PI / 2).translate(0, 0.05, -17.2), glowMaterial(0, [1.0, 0.94, 0.8], 0.1));
  const under = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 7.4).rotateX(-Math.PI / 2).translate(0, 0.04, 0), glowMaterial(3, [1.0, 0.18, 0.6], 0.2));
  const brakeWash = new THREE.Mesh(new THREE.PlaneGeometry(7, 9).rotateX(-Math.PI / 2).rotateY(Math.PI).translate(0, 0.05, 6.6), glowMaterial(0, [1.0, 0.06, 0.1], 0.2));
  for (const m of [pool, under, brakeWash]) { m.renderOrder = 2; car.add(m); }
  // a soft contact shadow so the car sits on the road instead of floating over it
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g2 = cv.getContext('2d'), grad = g2.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.9)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.6)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = grad; g2.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 6.6).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
    shadow.renderOrder = 3; car.add(shadow);
  }
  car.traverse((o) => { o.frustumCulled = false; });
  scene.add(car);
  const trails = [ribbon([1.0, 0.05, 0.12], 1.6), ribbon([1.0, 0.05, 0.12], 1.6)];
  for (const t of trails) scene.add(t.mesh);

  // spray thrown up by the rear wheels
  const SPRAY = 420;
  const sp = Array.from({ length: SPRAY }, () => ({ life: 0, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0 }));
  const spPos = new Float32Array(SPRAY * 3), spA = new Float32Array(SPRAY);
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3).setUsage(THREE.DynamicDrawUsage));
  spGeo.setAttribute('aA', new THREE.BufferAttribute(spA, 1).setUsage(THREE.DynamicDrawUsage));
  const spray = new THREE.Points(spGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 600 } },
    vertexShader: /* glsl */ `attribute float aA; varying float vA; uniform float uScale;
      void main() { vA = aA; vec4 mv = viewMatrix * vec4(position, 1.0); gl_PointSize = clamp((0.05 + 0.16 * (1.0 - aA)) * uScale / max(-mv.z, 0.1), 1.0, 14.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `varying float vA; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.55, 0.7, 0.9) * smoothstep(1.0, 0.0, r) * vA * 0.22, 1.0); }`,
  }));
  spray.frustumCulled = false; spray.renderOrder = 3; scene.add(spray);
  let spNext = 0;

  // ---- light gates
  const gateGeo = modelGeometry(models.gate);
  const gates = route.gates.map((g) => {
    const grp = new THREE.Group();
    const mat = carMaterial({ gloss: 0.6, emis: 1.2 });
    const holo = new THREE.Mesh(new THREE.PlaneGeometry(14.2, 6.6).translate(0, 3.9, 0), glowMaterial(2, [0.2, 1, 1], 0.5));
    holo.renderOrder = 3;
    grp.add(new THREE.Mesh(gateGeo, mat), holo);
    grp.position.set(g.x, 0, g.z); grp.rotation.y = g.axis === 'x' ? Math.PI / 2 : 0;
    scene.add(grp);
    return { grp, mat, holo };
  });
  // finish ring in front of the Spire
  const finish = new THREE.Mesh(new THREE.RingGeometry(route.finish.r - 0.5, route.finish.r, 48).rotateX(-Math.PI / 2).translate(route.finish.x, 0.06, route.finish.z),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.5, 1.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  finish.visible = false; scene.add(finish);

  // ---- ground traffic: two instanced models, tinted per car
  const cars = makeTraffic(mulberry32(4711));
  const PAINT = [[0.55, 0.56, 0.6], [0.05, 0.14, 0.4], [0.4, 0.04, 0.06], [0.5, 0.36, 0.05], [0.04, 0.3, 0.25], [0.2, 0.08, 0.4], [0.03, 0.03, 0.04], [0.03, 0.03, 0.04]];
  const fleets = ['traffic_car', 'traffic_van'].map((name, v) => {
    const mine = cars.filter((c) => c.van === (v === 1));
    const mesh = new THREE.InstancedMesh(modelGeometry(models[name]), carMaterial({ gloss: 0.8, emis: 2.6 }), mine.length);
    const col = new THREE.Color();
    mine.forEach((c, i) => mesh.setColorAt(i, col.setRGB(...PAINT[Math.floor(c.hue * PAINT.length)])));
    mesh.frustumCulled = false; scene.add(mesh);
    return { mesh, mine };
  });
  // every traffic car throws headlamp light ahead and a red glow behind, onto the wet road
  const lampGeo = new THREE.PlaneGeometry(8, 15).rotateX(-Math.PI / 2).translate(0, 0.05, -9.8);
  const tailGeo = new THREE.PlaneGeometry(5, 6).rotateX(-Math.PI / 2).rotateY(Math.PI).translate(0, 0.05, 5.4);
  const lampPools = new THREE.InstancedMesh(lampGeo, glowMaterial(0, [1.0, 0.92, 0.75], 0.22), cars.length);
  const tailPools = new THREE.InstancedMesh(tailGeo, glowMaterial(0, [1.0, 0.05, 0.08], 0.2), cars.length);
  for (const m of [lampPools, tailPools]) { m.frustumCulled = false; m.renderOrder = 2; scene.add(m); }
  // signals on two corners of every junction, arms reaching over the road
  {
    const spots = [];
    for (let i = 1; i < ROADS.length - 1; i++) for (let j = 1; j < ROADS.length - 1; j++) {
      spots.push([ROADS[i] + 8.7, ROADS[j] + 8.7, 0], [ROADS[i] - 8.7, ROADS[j] - 8.7, Math.PI]);
    }
    const sig = new THREE.InstancedMesh(modelGeometry(models.signal), carMaterial({ gloss: 0.3, emis: 3.0, paint: [0.4, 0.42, 0.5] }), spots.length);
    const d = new THREE.Object3D();
    spots.forEach(([x, z, r], i) => { d.position.set(x, 0, z); d.rotation.set(0, r, 0); d.updateMatrix(); sig.setMatrixAt(i, d.matrix); });
    sig.frustumCulled = false; scene.add(sig);
  }
  const dummy = new THREE.Object3D(), tp = {}, corner = new THREE.Vector3();

  const envRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const envCam = new THREE.CubeCamera(0.6, 3200, envRT);
  carEnv.uEnv.value = envRT.texture;
  let envTick = 0;

  return {
    car, cars, bodyMat,
    // hide: objects that must not appear in the reflection (the car itself, the mirror ground)
    updateEnv(renderer, hide) {
      if (envTick++ % 3) return;
      envCam.position.set(car.position.x, 1.3, car.position.z);
      const was = hide.map((o) => o.visible);
      hide.forEach((o) => { o.visible = false; });
      // while the cube is the render target nothing may sample it (a feedback loop drops the draw)
      car.visible = false; carEnv.uEnvOn.value = 0; carEnv.uEnv.value = null;
      envCam.update(renderer, scene);
      car.visible = true; carEnv.uEnvOn.value = 1; carEnv.uEnv.value = envRT.texture;
      hide.forEach((o, i) => { o.visible = was[i]; });
    },
    setScale(h) { spray.material.uniforms.uScale.value = h; },
    // mode: 'next' (bright, beckoning), 'ahead' (dim), 'done' (dark)
    setGate(i, mode) {
      const g = gates[i], c = mode === 'next' ? [0.25, 1.0, 1.0] : mode === 'ahead' ? [1.0, 0.2, 0.6] : [0.2, 0.9, 0.4];
      g.mat.uniforms.uLamp.value.setRGB(...c);
      g.mat.uniforms.uEmis.value = mode === 'next' ? 4.2 : mode === 'ahead' ? 1.0 : 0.5;
      g.holo.material.uniforms.uColor.value.setRGB(...c);
      g.holo.material.uniforms.uPower.value = mode === 'next' ? 0.62 : mode === 'ahead' ? 0.16 : 0;
      g.holo.visible = mode !== 'done';
    },
    setFinish(on) { finish.visible = on; },
    resetTrails() { for (const tr of trails) tr.hist.length = 0; },
    // c: the simulated car; st: { steer, brake, boosting, slip }
    update(c, st, t, dt) {
      car.position.set(c.x, 0, c.z);
      const lean = Math.max(-0.07, Math.min(0.07, -c.slip * 0.006));
      car.rotation.set(Math.max(-0.035, Math.min(0.03, st.accel * 0.012)), c.yaw, lean, 'YXZ');
      car.updateMatrixWorld(true); // trails, spray and the headlamp cone read it this frame
      const fwd = c.vx * -Math.sin(c.yaw) + c.vz * -Math.cos(c.yaw);
      for (const w of wheels) { w.spin.rotation.x -= (fwd / 0.36) * dt; if (w.front) w.pivot.rotation.y = st.steer * 0.42; }
      bodyMat.uniforms.uBrake.value += ((st.brake ? 1 : 0) - bodyMat.uniforms.uBrake.value) * Math.min(1, dt * 12);
      brakeWash.material.uniforms.uPower.value = 0.12 + 0.5 * bodyMat.uniforms.uBrake.value;
      under.material.uniforms.uColor.value.setRGB(st.boosting ? 0.2 : 1.0, st.boosting ? 0.9 : 0.18, st.boosting ? 1.0 : 0.6);
      under.material.uniforms.uPower.value = st.boosting ? 0.6 : 0.2;
      // tail-light trails from the two rear corners
      const k = Math.min(1, c.speed / 26) * (0.55 + 0.45 * bodyMat.uniforms.uBrake.value + (st.boosting ? 0.6 : 0));
      trails.forEach((tr, s) => {
        corner.set(s ? 0.9 : -0.9, 0.83, 2.34).applyMatrix4(car.matrixWorld);
        tr.hist.unshift([corner.x, corner.y, corner.z]);
        if (tr.hist.length > TRAIL_N) tr.hist.pop();
        for (let i = 0; i < TRAIL_N; i++) {
          const h = tr.hist[Math.min(i, tr.hist.length - 1)], w = 0.11;
          tr.pos.set([h[0], h[1] - w, h[2], h[0], h[1] + w, h[2]], i * 6);
        }
        tr.mesh.geometry.attributes.position.needsUpdate = true;
        tr.mesh.material.uniforms.uPower.value = 1.8 * k;
      });
      // spray
      const want = c.speed > 8 ? Math.min(9, 2 + Math.floor(c.speed / 9) + Math.floor(Math.abs(c.slip) / 2.5)) : 0;
      for (let n = 0; n < want; n++) {
        const p = sp[spNext]; spNext = (spNext + 1) % SPRAY;
        corner.set(Math.random() < 0.5 ? 0.9 : -0.9, 0.15, 1.7).applyMatrix4(car.matrixWorld);
        p.x = corner.x; p.y = corner.y; p.z = corner.z; p.life = 1;
        p.vx = -c.vx * 0.15 + (Math.random() - 0.5) * 3; p.vz = -c.vz * 0.15 + (Math.random() - 0.5) * 3; p.vy = 1.5 + Math.random() * 3 + Math.abs(c.slip) * 0.15;
      }
      for (let i = 0; i < SPRAY; i++) {
        const p = sp[i];
        if (p.life > 0) { p.life -= dt * 1.5; p.vy -= 6 * dt; p.x += p.vx * dt; p.y = Math.max(0.05, p.y + p.vy * dt); p.z += p.vz * dt; }
        spPos[i * 3] = p.x; spPos[i * 3 + 1] = p.life > 0 ? p.y : -99; spPos[i * 3 + 2] = p.z; spA[i] = Math.max(0, p.life);
      }
      spGeo.attributes.position.needsUpdate = true; spGeo.attributes.aA.needsUpdate = true;
      // the headlamps as a cone of light for every surface shader
      corner.set(0, 0.62, -2.3).applyMatrix4(car.matrixWorld);
      U.uHead.value.set(corner.x, corner.y, corner.z, 1.0);
      U.uHeadDir.value.set(-Math.sin(c.yaw), -0.07, -Math.cos(c.yaw)).normalize();
      cars.forEach((tc, i) => {
        trafficAt(tc, t, tp);
        dummy.position.set(tp.x, 0, tp.z); dummy.rotation.set(0, tp.yaw, 0); dummy.scale.setScalar(Math.max(0.001, tp.edge)); dummy.updateMatrix();
        lampPools.setMatrixAt(i, dummy.matrix); tailPools.setMatrixAt(i, dummy.matrix);
      });
      lampPools.instanceMatrix.needsUpdate = tailPools.instanceMatrix.needsUpdate = true;
      // traffic
      for (const f of fleets) {
        f.mine.forEach((tc, i) => {
          trafficAt(tc, t, tp);
          dummy.position.set(tp.x, 0, tp.z); dummy.rotation.set(0, tp.yaw, 0); dummy.scale.setScalar(Math.max(0.001, tp.edge)); dummy.updateMatrix();
          f.mesh.setMatrixAt(i, dummy.matrix);
        });
        f.mesh.instanceMatrix.needsUpdate = true;
      }
      for (const g of gates) g.holo.material.uniforms.uTime.value = t;
    },
  };
}
