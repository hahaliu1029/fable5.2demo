// The house as the renderer sees it: one group per room, doors that link rooms, veils that hide doorways, and
// stencil portals so a neighbouring room is only ever drawn through its doorway. The room the player is in always
// sits at the origin; neighbours are attached to it door to door each frame.
import * as THREE from 'three';
import HOUSE from '../../data/house.json';
import { doorFrame, attach, applyT, invertT, doorCoords, crossed } from '../core/layout.js';
import { inView } from '../core/observe.js';

const LIGHT_RANGE = 4.0; // must match tools/blender/build_house.py
const SWING = 1.8;

export const toThree = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
// Yaw that turns a wall prop (which faces plan -y) to face along the inward wall normal n.
export const wallYaw = (n) => Math.atan2(n[1], n[0]) + Math.PI / 2;

// Glossy baked surfaces (floors, worktops, tiles) pick up a blurred, box-projected reflection of their own room, so
// windows and lamps streak across the lino the way they should. Works in the room's local coordinates.
function addReflection(material, uniforms, gloss) {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uGloss: { value: gloss } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoomPos;\nvarying vec3 vRoomN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoomPos = position;\nvRoomN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform samplerCube uEnv; uniform vec3 uCam; uniform vec3 uMin; uniform vec3 uMax; uniform vec3 uProbe; uniform float uGloss; uniform float uEnvOn;
varying vec3 vRoomPos; varying vec3 vRoomN;`)
      .replace('#include <tonemapping_fragment>', `if (uEnvOn > 0.5) {
  vec3 V = normalize(vRoomPos - uCam);
  vec3 N = normalize(vRoomN);
  vec3 Rr = reflect(V, N);
  vec3 tm = max((uMax - vRoomPos) / Rr, (uMin - vRoomPos) / Rr);
  vec3 hit = vRoomPos + Rr * min(min(tm.x, tm.y), tm.z);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
  vec3 env = textureLod(uEnv, hit - uProbe, (1.0 - uGloss) * 5.5).rgb;
  gl_FragColor.rgb += env * fres * (0.35 + uGloss);
}
#include <tonemapping_fragment>`);
  };
}

class RoomMaterials {
  constructor(lightmap, assets, size) {
    const [w, d, h] = size;
    this.reflect = {
      uEnv: { value: null }, uEnvOn: { value: 0 }, uCam: { value: new THREE.Vector3() },
      uMin: { value: new THREE.Vector3(0, 0, -d) }, uMax: { value: new THREE.Vector3(w, h, 0) }, uProbe: { value: new THREE.Vector3(w / 2, 1.25, -d / 2) },
    };
    this.lightmap = lightmap;
    this.boost = 1;
    this.assets = assets;
    this.cache = new Map();
    this.all = [];
  }

  register(m) { this.all.push(m); return m; }

  map(spec) {
    if (!spec.tex) return null;
    const t = this.assets.tex(spec.tex, { wrap: spec.fit ? 'clamp' : spec.wrap });
    if (t && !spec.fit) t.repeat.set(1 / (spec.tile ?? 1), 1 / (spec.tile ?? 1));
    return t;
  }

  // Baked surfaces: albedo times the room's lightmap, untouched by the real-time lights.
  baked(name) {
    const key = `b:${name}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const spec = HOUSE.materials[name] ?? { color: '#ff00ff' };
    const map = this.map(spec);
    let m;
    if (spec.emit) {
      m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(map ? '#ffffff' : spec.color).multiplyScalar(map ? 1.25 : 3.0) });
    } else {
      m = new THREE.MeshBasicMaterial({ map, color: map ? (spec.tint ?? '#ffffff') : spec.color, lightMap: this.lightmap, lightMapIntensity: Math.PI * LIGHT_RANGE * this.boost });
      if ((spec.gloss ?? 0) > 0.3) addReflection(m, this.reflect, spec.gloss);
      if (name.startsWith('curtain') || name === 'shade') m.side = THREE.DoubleSide;
    }
    this.cache.set(key, this.register(m));
    return m;
  }

  // Loose props: lit in real time by the room's lamps.
  lit(name) {
    const key = `l:${name}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const spec = HOUSE.materials[name] ?? { color: '#ff00ff' };
    const map = this.map(spec);
    const m = new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : spec.color, roughness: 1 - (spec.gloss ?? 0.05), metalness: name === 'brass' || name === 'metal' ? 0.35 : 0 });
    this.cache.set(key, this.register(m));
    return m;
  }

  stencil(ref) {
    if (this.ref === ref) return;
    this.ref = ref;
    for (const m of this.all) {
      m.stencilWrite = ref !== null;
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilRef = ref ?? 0;
    }
  }
}

