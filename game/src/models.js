// A small synchronous reader for the Blender-built GLB (inlined into the page as base64), so the scene can keep
// being assembled at module top level. Supports what the exporter writes for these models: one primitive per mesh
// with POSITION, NORMAL, COLOR_0 (RGBA: albedo + emission mask) and indices.
import * as THREE from 'three';

const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const NORMALISE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export function decodeBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// Returns { name: { position, normal, color, index } } as plain typed arrays (floats for the vertex data).
export function parseGLB(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error('unsupported GLB version');
  let json = null;
  let bin = null;
  for (let off = 12; off < dv.getUint32(8, true);) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, off + 8, len)));
    else if (type === 0x004e4942) bin = new Uint8Array(buffer, off + 8, len);
    off += 8 + len;
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or BIN chunk');

  const read = (index, asFloat) => {
    const acc = json.accessors[index];
    const view = json.bufferViews[acc.bufferView];
    const Type = COMPONENTS[acc.componentType];
    const n = SIZES[acc.type];
    if (!Type || !n) throw new Error(`unsupported accessor ${acc.componentType}/${acc.type}`);
    const start = bin.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = view.byteStride ?? Type.BYTES_PER_ELEMENT * n;
    const src = new DataView(bin.buffer, start);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[acc.componentType];
    const out = asFloat ? new Float32Array(acc.count * n) : new Uint32Array(acc.count * n);
    const k = asFloat && acc.normalized ? 1 / NORMALISE[acc.componentType] : 1;
    const signed = acc.normalized && (acc.componentType === 5120 || acc.componentType === 5122);
    for (let i = 0; i < acc.count; i++) {
      for (let c = 0; c < n; c++) {
        const v = src[get](i * stride + c * Type.BYTES_PER_ELEMENT, true) * k;
        out[i * n + c] = signed ? Math.max(v, -1) : v;
      }
    }
    return { array: out, size: n };
  };

  const models = {};
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const prim = json.meshes[node.mesh].primitives[0];
    const position = read(prim.attributes.POSITION, true).array;
    const count = position.length / 3;
    const normal = read(prim.attributes.NORMAL, true).array;
    const color = new Float32Array(count * 4);
    if (prim.attributes.COLOR_0 !== undefined) {
      const c = read(prim.attributes.COLOR_0, true);
      for (let i = 0; i < count; i++) {
        color[i * 4] = c.array[i * c.size];
        color[i * 4 + 1] = c.array[i * c.size + 1];
        color[i * 4 + 2] = c.array[i * c.size + 2];
        color[i * 4 + 3] = c.size === 4 ? c.array[i * 4 + 3] : 0;
      }
    } else {
      for (let i = 0; i < count; i++) color.set([1, 1, 1, 0], i * 4); // white, and not emissive
    }
    const index = prim.indices !== undefined ? read(prim.indices, false).array : Uint32Array.from({ length: count }, (_, i) => i);
    models[node.name] = { position, normal, color, index };
  }
  return models;
}

// A fresh BufferGeometry for a model (aColor: rgb albedo, a emission). Optionally scaled, turned about Y, moved and tinted.
export function modelGeometry(m, { scale = 1, rotY = 0, at = [0, 0, 0], tint = null } = {}) {
  const g = new THREE.BufferGeometry();
  const n = m.position.length / 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  for (let i = 0; i < n; i++) {
    const x = m.position[i * 3];
    const y = m.position[i * 3 + 1];
    const z = m.position[i * 3 + 2];
    pos[i * 3] = (x * c + z * s) * scale + at[0];
    pos[i * 3 + 1] = y * scale + at[1];
    pos[i * 3 + 2] = (-x * s + z * c) * scale + at[2];
    const nx = m.normal[i * 3];
    const nz = m.normal[i * 3 + 2];
    nor[i * 3] = nx * c + nz * s;
    nor[i * 3 + 1] = m.normal[i * 3 + 1];
    nor[i * 3 + 2] = -nx * s + nz * c;
  }
  let col = m.color;
  if (tint) {
    col = new Float32Array(m.color);
    for (let i = 0; i < n; i++) {
      col[i * 4] *= tint[0];
      col[i * 4 + 1] *= tint[1];
      col[i * 4 + 2] *= tint[2];
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  return g;
}
