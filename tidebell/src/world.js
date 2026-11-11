// Builds the static world: seabed, scattered flora and rocks, landmarks, sea surface and open-water dome.
import * as THREE from 'three';
import { WORLD, SITES, VENT_POSITIONS, heightAt, bommieMask } from './terrain.js';
import { generateScatter, scatterColliders } from './scatter.js';
import { buildColliderGrid } from './physics.js';
import { shared } from './gfx.js';
import { b2t } from './assets.js';
import * as S from './shaders.js';

export const BELL_COLORS = ['#6dffd2', '#7ccaff', '#ffd27a', '#ff9bc8', '#b39bff', '#ff9455', '#f4fbff'].map((h) => new THREE.Color(h));

// Per-type material settings: sway [amplitude, speed, flutter, ref height], emission, gloss, translucency, backface, detail, draw distance.
const MAT = {
  kelp: { sway: [2.4, 0.45, 0.06, 20], trans: 0.9, dist: 150, detail: 0.2 },
  seagrass: { sway: [0.32, 1.1, 0.06, 1.0], trans: 0.6, dist: 70, detail: 0.1 },
  anemone: { sway: [0.07, 1.3, 0.14, 0.7], dist: 80, trans: 0.4, detail: 0.1 },
  ghost_anemone: { sway: [0.07, 1.0, 0.14, 0.7], emis: 2.4, dist: 120, detail: 0.1 },
  sea_whip: { sway: [0.4, 0.7, 0.02, 3], emis: 0.9, dist: 110, detail: 0.1 },
  coral_fan0: { sway: [0.1, 0.8, 0, 2], dist: 110, detail: 0.15 },
  coral_fan1: { sway: [0.1, 0.8, 0, 2], dist: 110, detail: 0.15 },
  lantern_stalk: { sway: [0.28, 0.55, 0.04, 2.4], emis: 3.2, dist: 170, detail: 0.1 },
  tube_worms: { sway: [0.03, 0.9, 0.02, 1.5], emis: 1.0, dist: 110 },
  clam: { emis: 1.6, dist: 70 },
  starfish: { dist: 60 },
  urchin: { dist: 60 },
  rock0: { detail: 0.5, dist: 170 },
  rock1: { detail: 0.5, dist: 170 },
  rock2: { detail: 0.5, dist: 170 },
  spire0: { detail: 0.55, dist: 260 },
  spire1: { detail: 0.55, dist: 260 },
  basalt: { detail: 0.4, dist: 260 },
};

export function propMaterial(o = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: o.vert ?? S.propVert,
    fragmentShader: S.propFrag,
    side: THREE.DoubleSide,
    uniforms: shared({
      uSway: { value: new THREE.Vector4(...(o.sway ?? [0, 1, 0, 1])) },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uEmis: { value: o.emis ?? 0 },
      uEmisCol: { value: new THREE.Color(1, 1, 1) },
      uGloss: { value: o.gloss ?? 0.12 },
      uTrans: { value: o.trans ?? 0 },
      uBackDark: { value: o.backDark ?? 1 },
      uDetail: { value: o.detail ?? 0.3 },
      ...(o.uniforms ?? {}),
    }),
  });
}

function buildTerrain(scene) {
  const step = 2;
  const nx = Math.round((WORLD.xMax - WORLD.xMin) / step);
  const nz = Math.round((WORLD.zMax - WORLD.zMin) / step);
  const H = new Float32Array((nx + 3) * (nz + 3));
  const at = (i, j) => H[(j + 1) * (nx + 3) + i + 1];
  for (let j = -1; j <= nz + 1; j++) {
    for (let i = -1; i <= nx + 1; i++) H[(j + 1) * (nx + 3) + i + 1] = heightAt(WORLD.xMin + i * step, WORLD.zMin + j * step);
  }
  const mat = new THREE.ShaderMaterial({ vertexShader: S.terrainVert, fragmentShader: S.terrainFrag, uniforms: shared() });
  const tx = 68;
  const tz = 55;
  for (let j0 = 0; j0 < nz; j0 += tz) {
    for (let i0 = 0; i0 < nx; i0 += tx) {
      const w = Math.min(tx, nx - i0);
      const h = Math.min(tz, nz - j0);
      const pos = new Float32Array((w + 1) * (h + 1) * 3);
      const nor = new Float32Array((w + 1) * (h + 1) * 3);
      const mask = new Float32Array((w + 1) * (h + 1));
      let k = 0;
      for (let j = j0; j <= j0 + h; j++) {
        for (let i = i0; i <= i0 + w; i++, k++) {
          const x = WORLD.xMin + i * step;
          const z = WORLD.zMin + j * step;
          pos.set([x, at(i, j), z], k * 3);
          const n = new THREE.Vector3(at(i - 1, j) - at(i + 1, j), 2 * step, at(i, j - 1) - at(i, j + 1)).normalize();
          nor.set([n.x, n.y, n.z], k * 3);
          mask[k] = bommieMask(x, z);
        }
      }
      const idx = new Uint32Array(w * h * 6);
      let q = 0;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const a = j * (w + 1) + i;
          const b = a + 1;
          const c = a + w + 1;
          const d = c + 1;
          idx.set([a, c, b, b, c, d], q);
          q += 6;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      scene.add(new THREE.Mesh(g, mat));
    }
  }
}

