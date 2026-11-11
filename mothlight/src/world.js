// Turns the city description into three.js objects and animates everything that moves on its own.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { DISTRICTS, N, PITCH, blockCenter, RAIL, RAIL_Y } from './city.js';
import { RNG } from './rng.js';
import { modelGeometry } from './models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, buildingMaterial, groundShader, skyMaterial, rainMaterial, liftMaterial, wingMaterial, swarmMaterial, propMaterial, coneMaterial, pedMaterial, trailMaterial, steamMaterial } from './shaders.js';

const NEON = ['#ff2d95', '#00e5ff', '#ffb300', '#7dff5a', '#b56bff', '#ff5a36', '#f4f7ff'];
const FONT = '"Helvetica Neue", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", Arial, sans-serif';
const WIDE_SIGNS = ['NOODLE//9', 'KIRIN SYNTH', 'OXIDE BAR', 'VANTA CLINIC', 'HOTEL MIRAGE', 'SOMA TEA', 'NULL ARCADE',
  'GHOST DATA', 'PAWN + CHIP', 'SUMP WORKS', 'DEEP SLEEP PODS', '夜市 NIGHT MKT', '電脳修理', '24H ラーメン', 'MOTH & CO', 'OPEN'];
const TALL_SIGNS = ['酒', '夜市', '零度', 'ホテル', '雨の街', 'BAR', 'SYNTH', '電脳', '薬', 'ラーメン', 'NULL', '蛾'];
const ADS = [['HALCYON', 'we keep the lights on'], ['LUMEN?', 'report stray signals'], ['GLASSWATER LINE', 'every 4 min, all night'],
  ['SOMA', 'sleep is a subscription'], ['VANTA', 'new eyes by morning'], ['KESSEL', 'eat late · owe later']];

