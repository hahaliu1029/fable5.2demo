// Loads the Blender-built GLB (inlined into the page as base64) and exposes geometries by name.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';

function decode(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// Blender is Z-up; the exporter converted meshes to Y-up, so convert metadata points the same way.
export const b2t = (p) => [p[0], p[2], -p[1]];

export async function loadAssets() {
  const buf = decode(document.getElementById('glb').textContent.trim());
  const meta = JSON.parse(document.getElementById('meta').textContent);
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const geo = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    let col = g.getAttribute('color');
    if (!col) {
      col = new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 4).fill(1), 4);
    } else if (col.itemSize === 3) {
      const a = new Float32Array(col.count * 4);
      for (let i = 0; i < col.count; i++) a.set([col.getX(i), col.getY(i), col.getZ(i), 0], i * 4);
      col = new THREE.BufferAttribute(a, 4);
    }
    g.deleteAttribute('color');
    g.setAttribute('aColor', col);
    g.computeBoundingSphere();
    geo[o.name] = g;
  });
  for (const name of Object.keys(meta)) if (!geo[name]) throw new Error(`asset missing from GLB: ${name}`);
  return { geo, meta };
}