// Is any part of the doorway's opening actually on screen? Unlike the generous sphere test this is exact enough to
// say "it is behind you" while the player is backing into it.
function doorOnScreen(cam, f, margin) {
  // looking straight at it from close up, every sample point can fall off screen: test the line of sight too
  const along = cam.fwd[0] * f.n[0] + cam.fwd[1] * f.n[1];
  if (along > 1e-6) {
    const t = ((f.inner[0] - cam.pos[0]) * f.n[0] + (f.inner[1] - cam.pos[1]) * f.n[1]) / along;
    if (t > 0) {
      const hx = cam.pos[0] + cam.fwd[0] * t - f.inner[0];
      const hy = cam.pos[1] + cam.fwd[1] * t - f.inner[1];
      const s = f.at + hx * f.a[0] + hy * f.a[1];
      const z = cam.pos[2] + cam.fwd[2] * t;
      if (s > f.s0 && s < f.s1 && z > 0 && z < f.h) return true;
    }
  }
  for (let i = 0; i <= 4; i++) {
    const s = f.s0 + (f.w * i) / 4;
    const x = f.inner[0] + f.a[0] * (s - f.at);
    const y = f.inner[1] + f.a[1] * (s - f.at);
    for (const z of [0.1, 0.6, 1.1, 1.62, f.h - 0.08]) if (inView(cam, [x, y, z], 0, margin)) return true;
  }
  return false;
}

export class World {
  constructor(scene, assets, events) {
    this.scene = scene;
    this.events = events;
    this.rooms = {};
    this.current = 'hall';
    this.visible = new Set();
    this.tmp = new THREE.Vector3();
    this.masks = new THREE.Group();
    this.masks.renderOrder = 1;
    scene.add(this.masks);

    for (const [name, def] of Object.entries(HOUSE.rooms)) {
      const group = new THREE.Group();
      group.name = name;
      group.visible = false;
      scene.add(group);
      const lm = assets.tex(`lm/${name}`, { wrap: 'clamp' });
      lm.channel = 1;
      lm.anisotropy = 1;
      const mats = new RoomMaterials(lm, assets, def.size);
      mats.boost = def.boost ?? 1;
      for (const node of [...assets.house.children]) {
        if (!node.name.startsWith(`${name}_`)) continue;
        group.add(node);
        node.traverse((m) => { if (m.isMesh) m.material = mats.baked(m.material.name); });
      }
      const room = { name, def, group, mats, doors: {}, colliders: assets.meta[name].colliders.map((c) => [...c]), lights: assets.meta[name].lights };
      for (const d of def.doors) {
        const frame = doorFrame(HOUSE, def, d);
        const mask = new THREE.Mesh(new THREE.PlaneGeometry(frame.w, frame.h), new THREE.MeshBasicMaterial({
          colorWrite: false, depthWrite: false, side: THREE.DoubleSide, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
        }));
        mask.position.copy(toThree(frame.p[0], frame.p[1], frame.h / 2));
        mask.rotation.y = Math.atan2(frame.a[1], frame.a[0]);
        mask.visible = false;
        this.masks.add(mask);
        room.doors[d.id] = {
          id: d.id, frame, mask,
          leaf: group.getObjectByName(`${name}_leaf_${d.id}`), veil: group.getObjectByName(`${name}_veil_${d.id}`), arch: group.getObjectByName(`${name}_frame_${d.id}`),
          state: { veil: d.veil ? 'solid' : 'none', open: 0, target: 0, opener: null, ends: [{ room: name, id: d.id }], unseen: 0, pendingUnveil: false },
        };
      }
      this.rooms[name] = room;
    }
  }

  door(room, id) { return this.rooms[room].doors[id]; }