const dummy = new THREE.Object3D();
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function glowText(g, text, x, y, color, size) {
  g.font = `700 ${size}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = size * 0.45; g.fillStyle = color;
  g.fillText(text, x, y); g.fillText(text, x, y);
  g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText(text, x, y);
}

function frame(g, w, h, color) {
  g.fillStyle = '#05050b'; g.fillRect(0, 0, w, h);
  g.strokeStyle = color; g.lineWidth = 6; g.shadowColor = color; g.shadowBlur = 14;
  g.strokeRect(9, 9, w - 18, h - 18);
  g.shadowBlur = 0;
}

const wideSign = (text, color) => canvasTexture(512, 128, (g, w, h) => {
  frame(g, w, h, color);
  let size = 78;
  g.font = `700 ${size}px ${FONT}`;
  size = Math.min(size, size * 440 / g.measureText(text).width);
  glowText(g, text, w / 2, h / 2 + 4, color, size);
});

const tallSign = (text, color) => canvasTexture(128, 512, (g, w, h) => {
  frame(g, w, h, color);
  const chars = [...text];
  const size = Math.min(92, 440 / chars.length);
  chars.forEach((ch, i) => glowText(g, ch, w / 2, h / 2 + (i - (chars.length - 1) / 2) * size * 1.08, color, size));
});

const adSign = ([head, sub], i) => canvasTexture(512, 256, (g, w, h) => {
  const a = NEON[i % NEON.length], b = NEON[(i + 3) % NEON.length];
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#0a0614'); grad.addColorStop(0.55, a + '55'); grad.addColorStop(1, b + 'aa');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.5; g.strokeStyle = b; g.lineWidth = 3;
  for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(w * 0.8, h * 0.45, 20 + k * 22, 0, Math.PI * 2); g.stroke(); }
  g.globalAlpha = 1;
  let size = 84;
  g.font = `700 ${size}px ${FONT}`;
  size = Math.min(size, size * 430 / g.measureText(head).width);
  glowText(g, head, w * 0.47, h * 0.42, '#ffffff', size);
  glowText(g, sub, w * 0.47, h * 0.76, a, 26);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2);
});

export function buildWorld(scene, city, models) {
  const rng = new RNG(4242);
  const tickers = []; // functions (t, dt, camera) run every frame
  let pedMesh = null;

  // ---- sky and fog
  scene.fog = new THREE.FogExp2(U.uFogColor.value, U.uFogDensity.value);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), skyMaterial());
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  tickers.push((t, dt, cam) => sky.position.copy(cam.position));

  // ---- ground mirror
  const ground = new Reflector(new THREE.PlaneGeometry(3200, 3200), { textureWidth: 1024, textureHeight: 1024, shader: groundShader, clipBias: 0.003 });
  for (const k of Object.keys(U)) ground.material.uniforms[k] = U[k];
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // ---- buildings: one instanced draw call
  {
    const all = [...city.boxes, ...city.skyline];
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const size = new Float32Array(all.length * 3), tint = new Float32Array(all.length * 3), params = new Float32Array(all.length * 4);
    const mesh = new THREE.InstancedMesh(geo, buildingMaterial(), all.length);
    all.forEach((b, i) => {
      const h = b.y1 - b.y0;
      dummy.position.set(b.x, b.y0, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(b.w, h, b.d); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      size.set([b.w, h, b.d], i * 3);
      const c = DISTRICTS[b.district].color, k = 0.75 + 0.4 * b.seed;
      tint.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
      params.set([b.seed, b.style, b.lit, b.y0], i * 4);
    });
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 3));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // ---- neon signs, instanced per texture
  {
    const plane = new THREE.PlaneGeometry(1, 1);
    const sets = {
      wide: WIDE_SIGNS.map((t, i) => ({ tex: wideSign(t, NEON[(i * 3 + 1) % NEON.length]), items: [] })),
      tall: TALL_SIGNS.map((t, i) => ({ tex: tallSign(t, NEON[(i * 2) % NEON.length]), items: [] })),
      ad: ADS.map((t, i) => ({ tex: adSign(t, i), items: [] })),
    };
    const put = (set, x, y, z, yaw, w, h) => rng.pick(sets[set]).items.push({ x, y, z, yaw, w, h });
    for (const b of city.buildings) {
      const cx = blockCenter(b.bi), cz = blockCenter(b.bj);
      const faces = [
        { nx: -1, nz: 0, fw: b.d, x: b.minX, z: b.z, gap: b.minX - (cx - 30) },
        { nx: 1, nz: 0, fw: b.d, x: b.maxX, z: b.z, gap: cx + 30 - b.maxX },
        { nx: 0, nz: -1, fw: b.w, x: b.x, z: b.minZ, gap: b.minZ - (cz - 30) },
        { nx: 0, nz: 1, fw: b.w, x: b.x, z: b.maxZ, gap: cz + 30 - b.maxZ },
      ];
      const busy = b.district === 1 || b.district === 2 ? 1.25 : b.district === 4 ? 0.6 : 1;
      for (const f of faces) {
        const street = f.gap < 8;
        const yaw = Math.atan2(f.nx, f.nz);
        const tx = -f.nz, tz = f.nx; // along the wall (sign irrelevant)
        const at = (along, out) => [f.x + tx * along + f.nx * out, f.z + tz * along + f.nz * out];
        if (rng.chance((street ? 0.8 : 0.25) * busy)) {
          const w = Math.min(f.fw * 0.75, rng.range(4.5, 9)), [x, z] = at(rng.range(-0.5, 0.5) * (f.fw - w), 0.15);
          put('wide', x, rng.range(4.9, Math.min(b.y1 - 1.5, 9)), z, yaw, w, w / 4);
        }
        if (b.y1 > 12 && rng.chance((street ? 0.6 : 0.2) * busy)) {
          const h = rng.range(5, 8), side = rng.chance(0.5) ? 1 : -1, [x, z] = at(side * (f.fw / 2 - 1.2), 1.05);
          put('tall', x, rng.range(6 + h / 2, Math.min(b.y1 - h / 2 - 1, 22)), z, yaw + Math.PI / 2, h / 4, h);
        }
        if (street && b.y1 > 44 && f.fw > 15 && rng.chance(0.4)) {
          const w = Math.min(f.fw * 0.8, rng.range(12, 22)), [x, z] = at(0, 0.2);
          put('ad', x, rng.range(20, Math.min(b.y1 - 8, 60)), z, yaw, w, w / 2);
        }
      }
    }
    const flicker = [];
    for (const [name, list] of Object.entries(sets)) {
      list.forEach((s, i) => {
        if (!s.items.length) return;
        const gain = name === 'ad' ? 1.4 : 1.9;
        const mat = new THREE.MeshBasicMaterial({ map: s.tex, side: THREE.DoubleSide, color: new THREE.Color(gain, gain, gain) });
        const mesh = new THREE.InstancedMesh(plane, mat, s.items.length);
        s.items.forEach((it, k) => {
          dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.yaw, 0); dummy.scale.set(it.w, it.h, 1); dummy.updateMatrix();
          mesh.setMatrixAt(k, dummy.matrix);
        });
        mesh.frustumCulled = false;
        scene.add(mesh);
        if (i % 5 === 2) flicker.push({ mat, gain, seed: i * 7.3 });
      });
    }
    tickers.push((t) => {
      for (const f of flicker) {
        const n = Math.sin(t * 13 + f.seed) * Math.sin(t * 7.1 + f.seed * 2);
        f.mat.color.setScalar(n > 0.75 ? f.gain * 0.25 : f.gain);
      }
    });
  }

  // ---- props and street lamps: every box in the city that is not a building, in one draw call
  {
    const list = city.props.map((q) => ({ x: q.x, y: q.y0, z: q.z, w: q.w, h: q.y1 - q.y0, d: q.d, c: q.color, e: q.emis }));
    const heads = [];
    const POLE = [0.03, 0.033, 0.045];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const cx = blockCenter(i), cz = blockCenter(j);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        // [pole x, pole z, outward x, outward z]
        for (const [x, z, ox, oz] of [[cx + sx * 15, cz + sz * 28.6, 0, sz], [cx + sx * 28.6, cz + sz * 15, sx, 0]]) {
          list.push({ x, y: 0, z, w: 0.16, h: 5.7, d: 0.16, c: POLE, e: 0 });
          list.push({ x, y: 0, z, w: 0.34, h: 0.5, d: 0.34, c: POLE, e: 0 });
          list.push({ x: x + ox * 0.5, y: 5.62, z: z + oz * 0.5, w: ox ? 1.1 : 0.1, h: 0.1, d: oz ? 1.1 : 0.1, c: POLE, e: 0 });
          list.push({ x: x + ox * 0.85, y: 5.5, z: z + oz * 0.85, w: ox ? 0.7 : 0.3, h: 0.1, d: oz ? 0.7 : 0.3, c: [3.4, 2.3, 1.2], e: 1 });
          heads.push([x + ox * 0.85, z + oz * 0.85]);
        }
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const col = new Float32Array(list.length * 4);
    const mesh = new THREE.InstancedMesh(geo, propMaterial(), list.length);
    list.forEach((q, i) => {
      dummy.position.set(q.x, q.y, q.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(q.w, q.h, q.d); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.set([q.c[0], q.c[1], q.c[2], q.e], i * 4);
    });
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 4));
    mesh.frustumCulled = false;
    scene.add(mesh);

    // Volumetric-looking cone of light under each lamp head.
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(2.7, 5.5, 20, 1, true).translate(0, 2.75, 0), coneMaterial(), heads.length);
    heads.forEach(([x, z], i) => { dummy.position.set(x, 0, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); cones.setMatrixAt(i, dummy.matrix); });
    cones.frustumCulled = false; cones.renderOrder = 2;
    scene.add(cones);
  }

  // ---- steam vents along the kerbs
  {
    const spots = [];
    for (let k = 0; k < 70; k++) {
      const cx = blockCenter(rng.int(0, N - 1)), cz = blockCenter(rng.int(0, N - 1));
      const t = rng.range(-24, 24), s = rng.chance(0.5) ? 1 : -1;
      spots.push(rng.chance(0.5) ? [cx + t, cz + s * 31.5] : [cx + s * 31.5, cz + t]);
    }
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), steamMaterial(), spots.length * 2);
    spots.forEach(([x, z], i) => {
      for (let k = 0; k < 2; k++) {
        dummy.position.set(x, 0, z); dummy.rotation.set(0, k * Math.PI / 2 + i, 0); dummy.scale.set(4.5, 8 + (i % 3), 1); dummy.updateMatrix();
        mesh.setMatrixAt(i * 2 + k, dummy.matrix);
      }
    });
    mesh.frustumCulled = false; mesh.renderOrder = 3;
    scene.add(mesh);
    const grate = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.03, 1.1), new THREE.MeshBasicMaterial({ color: 0x030304 }), spots.length);
    spots.forEach(([x, z], i) => { dummy.position.set(x, 0.02, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); grate.setMatrixAt(i, dummy.matrix); });
    grate.frustumCulled = false;
    scene.add(grate);
  }

  // ---- grav-lifts
  {
    const mat = liftMaterial();
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.4), side: THREE.DoubleSide });
    for (const l of city.lifts) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(l.r, l.r, 1, 28, 1, true).translate(0, 0.5, 0), mat);
      col.position.set(l.x, 0, l.z); col.scale.y = l.top + 3;
      const ring = new THREE.Mesh(new THREE.RingGeometry(l.r - 0.25, l.r, 40).rotateX(-Math.PI / 2), ringMat);
      ring.position.set(l.x, 0.06, l.z);
      scene.add(col, ring);
    }
  }

  // ---- echo shards
  const shardObjs = [];
  let swarm;
  {
    const core = new THREE.OctahedronGeometry(0.42);
    const shell = new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.85));
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 1.7, 1.9) });
    const shellMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 2.0, 2.2) });
    const beamGeo = new THREE.CylinderGeometry(0.09, 0.09, 180, 8, 1, true).translate(0, 91.5, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.1, 1.3), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const per = 22, n = city.shards.length * per;
    const centers = new Float32Array(n * 3), seeds = new Float32Array(n * 4);
    city.shards.forEach((s, i) => {
      const g = new THREE.Group();
      g.position.set(s.x, s.y + 1.35, s.z);
      const c = new THREE.Mesh(core, coreMat); c.scale.y = 1.7;
      const e = new THREE.LineSegments(shell, shellMat); e.scale.y = 1.5;
      const beam = new THREE.Mesh(beamGeo, beamMat); beam.visible = false;
      g.add(c, e, beam);
      scene.add(g);
      shardObjs.push({ group: g, core: c, shell: e, beam });
      for (let k = 0; k < per; k++) {
        centers.set([s.x, s.y, s.z], (i * per + k) * 3);
        seeds.set([rng.next(), rng.next(), rng.next(), rng.next()], (i * per + k) * 4);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    swarm = new THREE.Points(geo, swarmMaterial());
    swarm.frustumCulled = false;
    swarm.userData.per = per;
    scene.add(swarm);
    tickers.push((t) => {
      shardObjs.forEach((o, i) => {
        o.core.rotation.y = t * 1.4 + i; o.shell.rotation.y = -t * 0.6 + i;
        o.group.position.y = city.shards[i].y + 1.35 + Math.sin(t * 1.3 + i) * 0.14;
      });
    });
  }

  // ---- lore terminals and the Spire uplink
  const screenTex = (title, color) => canvasTexture(128, 160, (g, w, h) => {
    g.fillStyle = '#02080a'; g.fillRect(0, 0, w, h);
    glowText(g, title, w / 2, 26, color, 22);
    g.fillStyle = color; g.globalAlpha = 0.75;
    for (let y = 52; y < h - 10; y += 12) g.fillRect(12, y, 30 + ((y * 37) % 70), 4);
  });
  const kiosk = (x, z, nx, nz, color, title, scale = 1) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z); g.rotation.y = Math.atan2(nx, nz); g.scale.setScalar(scale);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, 0.5).translate(0, 1.05, 0), new THREE.MeshBasicMaterial({ color: 0x0b0e15 }));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.88), new THREE.MeshBasicMaterial({ map: screenTex(title, color), color: new THREE.Color(1.9, 1.9, 1.9) }));
    screen.position.set(0, 1.42, 0.26);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.07, 0.56).translate(0, 2.13, 0), new THREE.MeshBasicMaterial({ color: hdr(color, 2.4) }));
    const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: hdr(color, 2.6) }));
    mark.position.y = 2.75;
    g.add(body, screen, cap, mark);
    scene.add(g);
    tickers.push((t) => { mark.rotation.y = t * 2; mark.position.y = 2.75 + Math.sin(t * 2 + x) * 0.08; });
    return g;
  };
  for (const t of city.terminals) kiosk(t.x, t.z, t.nx, t.nz, '#6dff8a', 'ECHO');
  kiosk(city.uplink.x, city.uplink.z, 0, 1, '#5fe8ff', 'UPLINK', 1.25);

  // ---- the Spire's beam, halo rings and beacon
  const spireBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1500, 12, 1, true).translate(0, 310 + 750, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.3, 1.6), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  scene.add(spireBeam);
  {
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.9, 2.3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const rings = [[60, 15], [112, 13.5], [160, 12], [208, 8.5]].map(([y, r], i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.16, 6, 72).rotateX(Math.PI / 2), ringMat);
      m.position.y = y; scene.add(m); return { m, i };
    });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.5, 0.4), fog: false }));
    beacon.position.y = 311; scene.add(beacon);
    tickers.push((t) => {
      for (const { m, i } of rings) { m.rotation.x = Math.sin(t * 0.3 + i * 1.7) * 0.12; m.rotation.z = Math.cos(t * 0.23 + i) * 0.12; }
      beacon.visible = (t % 2.4) < 1.2;
    });
  }

  // ---- plaza holograms
  for (const p of city.plazas) {
    const c = hdr(new THREE.Color(...DISTRICTS[p.district].color).getHex(), 1.6);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 0.5, 24).translate(0, 0.25, 0), new THREE.MeshBasicMaterial({ color: 0x0a0c13 }));
    const lip = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.07, 6, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: c }));
    lip.position.y = 0.52;
    const holo = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(7.5, 1)),
      new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    const inner = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.TorusKnotGeometry(3, 0.8, 60, 6)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(1, 1, 1), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(7, 0.6, 12, 28, 1, true).translate(0, 6.5, 0),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z); holo.position.y = inner.position.y = 13;
    g.add(base, lip, holo, inner, cone); scene.add(g);
    tickers.push((t) => { holo.rotation.y = t * 0.2; holo.rotation.x = t * 0.13; inner.rotation.y = -t * 0.5; inner.rotation.z = t * 0.3; });
  }

  // ---- monorail
  {
    const dark = new THREE.MeshBasicMaterial({ color: 0x080a10 });
    for (const b of city.rail) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.y1 - b.y0, b.d), dark);
      m.position.set(b.x, (b.y0 + b.y1) / 2, b.z); scene.add(m);
    }
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.5, 1.9) });
    for (const s of [-1, 1]) {
      // Two thin guide lights under the deck rather than one glowing slab.
      for (const o of [-0.95, 0.95]) {
        const a = new THREE.Mesh(new THREE.BoxGeometry(2 * RAIL + 2.4, 0.06, 0.12), strip); a.position.set(0, RAIL_Y - 0.83, s * RAIL + o);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 2 * RAIL + 2.4), strip); b.position.set(s * RAIL + o, RAIL_Y - 0.83, 0);
        scene.add(a, b);
      }
    }
    const side = canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = '#0a0d14'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffe9b0'; for (let x = 10; x < w - 20; x += 30) g.fillRect(x, 14, 22, 20);
      g.fillStyle = '#ff2d95'; g.fillRect(0, 46, w, 5);
    });
    const sideMat = new THREE.MeshBasicMaterial({ map: side, color: new THREE.Color(2, 2, 2) });
    const mats = [sideMat, sideMat, dark, dark, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.3, 0.2) }), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.6) })];
    const cars = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.7, 10.6), mats); scene.add(m); return m; });
    const per = 8 * RAIL;
    const at = (s, out) => {
      s = ((s % per) + per) % per;
      const k = Math.floor(s / (2 * RAIL)), u = s - k * 2 * RAIL - RAIL;
      if (k === 0) out.set(u, 0, -RAIL); else if (k === 1) out.set(RAIL, 0, u); else if (k === 2) out.set(-u, 0, RAIL); else out.set(-RAIL, 0, -u);
      return out;
    };
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    tickers.push((t) => {
      cars.forEach((car, i) => {
        const s = t * 24 - i * 11.6;
        at(s + 4.5, a); at(s - 4.5, b);
        car.position.set((a.x + b.x) / 2, RAIL_Y + 1.5, (a.z + b.z) / 2);
        car.rotation.y = Math.atan2(-(a.x - b.x), -(a.z - b.z));
      });
    });
  }

  // ---- pedestrians: one merged figure (legs, coat, head, umbrella), instanced, legs animated in the shader
  {
    const count = 420, half = 26.9, per = 8 * half;
    const geo = modelGeometry(models.ped);
    { // the model's alpha channel carries the part id (0 body, 1-2 legs, 3 canopy, 4 shaft)
      const c = geo.getAttribute('aColor'), part = new Float32Array(c.count);
      for (let i = 0; i < c.count; i++) part[i] = Math.round(c.getW(i) * 4);
      geo.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    }
    const look = new Float32Array(count * 4), walk = new Float32Array(count * 2);
    const mesh = new THREE.InstancedMesh(geo, pedMaterial(), count);
    const peds = [];
    for (let k = 0; k < count; k++) {
      let i, j;
      do { i = rng.int(0, N - 1); j = rng.int(0, N - 1); } while (i === 4 && j === 4);
      const v = rng.range(0.9, 1.7) * (rng.chance(0.5) ? 1 : -1);
      peds.push({ cx: blockCenter(i), cz: blockCenter(j), s: rng.range(0, per), v, lane: rng.range(-0.5, 1.2), size: rng.range(0.92, 1.08) });
      const c = rng.chance(0.7) ? hdr(rng.pick(NEON), 0.7) : new THREE.Color(0.04, 0.04, 0.06);
      look.set([c.r, c.g, c.b, rng.chance(0.8) ? 1 : 0], k * 4);
      walk.set([Math.abs(v) * 4.2, rng.range(0, 6.28)], k * 2);
    }
    geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
    geo.setAttribute('aWalk', new THREE.InstancedBufferAttribute(walk, 2));
    mesh.frustumCulled = false;
    scene.add(mesh);
    pedMesh = mesh;
    tickers.push((t) => {
      peds.forEach((p, k) => {
        const h = half + p.lane, len = 8 * h;
        const s = (((p.s + p.v * t) % len) + len) % len;
        const side = Math.floor(s / (2 * h)), u = s - side * 2 * h - h;
        let x, z, yaw;
        if (side === 0) { x = u; z = -h; yaw = -Math.PI / 2; } else if (side === 1) { x = h; z = u; yaw = Math.PI; }
        else if (side === 2) { x = -u; z = h; yaw = Math.PI / 2; } else { x = -h; z = -u; yaw = 0; }
        dummy.position.set(p.cx + x, 0, p.cz + z);
        dummy.rotation.set(0, p.v > 0 ? yaw : yaw + Math.PI, 0); dummy.scale.setScalar(p.size); dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  // ---- flying traffic
  {
    const count = 170, L = 620;
    // Hull with glowing nose, tail and underside, plus a darker glass cabin.
    const painted = (g, faceCol) => {
      const col = new Float32Array(24 * 3);
      for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) col.set(faceCol[f], (f * 4 + v) * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    const hull = [0.05, 0.055, 0.075], glass = [0.02, 0.05, 0.08];
    const geo = mergeGeometries([
      painted(new THREE.BoxGeometry(1.9, 0.5, 4.6), [hull, hull, [0.07, 0.075, 0.1], [0.15, 0.8, 1.1], [4, 0.3, 0.2], [4, 3.6, 3]]),
      painted(new THREE.BoxGeometry(1.5, 0.42, 2.2).translate(0, 0.46, 0.3), [glass, glass, hull, hull, glass, [0.05, 0.12, 0.18]]),
      painted(new THREE.BoxGeometry(2.5, 0.08, 0.7).translate(0, 0.1, 1.7), [hull, hull, hull, hull, [2.5, 0.2, 0.15], hull]),
    ]);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), count);
    mesh.frustumCulled = false; scene.add(mesh);
    const trails = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.7, 16).rotateX(-Math.PI / 2).translate(0, 0, 10.3), trailMaterial(), count);
    trails.frustumCulled = false; trails.renderOrder = 2; scene.add(trails);
    const cars = [];
    for (let k = 0; k < count; k++) {
      const dir = rng.chance(0.5) ? 1 : -1;
      cars.push({ axis: rng.int(0, 1), line: (rng.int(0, N) - N / 2) * PITCH + dir * 3.2, y: rng.pick([24, 36, 52, 76]) + rng.range(-2, 2), s: rng.range(0, 2 * L), v: rng.range(16, 34) * dir });
    }
    tickers.push((t) => {
      cars.forEach((c, k) => {
        const s = ((((c.s + c.v * t) % (2 * L)) + 2 * L) % (2 * L)) - L;
        if (c.axis === 0) { dummy.position.set(s, c.y, c.line); dummy.rotation.set(0, c.v > 0 ? -Math.PI / 2 : Math.PI / 2, 0); }
        else { dummy.position.set(c.line, c.y, s); dummy.rotation.set(0, c.v > 0 ? Math.PI : 0, 0); }
        dummy.scale.set(1, 1, 1); dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix); trails.setMatrixAt(k, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = trails.instanceMatrix.needsUpdate = true;
    });
  }

  // ---- giant holographic moths circling the Spire
  const moths = [];
  {
    const wingGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0).rotateX(-Math.PI / 2);
    const specs = [[[0.2, 1.4, 1.6], [1.6, 0.3, 1.2], 85, 150, 0.11, 0], [[1.6, 0.9, 0.2], [1.5, 0.2, 0.6], 130, 105, -0.08, 2.1], [[0.4, 1.5, 0.7], [0.3, 0.6, 1.7], 60, 215, 0.14, 4.0]];
    for (const [ca, cb, radius, height, speed, phase] of specs) {
      const mat = wingMaterial(ca, cb, 1.1);
      const g = new THREE.Group();
      const L = new THREE.Group(), R = new THREE.Group();
      L.add(new THREE.Mesh(wingGeo, mat));
      const rm = new THREE.Mesh(wingGeo, mat); rm.scale.x = -1; R.add(rm);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(...cb), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      g.add(L, R, body); g.scale.setScalar(34);
      scene.add(g);
      moths.push({ g, L, R, radius, height, speed, phase });
    }
    tickers.push((t) => {
      for (const m of moths) {
        const a = t * m.speed + m.phase;
        m.g.position.set(Math.cos(a) * m.radius, m.height + Math.sin(t * 0.4 + m.phase) * 10, Math.sin(a) * m.radius);
        const dir = Math.sign(m.speed);
        m.g.rotation.y = Math.atan2(Math.sin(a) * dir, -Math.cos(a) * dir);
        const flap = 0.25 + Math.sin(t * 2.6 + m.phase) * 0.6;
        m.L.rotation.z = flap; m.R.rotation.z = -flap;
      }
    });
  }

  // ---- rain
  {
    const n = 9000;
    const seed = new Float32Array(n * 6), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const s = [rng.next(), rng.next(), rng.next()];
      seed.set(s, i * 6); seed.set(s, i * 6 + 3); end[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const rain = new THREE.LineSegments(geo, rainMaterial());
    rain.frustumCulled = false;
    scene.add(rain);
  }

  return {
    ground, swarm, moths, pedMesh,
    update(t, dt, camera) { for (const f of tickers) f(t, dt, camera); },
    setShard(i, { collected, revealed }) {
      const o = shardObjs[i];
      o.group.visible = !collected;
      o.beam.visible = revealed && !collected;
      if (collected) {
        const a = swarm.geometry.attributes.aCenter, per = swarm.userData.per;
        for (let k = 0; k < per; k++) a.setY(i * per + k, -999);
        a.needsUpdate = true;
      }
    },
    setFinale(k) { // k eases 0 -> 1
      U.uAurora.value = k;
      spireBeam.material.opacity = 0.16 + 0.5 * k;
      spireBeam.scale.set(1 + 2 * k, 1, 1 + 2 * k);
    },
  };
}