function buildScatter(scene, assets) {
  const scatter = generateScatter();
  const CELL = 48;
  const chunks = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qy = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const samples = {};
  for (const [type, items] of scatter) {
    if (!items.length) continue;
    const cfg = MAT[type] ?? {};
    const mat = propMaterial(cfg);
    const cells = new Map();
    for (const it of items) {
      const key = `${Math.floor(it.x / CELL)},${Math.floor(it.z / CELL)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(it);
    }
    for (const list of cells.values()) {
      const mesh = new THREE.InstancedMesh(assets.geo[type], mat, list.length);
      const cen = new THREE.Vector3();
      list.forEach((it, i) => {
        q.setFromUnitVectors(up, new THREE.Vector3(...it.n));
        qy.setFromAxisAngle(up, it.rot);
        q.multiply(qy);
        m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.scale, it.scale, it.scale));
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, col.setRGB(it.tint[0], it.tint[1], it.tint[2]));
        cen.add(new THREE.Vector3(it.x, it.y, it.z));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 4;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      chunks.push({ mesh, cen: cen.multiplyScalar(1 / list.length), dist: cfg.dist ?? 120 });
    }
    samples[type] = items.filter((_, i) => i % Math.max(1, Math.floor(items.length / 400)) === 0).map((it) => new THREE.Vector3(it.x, it.y + 1, it.z));
  }
  return { chunks, colliders: scatterColliders(scatter), samples };
}

export function buildWorld(scene, assets) {
  const colliders = [];
  const glows = [];
  buildTerrain(scene);
  const sc = buildScatter(scene, assets);
  colliders.push(...sc.colliders);

  // Place a landmark mesh and register its colliders (meta colliders are in Blender axes).
  const place = (name, x, z, { rot = 0, scale = 1, dy = 0, mat } = {}) => {
    const mesh = new THREE.Mesh(assets.geo[name], mat ?? propMaterial({ detail: 0.35, backDark: 0.3 }));
    const y = heightAt(x, z) + dy;
    mesh.position.set(x, y, z);
    mesh.rotation.y = rot;
    mesh.scale.setScalar(scale);
    mesh.updateMatrixWorld();
    scene.add(mesh);
    for (const c of assets.meta[name].colliders ?? []) {
      const p = new THREE.Vector3(...b2t(c)).applyMatrix4(mesh.matrixWorld);
      colliders.push([p.x, p.y, p.z, c[3] * scale]);
    }
    return mesh;
  };

  place('wreck', SITES.wreck.x, SITES.wreck.z, { rot: SITES.wreck.rot, dy: -0.6 });
  place('rock_arch', SITES.arch.x, SITES.arch.z, { rot: SITES.arch.rot, scale: 1.25, mat: propMaterial({ detail: 0.5 }) });
  place('rock_arch', -74, -168, { rot: 1.3, scale: 0.9, mat: propMaterial({ detail: 0.5 }) });
  place('rock_arch', 96, -592, { rot: 2.2, scale: 1.7, mat: propMaterial({ detail: 0.5 }) });
  place('whale_fall', SITES.whaleFall.x, SITES.whaleFall.z, { rot: SITES.whaleFall.rot, scale: 1.5, dy: -0.4, mat: propMaterial({ detail: 0.15 }) });

  // Hydrothermal vents.
  const ventMat = propMaterial({ detail: 0.45, emis: 3.0 });
  const vents = [];
  VENT_POSITIONS.forEach((v, i) => {
    const scale = 1.3 - i * 0.12;
    const mesh = place('vent', v.x, v.z, { rot: i * 1.3, scale, dy: -0.5, mat: ventMat });
    for (const mth of assets.meta.vent.mouths) vents.push(new THREE.Vector3(...b2t(mth)).applyMatrix4(mesh.matrixWorld));
    glows.push({ pos: new THREE.Vector3(v.x, mesh.position.y + 7 * scale, v.z), color: new THREE.Color(1.0, 0.35, 0.1), radius: 16, power: 1.6 });
  });

  // The Drowned Choir.
  const c = SITES.choir;
  const ruinMat = propMaterial({ detail: 0.3, emis: 1.6, uniforms: {} });
  ruinMat.uniforms.uEmisCol.value.set(0.35, 1.0, 0.85);
  place('dais', c.x, c.z, { mat: ruinMat });
  place('moon_gate', c.x, c.z + 36, { mat: ruinMat, scale: 1.25 });
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.45;
    place('monolith', c.x + Math.cos(a) * 24, c.z + Math.sin(a) * 24, { rot: -a + Math.PI / 2, mat: ruinMat, scale: 1.3 });
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.1;
    if (Math.abs(Math.sin(a) - 1) < 0.15) continue; // leave the approach through the gate open
    place(k % 3 === 1 ? 'column_broken' : 'column', c.x + Math.cos(a) * 40, c.z + Math.sin(a) * 40, { rot: a, mat: ruinMat, scale: 1.2, dy: -0.3 });
  }
  glows.push({ pos: new THREE.Vector3(c.x, heightAt(c.x, c.z) + 4, c.z + 36), color: new THREE.Color(0.2, 0.9, 0.75), radius: 22, power: 0.5 });

  // Tide bells, each with its own material so it can be lit individually, plus a guiding pillar of light.
  const bells = SITES.bells.map((b, i) => {
    const mat = propMaterial({ detail: 0.25, emis: 0.25, gloss: 0.5 });
    mat.uniforms.uEmisCol.value.copy(BELL_COLORS[i]);
    const dy = i === 6 ? 1.5 : 0;
    const mesh = place('tide_bell', b.x, b.z, { rot: i * 0.9, mat, dy });
    const pillarMat = new THREE.ShaderMaterial({
      vertexShader: S.beamVert, fragmentShader: S.beamFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: shared({ uColor: { value: BELL_COLORS[i].clone() }, uPower: { value: 0.05 }, uFalloff: { value: 1.3 } }),
    });
    const pg = new THREE.CylinderGeometry(1.8, 0.5, 70, 20, 1, true);
    pg.translate(0, 35, 0);
    const pillar = new THREE.Mesh(pg, pillarMat);
    pillar.position.set(b.x, mesh.position.y + 4.5, b.z);
    pillar.renderOrder = 5;
    scene.add(pillar);
    const pos = new THREE.Vector3(b.x, mesh.position.y + 2.6, b.z);
    const glow = { pos, color: BELL_COLORS[i], radius: 9, power: 0.25 };
    glows.push(glow);
    return { index: i, mesh, mat, pillarMat, pos, glow, awake: false, energy: 0 };
  });

  // Sea surface from below, and the surrounding open water.
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(Math.PI / 2),
    new THREE.ShaderMaterial({ vertexShader: S.surfaceVert, fragmentShader: S.surfaceFrag, uniforms: shared(), side: THREE.DoubleSide }));
  surface.frustumCulled = false;
  scene.add(surface);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
    new THREE.ShaderMaterial({ vertexShader: S.domeVert, fragmentShader: S.domeFrag, uniforms: shared(), side: THREE.BackSide, depthWrite: false }));
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  const tmp = new THREE.Vector3();
  return {
    bells, glows, vents, samples: sc.samples,
    colliders: buildColliderGrid(colliders),
    // Hide instance chunks beyond the fog; the frustum test handles the rest.
    cull(camPos) {
      for (const ch of sc.chunks) ch.mesh.visible = tmp.copy(ch.cen).sub(camPos).length() < ch.dist + ch.mesh.boundingSphere.radius;
    },
  };
}