  // Photographs each room from its middle into a cube map: the source of floor reflections and of the light
  // that falls on loose props.
  captureEnvironments(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const keep = this.current;
    const nowhere = { pos: [0, 0, -50], fwd: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0], tanH: 0.01, tanV: 0.01 };
    for (const room of Object.values(this.rooms)) {
      const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const cube = new THREE.CubeCamera(0.05, 40, target);
      cube.position.copy(room.mats.reflect.uProbe.value);
      this.current = room.name;
      this.update(0, { eyesClosed: false, cam: nowhere, pos: [-50, -50] });
      room.mats.reflect.uEnvOn.value = 0;
      cube.update(renderer, this.scene);
      room.mats.reflect.uEnv.value = target.texture;
      room.env = pmrem.fromCubemap(target.texture).texture;
    }
    for (const room of Object.values(this.rooms)) room.mats.reflect.uEnvOn.value = 1;
    this.current = keep;
    pmrem.dispose();
  }

  // Draw order: current room (0), portal masks (1), rooms seen through a doorway (2). three.js takes the order from
  // the nearest enclosing Group, so every nested group has to carry it.
  order(room, value) {
    if (room.order === value) return;
    room.order = value;
    room.group.traverse((o) => { if (o.isGroup) o.renderOrder = value; });
  }

  // Joins two doorways into one door with a shared state.
  link(roomA, idA, roomB, idB, veil) {
    const a = this.door(roomA, idA);
    const b = this.door(roomB, idB);
    a.state.ends = [{ room: roomA, id: idA }, { room: roomB, id: idB }];
    if (veil) a.state.veil = veil;
    b.state = a.state;
  }

  other(roomName, door) {
    const end = door.state.ends.find((e) => !(e.room === roomName && e.id === door.id));
    return end ? { room: this.rooms[end.room], door: this.rooms[end.room].doors[end.id] } : null;
  }

  // Door ids of the current room that can be walked through right now.
  passable(eyesClosed) {
    return Object.values(this.rooms[this.current].doors)
      .filter((d) => d.state.ends.length === 2 && (d.state.open > 0.8 || (d.state.veil === 'eyes' && eyesClosed) || (d.state.veil === 'seen' && d.state.clear)))
      .map((d) => d.id);
  }

  // Is the player standing inside a doorway that only exists with their eyes shut?
  inBlindDoorway(pos, r) {
    return Object.values(this.rooms[this.current].doors).some((d) => {
      if (d.state.veil !== 'eyes') return false;
      const c = doorCoords(d.frame, pos);
      return c.out > -d.frame.T - r + 0.02 && c.s > d.frame.s0 && c.s < d.frame.s1;
    });
  }

  // Points a doorway at a different room: whatever was on the other side of that room's door is cut loose.
  relink(roomA, idA, roomB, idB) {
    const fresh = (ends) => ({ veil: 'none', open: 0, target: 0, opener: null, ends, unseen: 0, pendingUnveil: false });
    const a = this.door(roomA, idA);
    const b = this.door(roomB, idB);
    const old = this.other(roomB, b);
    if (old && old.door !== a) old.door.state = fresh([{ room: old.room.name, id: old.door.id }]);
    a.state = fresh([{ room: roomA, id: idA }, { room: roomB, id: idB }]);
    b.state = a.state;
  }

  open(door) {
    const st = door.state;
    if (st.open > 0 || st.target > 0) return;
    st.target = 1;
    st.opener = this.current;
    st.unseen = 0;
    this.events.emit('door-open', door);
  }

  // If the step prev -> next leaves through a doorway, moves the player into the room beyond.
  // Returns { pos, turn } in the new room's coordinates, or null.
  cross(prev, next, eyesClosed) {
    const cur = this.rooms[this.current];
    for (const id of this.passable(eyesClosed)) {
      const d = cur.doors[id];
      if (!crossed(d.frame, prev, next)) continue;
      const o = this.other(cur.name, d);
      const t = attach(d.frame, o.door.frame);
      this.current = o.room.name;
      this.events.emit('enter', o.room.name, cur.name);
      return { pos: applyT(invertT(t), next), turn: -t.rot };
    }
    return null;
  }

  update(dt, { eyesClosed, cam, pos, camWorld = null }) {
    const cur = this.rooms[this.current];
    for (const d of Object.values(cur.doors)) {
      const st = d.state;
      // the doorway itself, and the space an open leaf swings into
      const seen = !eyesClosed && (inView(cam, [d.frame.inner[0], d.frame.inner[1], 1.0], 1.15, 0.12)
        || inView(cam, [d.frame.hinge[0] - d.frame.n[0] * 0.5, d.frame.hinge[1] - d.frame.n[1] * 0.5, 1.0], 1.2, 0.12));
      st.unseen = seen ? 0 : st.unseen + dt;
      if (st.veil === 'seen') {
        // a doorway that is only there while nobody looks at it; if it has to close in plain sight, it waits for a blink
        const c = doorCoords(d.frame, pos);
        const inSlot = c.out > -d.frame.T - 0.23 && c.s > d.frame.s0 && c.s < d.frame.s1;
        const watched = !eyesClosed && doorOnScreen(cam, d.frame, 0.12);
        st.away = watched ? 0 : (st.away ?? 0) + dt;
        if (st.sealing && eyesClosed) { if (!inSlot) { st.clear = false; st.away = 0; } st.sealing = false; } // never seal on top of the player
        else if (!watched) { if (st.away > 0.6) st.clear = true; }
        else if (st.clear && !inSlot) {
          if (doorOnScreen(cam, d.frame, 0)) { st.sealing = true; this.events.emit('need-blink'); } else st.clear = false;
        }
      }
      if (st.pendingUnveil && st.unseen > 0.5) {
        st.veil = 'none'; st.pendingUnveil = false;
        this.events.emit('unveiled', d);
      }
      if (st.open !== st.target) {
        const step = dt / 0.9;
        st.open = st.target > st.open ? Math.min(st.target, st.open + step) : Math.max(st.target, st.open - step);
      }
      const dist = Math.hypot(pos[0] - d.frame.p[0], pos[1] - d.frame.p[1]);
      // doors are never seen closing: they are simply shut again once you look back
      if (st.open === 1 && st.unseen > 2.5 && dist > 1.5) {
        st.open = 0; st.target = 0; st.opener = null;
        this.events.emit('door-shut', d, dist);
      }
    }

    for (const r of Object.values(this.rooms)) r.group.visible = false;
    for (const m of this.masks.children) m.visible = false;
    this.visible.clear();
    cur.group.visible = true;
    cur.group.position.set(0, 0, 0);
    cur.group.rotation.y = 0;
    this.order(cur, 0);
    cur.mats.stencil(null);
    this.visible.add(cur.name);
    let ref = 1;
    for (const d of Object.values(cur.doors)) {
      const o = this.other(cur.name, d);
      d.T = o ? attach(d.frame, o.door.frame) : null;
      if (!o || this.visible.has(o.room.name)) continue;
      if (!(d.state.open > 0 || (d.state.veil === 'eyes' && eyesClosed) || (d.state.veil === 'seen' && d.state.clear))) continue;
      const g = o.room.group;
      g.visible = true;
      g.position.set(d.T.tx, 0, -d.T.ty);
      g.rotation.y = d.T.rot;
      this.order(o.room, 2);
      this.visible.add(o.room.name);
      // standing in the doorway the portal quad would clip against the near plane, so drop the mask there
      const c = doorCoords(d.frame, pos);
      const close = c.out > -0.8 && Math.abs(c.s - d.frame.at) < d.frame.w / 2 + 0.35;
      o.room.mats.stencil(close ? null : ref);
      d.mask.visible = !close;
      d.mask.material.stencilRef = ref;
      ref += 1;
    }
    for (const r of Object.values(this.rooms)) if (!this.visible.has(r.name)) r.order = null; // props may be added while hidden
    for (const name of this.visible) {
      const room = this.rooms[name];
      if (camWorld) room.mats.reflect.uCam.value.copy(room.group.worldToLocal(this.tmp.copy(camWorld)));
      for (const d of Object.values(room.doors)) {
        const st = d.state;
        const veiled = st.veil === 'solid' || (st.veil === 'eyes' && !eyesClosed) || (st.veil === 'seen' && !st.clear);
        const blind = st.veil === 'eyes' || st.veil === 'seen';
        if (d.veil) d.veil.visible = veiled;
        if (d.arch) d.arch.visible = !veiled && !blind;
        // rooms are only drawn one doorway deep, so a neighbour's other doors always look shut
        const o = this.other(name, d);
        const shut = name !== cur.name && !(o && o.room.name === cur.name);
        if (d.leaf) {
          d.leaf.visible = !veiled && !blind && (shut || st.open === 0 || st.opener === name);
          const k = !shut && st.opener === name ? st.open : 0;
          d.leaf.rotation.y = d.frame.swing * SWING * (k * k * (3 - 2 * k));
        }
      }
    }
  }
}
