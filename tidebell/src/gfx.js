// Renderer, shared uniforms, the tileable noise texture and the HDR post-processing chain.
import * as THREE from 'three';
import { hash2 } from './noise.js';
import * as S from './shaders.js';

const SUN_ABOVE = new THREE.Vector3(0.38, 0.82, -0.43).normalize();
// Snell's law: the direction sunlight travels underwater, flipped to point back toward the sun.
function refractedSun() {
  const inc = SUN_ABOVE.clone().negate();
  const n = new THREE.Vector3(0, 1, 0);
  const eta = 1 / 1.333;
  const cosi = -n.dot(inc);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  return inc.multiplyScalar(eta).add(n.multiplyScalar(eta * cosi - Math.sqrt(k))).negate().normalize();
}

// Uniforms shared by reference across every material.
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: refractedSun() },
  uSunAbove: { value: SUN_ABOVE },
  uLampPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  uLampDir: { value: new THREE.Vector3(0, 0, -1) },
  uLampOn: { value: 0 },
  uGlowPos: { value: Array.from({ length: S.NUM_GLOW }, () => new THREE.Vector4(0, -9999, 0, 1)) },
  uGlowCol: { value: Array.from({ length: S.NUM_GLOW }, () => new THREE.Vector3()) },
  uSonar: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSubPos: { value: new THREE.Vector3() },
  uGlobalGlow: { value: 1 },
  uReveal: { value: new THREE.Vector4(0, 0, 0, -1) },
  uNoise: { value: null },
  uPx: { value: 1000 },
};

// 512x512 tileable texture. R: fbm, G: worley F1, B: cell-edge ridges (caustic network), A: second fbm.
function makeNoiseTexture() {
  const N = 512;
  const data = new Uint8Array(N * N * 4);
  // Periodic gradient (Perlin) noise in [0, 1]: avoids the lattice-aligned look of value noise.
  const fade5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const vnoise = (x, y, period, seed) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const dx = x - ix;
    const dy = y - iy;
    const g = (i, j, ox, oy) => {
      const a = hash2(((i % period) + period) % period, ((j % period) + period) % period, seed) * Math.PI * 2;
      return Math.cos(a) * ox + Math.sin(a) * oy;
    };
    const a = g(ix, iy, dx, dy);
    const b = g(ix + 1, iy, dx - 1, dy);
    const c = g(ix, iy + 1, dx, dy - 1);
    const d = g(ix + 1, iy + 1, dx - 1, dy - 1);
    const fx = fade5(dx);
    const fy = fade5(dy);
    return Math.min(1, Math.max(0, 0.5 + 0.85 * (a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy)));
  };
  const fbm = (u, v, seed) => {
    let sum = 0;
    let amp = 0.5;
    let f = 4;
    for (let o = 0; o < 6; o++) {
      sum += amp * vnoise(u * f, v * f, f, seed + o);
      amp *= 0.5;
      f *= 2;
    }
    return sum / 0.984;
  };
  const C = 10;
  const worley = (u, v) => {
    const x = u * C;
    const y = v * C;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const wx = ((cx % C) + C) % C;
        const wy = ((cy % C) + C) % C;
        const d = Math.hypot(cx + hash2(wx, wy, 91) - x, cy + hash2(wx, wy, 92) - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    }
    return [f1, f2];
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const [f1, f2] = worley(u, v);
      const i = (y * N + x) * 4;
      data[i] = Math.min(255, fbm(u, v, 1) * 255);
      data[i + 1] = Math.min(255, f1 * 220);
      data[i + 2] = Math.max(0, 255 * (1 - (f2 - f1) / 0.42));
      data[i + 3] = Math.min(255, fbm(u, v, 40) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function shared(extra = {}) {
  return { ...U, ...extra };
}

export function createGfx(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  U.uNoise.value = makeNoiseTexture();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.25, 1400);

  const sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
  sceneRT.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
  const mkRT = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  const shaftRT = mkRT();
  const shaftBlurRT = mkRT();
  const bloom = [0, 1, 2, 3].map(() => ({ a: mkRT(), b: mkRT() }));

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: S.fsVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const shaftMat = pass(S.shaftFrag, shared({
    tDepth: { value: sceneRT.depthTexture }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
  }));
  const brightMat = pass(S.brightFrag, { tScene: { value: sceneRT.texture }, tShafts: { value: shaftBlurRT.texture }, uThreshold: { value: 1.15 } });
  const blurMat = pass(S.blurFrag, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
  const finalMat = pass(S.finalFrag, {
    tScene: { value: sceneRT.texture }, tShafts: { value: shaftBlurRT.texture },
    tBloom0: { value: bloom[0].a.texture }, tBloom1: { value: bloom[1].a.texture }, tBloom2: { value: bloom[2].a.texture }, tBloom3: { value: bloom[3].a.texture },
    uTime: U.uTime, uExposure: { value: 1 }, uPressure: { value: 0 }, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Vector3(0.4, 1, 0.9) }, uFade: { value: 0 },
  });

  const draw = (mat, target) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quad, quadCam);
  };
  const blur = (src, tmp, dst) => {
    blurMat.uniforms.tSrc.value = src.texture;
    blurMat.uniforms.uDir.value.set(1 / src.width, 0);
    draw(blurMat, tmp);
    blurMat.uniforms.tSrc.value = tmp.texture;
    blurMat.uniforms.uDir.value.set(0, 1 / tmp.height);
    draw(blurMat, dst);
  };

  let quality = 1;
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * quality;
    renderer.setPixelRatio(1);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const W = Math.max(2, Math.round(w * dpr));
    const H = Math.max(2, Math.round(h * dpr));
    renderer.setSize(W, H, false);
    sceneRT.setSize(W, H);
    shaftRT.setSize(W >> 1, H >> 1);
    shaftBlurRT.setSize(W >> 1, H >> 1);
    bloom.forEach((b, i) => {
      b.a.setSize(Math.max(2, W >> (i + 1)), Math.max(2, H >> (i + 1)));
      b.b.setSize(Math.max(2, W >> (i + 1)), Math.max(2, H >> (i + 1)));
    });
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    U.uPx.value = H / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  window.addEventListener('resize', resize);
  resize();

  function render() {
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);

    shaftMat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    shaftMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    shaftMat.uniforms.uCamPos.value.copy(camera.position);
    draw(shaftMat, shaftRT);
    blur(shaftRT, bloom[0].b, shaftBlurRT);

    draw(brightMat, bloom[0].a);
    blur(bloom[0].a, bloom[0].b, bloom[0].a);
    for (let i = 1; i < bloom.length; i++) {
      blur(bloom[i - 1].a, bloom[i].b, bloom[i].a);
      blur(bloom[i].a, bloom[i].b, bloom[i].a);
    }
    draw(finalMat, null);
  }

  return {
    renderer, scene, camera, render, post: finalMat.uniforms,
    setQuality(q) {
      quality = q;
      resize();
    },
  };
}
