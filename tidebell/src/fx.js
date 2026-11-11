// Particles: marine snow and plankton, bubbles, vent smoke.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { shared, U } from './gfx.js';
import * as S from './shaders.js';

export function buildFx(scene, world) {
  const rng = mulberry32(5150);

  // Marine snow: a wrapped box of drifting specks that light up in the lamp beams.
  const N = 9000;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    pos.set([rng(), rng(), rng()], i * 3);
    seed.set([rng(), rng(), rng(), rng()], i * 4);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const snow = new THREE.Points(sg, new THREE.ShaderMaterial({
    vertexShader: S.snowVert, fragmentShader: S.snowFrag, uniforms: shared({ uBox: { value: 46 } }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  snow.frustumCulled = false;
  snow.renderOrder = 6;
  scene.add(snow);

  // Bubbles: a small CPU pool.
  const MAXB = 320;
  const bpos = new Float32Array(MAXB * 3);
  const binfo = new Float32Array(MAXB * 2);
  const bubbles = Array.from({ length: MAXB }, () => ({ life: 0, max: 1, x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, size: 0.05, ph: 0 }));
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(bpos, 3).setUsage(THREE.DynamicDrawUsage));
  bg.setAttribute('aInfo', new THREE.BufferAttribute(binfo, 2).setUsage(THREE.DynamicDrawUsage));
  const bmesh = new THREE.Points(bg, new THREE.ShaderMaterial({
    vertexShader: S.bubbleVert, fragmentShader: S.bubbleFrag, uniforms: { uPx: U.uPx },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  bmesh.frustumCulled = false;
  bmesh.renderOrder = 7;
  scene.add(bmesh);
  let cursor = 0;
  function emitBubble(p, v, size, life) {
    const b = bubbles[cursor];
    cursor = (cursor + 1) % MAXB;
    b.x = p.x;
    b.y = p.y;
    b.z = p.z;
    b.vx = v.x;
    b.vy = v.y;
    b.vz = v.z;
    b.size = size;
    b.life = b.max = life;
    b.ph = Math.random() * 6.283;
  }

  // Black smoker plumes.
  const per = 70;
  const vp = new Float32Array(world.vents.length * per * 3);
  const vs = new Float32Array(world.vents.length * per * 4);
  world.vents.forEach((m, j) => {
    for (let i = 0; i < per; i++) {
      vp.set([m.x, m.y, m.z], (j * per + i) * 3);
      vs.set([rng(), rng() * 6.283, rng(), rng()], (j * per + i) * 4);
    }
  });
  const vg = new THREE.BufferGeometry();
  vg.setAttribute('position', new THREE.BufferAttribute(vp, 3));
  vg.setAttribute('aSeed', new THREE.BufferAttribute(vs, 4));
  const smoke = new THREE.Points(vg, new THREE.ShaderMaterial({
    vertexShader: S.smokeVert, fragmentShader: S.smokeFrag, uniforms: { uTime: U.uTime, uPx: U.uPx },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  smoke.frustumCulled = false;
  smoke.renderOrder = 3;
  scene.add(smoke);

  return {
    emitBubble,
    update(dt, time) {
      for (let i = 0; i < MAXB; i++) {
        const b = bubbles[i];
        if (b.life > 0) {
          b.life -= dt;
          b.vy += (2.2 + b.size * 14) * dt;
          const d = Math.exp(-1.8 * dt);
          b.vx *= d;
          b.vz *= d;
          b.vy *= Math.exp(-0.9 * dt);
          b.x += (b.vx + Math.sin(time * 5 + b.ph) * 0.35) * dt;
          b.y += b.vy * dt;
          b.z += (b.vz + Math.cos(time * 4.3 + b.ph) * 0.35) * dt;
          if (b.y > -0.3) b.life = 0;
        }
        const k = b.life > 0 ? Math.min(1, b.life / (b.max * 0.3)) : 0;
        bpos[i * 3] = b.x;
        bpos[i * 3 + 1] = b.life > 0 ? b.y : -9999;
        bpos[i * 3 + 2] = b.z;
        binfo[i * 2] = b.size * (1.6 - 0.6 * k);
        binfo[i * 2 + 1] = k;
      }
      bg.attributes.position.needsUpdate = true;
      bg.attributes.aInfo.needsUpdate = true;
    },
  };
}
