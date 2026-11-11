// Unpacks what build.mjs inlined into the page: the two Blender GLBs, the lightmaps and the images.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const bytes = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

export async function loadAssets(data, renderer) {
  const loader = new GLTFLoader();
  const [house, props] = await Promise.all([loader.parseAsync(bytes(data.house), ''), loader.parseAsync(bytes(data.props), '')]);
  const images = {};
  await Promise.all(Object.entries(data.img).map(async ([name, b64]) => {
    const im = new Image();
    im.src = `data:image/webp;base64,${b64}`;
    await im.decode();
    images[name] = im;
  }));
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const cache = new Map();

  // Textures follow the glTF convention (no vertical flip) so they line up with the exported UVs.
  const tex = (name, { wrap = 'mirror' } = {}) => {
    if (cache.has(name)) return cache.get(name);
    let t = null;
    if (name === '@grid') t = gridTexture();
    else if (images[name]) t = new THREE.Texture(images[name]);
    if (t) {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = wrap === 'repeat' || name === '@grid' ? THREE.RepeatWrapping : wrap === 'clamp' ? THREE.ClampToEdgeWrapping : THREE.MirroredRepeatWrapping;
      t.anisotropy = aniso;
      t.needsUpdate = true;
    }
    cache.set(name, t);
    return t;
  };
  return { house: house.scene, props: props.scene, meta: data.meta, tex, has: (name) => Boolean(images[name]) };
}

// The look of a room the Host never finished: a modelling-tool test grid.
function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8b8b8b'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#7d7d7d'; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
  g.strokeStyle = '#a4a4a4'; g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  g.strokeStyle = '#c9c9c9'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
