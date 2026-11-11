import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGLB, modelGeometry, decodeBase64 } from '../src/models.js';

const file = readFileSync(new URL('../assets/qingyun.glb', import.meta.url));
const glb = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const meta = JSON.parse(readFileSync(new URL('../assets/meta.json', import.meta.url), 'utf8'));
const models = parseGLB(glb);

test('every model in the metadata is read from the GLB with the right triangle count', () => {
  assert.deepEqual(Object.keys(models).sort(), Object.keys(meta).sort());
  for (const [name, m] of Object.entries(models)) {
    assert.equal(m.index.length / 3, meta[name].tris, `${name} triangles`);
    assert.equal(m.normal.length, m.position.length);
    assert.equal(m.color.length / 4, m.position.length / 3);
    assert.ok(Math.max(...m.index) < m.position.length / 3, `${name} index in range`);
  }
});

test('vertex data is sane: unit normals, colours in range, bounds match the metadata (Y-up)', () => {
  for (const [name, m] of Object.entries(models)) {
    let maxY = -Infinity;
    for (let i = 0; i < m.position.length; i += 3) {
      maxY = Math.max(maxY, m.position[i + 1]);
      const l = Math.hypot(m.normal[i], m.normal[i + 1], m.normal[i + 2]);
      assert.ok(l === 0 || Math.abs(l - 1) < 0.02, `${name} normal length ${l}`);
    }
    assert.ok(Math.abs(maxY - meta[name].max[2]) < 0.01, `${name}: Blender Z-up became Y-up`);
    for (const c of m.color) assert.ok(c >= 0 && c <= 1.0001, `${name} colour ${c}`);
  }
  assert.ok(models.sword.color.some((c, i) => i % 4 === 3 && c > 0.9), 'the sword carries emissive runes');
});

test('modelGeometry scales, turns, moves and tints without touching the source', () => {
  const m = models.pine0;
  const before = Float32Array.from(m.color);
  const g = modelGeometry(m, { scale: 2, rotY: Math.PI / 2, at: [10, 5, -3], tint: [0.5, 1, 1] });
  const p = g.getAttribute('position');
  // rotating +90 degrees about Y maps +Z to +X
  assert.ok(Math.abs(p.getX(0) - (m.position[2] * 2 + 10)) < 1e-4);
  assert.ok(Math.abs(p.getY(0) - (m.position[1] * 2 + 5)) < 1e-4);
  assert.ok(Math.abs(p.getZ(0) - (-m.position[0] * 2 - 3)) < 1e-4);
  assert.ok(Math.abs(g.getAttribute('aColor').getX(0) - m.color[0] * 0.5) < 1e-6);
  assert.deepEqual(m.color, before);
});

test('a truncated or foreign file is rejected, and base64 decoding round-trips', () => {
  assert.throws(() => parseGLB(new ArrayBuffer(16)), /not a GLB/);
  assert.deepEqual(new Uint8Array(decodeBase64(file.toString('base64'))).slice(0, 4), new Uint8Array(glb).slice(0, 4));
});

test('a model exported without vertex colours comes out white and not emissive', () => {
  // Rebuild the GLB with COLOR_0 removed from every primitive.
  const dv = new DataView(glb);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen)));
  for (const mesh of json.meshes) delete mesh.primitives[0].attributes.COLOR_0;
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const enc = new TextEncoder().encode(text);
  const rest = new Uint8Array(glb, 20 + jsonLen);
  const out = new Uint8Array(20 + enc.length + rest.length);
  out.set(new Uint8Array(glb, 0, 20));
  out.set(enc, 20);
  out.set(rest, 20 + enc.length);
  const odv = new DataView(out.buffer);
  odv.setUint32(8, out.length, true);
  odv.setUint32(12, enc.length, true);
  const plain = parseGLB(out.buffer).sword;
  assert.deepEqual([...plain.color.slice(0, 4)], [1, 1, 1, 0]);
  assert.ok(plain.color.every((c, i) => (i % 4 === 3 ? c === 0 : c === 1)));
});
