// Qingyun Sect gate at dawn — fully procedural Three.js scene.
// Everything (geometry, textures, text, noise) is generated in code from a fixed seed.
// The whole frame is a pure function of time: window.renderFrame(t).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const W = 1080, H = 1920, DURATION = 10;
const CAPTURE = location.hash.includes('capture');
const SCALE = parseFloat(new URLSearchParams(location.search).get('scale') || '1');
const DBG = parseInt(new URLSearchParams(location.search).get('dbg') || '0', 10); // debug views of intermediate buffers
const RW = Math.round(W * SCALE), RH = Math.round(H * SCALE);
const SS = 2; // supersampling factor: every pass runs at SS x resolution, the final pass box-filters down
const IW = RW * SS, IH = RH * SS;

// ---------------------------------------------------------------- RNG + noise
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NS = 64;
const noiseData = new Uint8Array(NS * NS * NS);
{
  const r = mulberry32(20261110);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.floor(r() * 256);
}
const wrap = (i) => ((i % NS) + NS) % NS;
// Same lattice value noise as the GLSL version (which samples the same 3D texture).
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const x0 = wrap(xi), x1 = wrap(xi + 1), y0 = wrap(yi) * NS, y1 = wrap(yi + 1) * NS;
  const z0 = wrap(zi) * NS * NS, z1 = wrap(zi + 1) * NS * NS;
  const d = noiseData;
  const a = d[x0 + y0 + z0] + (d[x1 + y0 + z0] - d[x0 + y0 + z0]) * fx;
  const b = d[x0 + y1 + z0] + (d[x1 + y1 + z0] - d[x0 + y1 + z0]) * fx;
  const c = d[x0 + y0 + z1] + (d[x1 + y0 + z1] - d[x0 + y0 + z1]) * fx;
  const e = d[x0 + y1 + z1] + (d[x1 + y1 + z1] - d[x0 + y1 + z1]) * fx;
  const ab = a + (b - a) * fy, ce = c + (e - c) * fy;
  return (ab + (ce - ab) * fz) / 255;
}
function fbm(x, y, z, oct = 4) {
  let a = 0.5, s = 0;
  for (let k = 0; k < oct; k++) {
    s += a * vnoise(x, y, z);
    x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.2; a *= 0.5;
  }
  return s;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(RW, RH, false);
renderer.setClearColor(0x000000, 1);
{
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  console.log('GL renderer:', ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown');
}

const camera = new THREE.PerspectiveCamera(50, W / H, 0.5, 8000);
const scene = new THREE.Scene();
const world = new THREE.Group(); // everything that gets mirrored for the lake reflection
scene.add(world);

const noiseTex = new THREE.Data3DTexture(noiseData, NS, NS, NS);
noiseTex.format = THREE.RedFormat; noiseTex.type = THREE.UnsignedByteType;
noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter;
noiseTex.wrapS = noiseTex.wrapT = noiseTex.wrapR = THREE.RepeatWrapping;
noiseTex.unpackAlignment = 1; noiseTex.needsUpdate = true;

const SUN_DIR = new THREE.Vector3(0.13, 0.367, -1).normalize();
// Uniform objects shared by reference between all materials.
const U = {
  uNoise: { value: noiseTex },
  uTime: { value: 0 },
  uSunDir: { value: SUN_DIR },
  uCamTrue: { value: new THREE.Vector3() },
  uMirror: { value: 1 },
  uRes: { value: new THREE.Vector2(IW, IH) },
};

// ---------------------------------------------------------------- GLSL
const COMMON = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uCamTrue;
uniform float uMirror;
const vec3 SUN_COL = vec3(1.0, 0.60, 0.34) * 3.4;

float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return texture(uNoise, (i+f+0.5)/64.0).r;
}
float fbm4(vec3 p){
  float a = 0.5, s = 0.0;
  for(int k=0;k<4;k++){ s += a*vnoise(p); p = p*2.03 + vec3(17.1,3.7,9.2); a *= 0.5; }
  return s;
}
float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }

vec3 skyBase(vec3 d){
  float h = clamp(d.y, 0.0, 1.0);
  float sd = max(dot(d, uSunDir), 0.0);
  float az = max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz)), 0.0);
  float w = pow(az, 24.0);
  vec3 hor = mix(vec3(0.50,0.50,0.62), vec3(0.92,0.60,0.38), w);
  vec3 mid = mix(vec3(0.30,0.42,0.66), vec3(0.46,0.50,0.68), w);
  vec3 zen = vec3(0.09,0.19,0.42);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.26, h));
  c = mix(c, zen, smoothstep(0.22, 0.85, h));
  c += vec3(1.0,0.50,0.20) * pow(sd, 10.0) * 0.30;
  c += vec3(1.0,0.74,0.46) * pow(sd, 90.0) * 0.55;
  return c;
}
vec3 fogColor(vec3 dir){
  float az = max(dot(normalize(dir.xz + 1e-5), normalize(uSunDir.xz)), 0.0);
  return mix(vec3(0.42,0.46,0.58), vec3(0.86,0.60,0.42), pow(az, 24.0));
}
// Analytic exponential height fog (aerial perspective) between camera and wp.
vec3 applyFog(vec3 col, vec3 wp){
  vec3 v = wp - uCamTrue; float d = length(v); vec3 dir = v / d;
  float b = 0.010, a = 0.0012;
  float dy = dir.y; if (abs(dy) < 1e-4) dy = 1e-4;
  float amt = a * exp(-uCamTrue.y*b) * (1.0 - exp(-d*dy*b)) / (dy*b);
  float f = 1.0 - exp(-max(amt, 0.0));
  return mix(col, fogColor(dir), f);
}
`;

const SURF_VERT = /* glsl */ `
uniform float uMirror;
varying vec3 vWp; varying vec3 vN; varying vec3 vObj; varying vec2 vUv;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // "true" world space: undo the y-mirror applied to the world group in the reflection pass
  vWp = wp.xyz * vec3(1.0, uMirror, 1.0);
  vN = (mat3(modelMatrix) * normal) * vec3(1.0, uMirror, 1.0);
  vObj = position; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const K = { PEAK: 0, TERRAIN: 1, STONE: 2, ROOF: 3, PLAQUE: 4, PINE: 5, FROCK: 6, RED: 7, LANTERN: 8 };
const SURF_FRAG = COMMON + /* glsl */ `
varying vec3 vWp; varying vec3 vN; varying vec3 vObj; varying vec2 vUv;
uniform sampler2D uMap;

vec3 shade(vec3 alb, vec3 N, vec3 wp, float spec){
  vec3 V = normalize(uCamTrue - wp);
  float ndl = dot(N, uSunDir);
  vec3 amb = mix(vec3(0.25,0.24,0.29), vec3(0.50,0.55,0.70), N.y*0.5+0.5);
  float back = max(dot(N, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  amb += vec3(0.50,0.30,0.15) * back * 0.5;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0) * smoothstep(-0.2, 0.6, ndl);
  vec3 c = alb * (SUN_COL * max(ndl, 0.0) + amb) + SUN_COL * alb * rim * 0.6;
  if (spec > 0.0) c += SUN_COL * spec * pow(max(dot(reflect(-V, N), uSunDir), 0.0), 48.0);
  return c;
}
vec3 rockAlb(vec3 p){
  float n = fbm4(p * vec3(0.05, 0.12, 0.05));
  vec3 rock = mix(vec3(0.30,0.28,0.28), vec3(0.52,0.47,0.43), n);
  rock *= 0.78 + 0.44 * vnoise(vec3(p.x*0.35, p.y*0.04, p.z*0.35));
  return rock;
}
void main(){
  if (uMirror < 0.0 && vWp.y < 0.0) discard; // nothing below the water plane is reflected
  vec3 N = normalize(vN);
  vec3 wp = vWp;
  vec3 col;
#if KIND == 0
  N = normalize(N + (vec3(vnoise(wp*0.33), vnoise(wp*0.33+7.3), vnoise(wp*0.33+13.9)) - 0.5) * 0.7);
  vec3 alb = rockAlb(wp);
  float veg = smoothstep(0.30, 0.62, N.y + (fbm4(wp*0.06) - 0.47) * 1.1);
  vec3 green = mix(vec3(0.07,0.13,0.08), vec3(0.15,0.23,0.11), vnoise(wp*0.4));
  alb = mix(alb, green, veg);
  col = shade(alb, N, wp, 0.0);
#elif KIND == 1
  float n = fbm4(wp * 0.15);
  N = normalize(N + (vec3(vnoise(wp*0.8), 0.5, vnoise(wp*0.8+5.1)) - 0.5) * 0.35);
  vec3 grass = mix(vec3(0.07,0.13,0.06), vec3(0.17,0.22,0.09), n);
  vec3 rock = mix(vec3(0.28,0.27,0.27), vec3(0.45,0.42,0.39), vnoise(wp*0.6));
  vec3 alb = mix(rock, grass, smoothstep(0.60, 0.84, N.y + (n-0.5)*0.3));
  alb *= mix(0.5, 1.0, smoothstep(0.0, 0.9, wp.y));
  col = shade(alb, N, wp, 0.0);
#elif KIND == 2
  float n = fbm4(wp * 1.3);
  vec3 alb = mix(vec3(0.34,0.33,0.33), vec3(0.52,0.50,0.47), n);
  alb *= 0.93 + 0.14 * vnoise(wp * 3.1);
  float moss = smoothstep(0.50, 0.72, vnoise(wp*0.9 + 3.0)) * (1.0 - smoothstep(1.4, 5.5, wp.y));
  alb = mix(alb, vec3(0.16,0.22,0.13), moss * 0.6);
  alb *= mix(0.62, 1.0, smoothstep(0.0, 0.7, wp.y)); // wet band at the waterline
  col = shade(alb, N, wp, 0.0);
#elif KIND == 3
  if (!gl_FrontFacing) N = -N;
  float st = 0.5 + 0.5 * sin(vUv.x * 6.2832 / 0.30);
  vec3 alb = mix(vec3(0.035,0.085,0.10), vec3(0.10,0.23,0.25), st);
  alb = mix(alb, vec3(0.50,0.38,0.16), (1.0 - smoothstep(0.03, 0.07, vUv.y)));
  col = shade(alb, N, wp, 0.35 * st);
#elif KIND == 4
  vec3 tex = texture2D(uMap, vUv).rgb;
  col = shade(tex, N, wp, 0.0);
  float lum = dot(tex, vec3(0.3,0.6,0.1));
  col += tex * smoothstep(0.22, 0.6, lum) * 0.75; // gilded characters stay legible in shade
#elif KIND == 5
  vec3 alb = vec3(0.05,0.11,0.07) * (0.7 + 0.7 * vnoise(wp * 1.7));
  col = shade(alb, N, wp, 0.0);
#elif KIND == 6
  vec3 p = vObj * 9.0;
  N = normalize(N + (vec3(vnoise(p*0.5), vnoise(p*0.5+7.3), vnoise(p*0.5+13.9)) - 0.5) * 0.6);
  vec3 alb = rockAlb(p * 2.0) * 1.05;
  float top = smoothstep(0.45, 0.8, N.y + (vnoise(p*0.6)-0.5)*0.4);
  alb = mix(alb, vec3(0.13,0.22,0.10), top);
  col = shade(alb, N, wp, 0.0);
#elif KIND == 7
  vec3 alb = vec3(0.40,0.075,0.055) * (0.8 + 0.4 * vnoise(wp * 5.0));
  col = shade(alb, N, wp, 0.0);
#else
  col = vec3(1.0,0.55,0.22) * (4.2 + 0.5 * sin(uTime*7.0 + wp.x) * sin(uTime*3.1));
#endif
  col = applyFog(col, wp);
  gl_FragColor = vec4(col, 1.0);
}`;

function surfMat(kind, extra = {}) {
  return new THREE.ShaderMaterial({
    defines: { KIND: kind },
    uniforms: { ...U, uMap: { value: extra.map || null } },
    vertexShader: SURF_VERT, fragmentShader: SURF_FRAG,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- geometry helpers
// Parametric surface with finite-difference normals. P(u,v) -> [x,y,z].
function paramSurface(nu, nv, P, flip = false, uvFn = null) {
  const n = (nu + 1) * (nv + 1);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const e = 1e-3; let k = 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) {
    const u = i / nu, v = j / nv;
    const p = P(u, v);
    const ua = Math.max(u - e, 0), ub = Math.min(u + e, 1), va = Math.max(v - e, 0), vb = Math.min(v + e, 1);
    const pa = P(ua, v), pb = P(ub, v), pc = P(u, va), pd = P(u, vb);
    const dux = pb[0] - pa[0], duy = pb[1] - pa[1], duz = pb[2] - pa[2];
    const dvx = pd[0] - pc[0], dvy = pd[1] - pc[1], dvz = pd[2] - pc[2];
    let nx = duy * dvz - duz * dvy, ny = duz * dvx - dux * dvz, nz = dux * dvy - duy * dvx;
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { nx = 0; ny = flip ? -1 : 1; nz = 0; l = 1; }
    const s = (flip ? -1 : 1) / l;
    pos.set(p, k * 3); nor.set([nx * s, ny * s, nz * s], k * 3);
    uv.set(uvFn ? uvFn(u, v) : [u, v], k * 2);
  }
  const idx = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = i + j * (nu + 1), b = a + 1, c = a + nu + 1, d = c + 1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// ---------------------------------------------------------------- sky dome
const skyMat = new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: /* glsl */ `varying vec3 vDir; uniform float uMirror;
    void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vDir = (wp.xyz - cameraPosition)*vec3(1.0,uMirror,1.0);
      gl_Position = projectionMatrix*viewMatrix*wp; }`,
  fragmentShader: COMMON + /* glsl */ `
    varying vec3 vDir;
    float cov(vec2 uv){ return smoothstep(0.47, 0.74, fbm4(vec3(uv, uTime*0.012))); }
    void main(){
      vec3 d = normalize(vDir);
      vec3 col = skyBase(d);
      float sd = max(dot(d, uSunDir), 0.0);
      float trans = 1.0;
      if (d.y > 0.0) {
        // broken high cloud layer projected on a plane, lit from the sun side
        vec2 drift = vec2(uTime*0.020, uTime*0.006);
        vec2 uv = d.xz / (d.y + 0.14) * 1.5;
        vec2 suv = uSunDir.xz / (uSunDir.y + 0.14) * 1.5;
        float c0 = cov(uv + drift) * smoothstep(0.04, 0.22, d.y);
        vec2 ld = normalize(suv - uv + 1e-4);
        float c1 = cov(uv + drift + ld * 0.22);
        float lit = exp(-2.6 * c1);
        vec3 cl = mix(vec3(0.30,0.30,0.42), vec3(1.0,0.74,0.52) * 1.05, lit);
        cl += vec3(1.0,0.55,0.25) * pow(sd, 8.0) * lit * 1.0;
        col = mix(col, cl, c0 * 0.88);
        trans = 1.0 - c0 * 0.88;
      }
      col += vec3(1.0,0.86,0.62) * (smoothstep(0.99990, 0.99996, sd) * 40.0 + pow(sd, 2500.0) * 4.0) * trans;
      gl_FragColor = vec4(col, trans); // alpha = sun visibility through the high clouds (used by the light shafts)
    }`,
  side: THREE.BackSide, depthWrite: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), skyMat);
sky.frustumCulled = false;
scene.add(sky);

// ---------------------------------------------------------------- peaks
function makeSpire(cx, cz, HH, R, seed) {
  const rnd = mulberry32(seed);
  const ox = rnd() * 50, oy = rnd() * 50, oz = rnd() * 50;
  const la = rnd() * Math.PI * 2, lean = rnd() * 0.07 * HH;
  const pw = 0.75 + rnd() * 0.5, base = -8;
  return paramSurface(56, 60, (u, v) => {
    const th = u * Math.PI * 2, y = base + v * (HH - base);
    const cs = Math.cos(th), sn = Math.sin(th);
    const prof = (0.52 + 0.48 * Math.pow(1 - v, pw)) * Math.pow(1 - Math.pow(v, 4), 0.6);
    const n1 = fbm(cs * 1.3 + ox, y * 0.02 + oy, sn * 1.3 + oz, 4);
    const n2 = fbm(cs * 4.2 + ox, y * 0.07 + oy, sn * 4.2 + oz, 3);
    const ledge = vnoise(ox, y * 0.085 + oy, oz) * 0.6 + vnoise(ox + 9, y * 0.23 + oy, oz) * 0.4;
    const lobes = 1 + 0.16 * Math.sin(th * 3 + ox) * (1 - v) + 0.10 * Math.sin(th * 5 + oz + y * 0.02);
    const r = R * 0.66 * prof * lobes * (0.40 + 1.2 * n1) * (0.70 + 0.60 * n2) * (0.72 + 0.56 * ledge);
    return [cx + cs * r + Math.cos(la) * lean * v * v, y, cz + sn * r + Math.sin(la) * lean * v * v];
  }, true);
}
{
  const rnd = mulberry32(777);
  const mains = [
    // near layer
    [-46, -95, 72, 17], [50, -120, 58, 15], [-80, -150, 96, 22], [86, -170, 90, 20],
    // middle layer
    [-70, -260, 150, 32], [30, -300, 116, 26], [108, -280, 142, 30], [-150, -330, 172, 36],
    // tall back layer
    [-22, -470, 278, 48], [128, -520, 222, 44], [-172, -500, 236, 46], [214, -560, 252, 50], [-98, -610, 204, 40], [56, -640, 180, 40],
  ];
  const geos = [];
  let seed = 100;
  for (const [x, z, hh, r] of mains) {
    geos.push(makeSpire(x, z, hh, r, seed++));
    const sats = 2 + Math.floor(rnd() * 2);
    for (let s = 0; s < sats; s++) {
      const a = rnd() * Math.PI * 2, dd = r * (0.65 + rnd() * 0.5);
      geos.push(makeSpire(x + Math.cos(a) * dd, z + Math.sin(a) * dd * 0.6, hh * (0.4 + rnd() * 0.35), r * (0.42 + rnd() * 0.25), seed++));
    }
  }
  for (let i = 0; i < 16; i++) { // far silhouettes
    geos.push(makeSpire(-480 + rnd() * 960, -760 - rnd() * 300, 200 + rnd() * 210, 45 + rnd() * 40, seed++));
  }
  world.add(new THREE.Mesh(mergeGeometries(geos), surfMat(K.PEAK)));
}

// ---------------------------------------------------------------- terrain (lake shore, hills)
function terrainH(x, z) {
  const ax = Math.abs(x);
  const zs = 10 + 0.018 * x * x; // shoreline curves toward the viewer at the sides
  const dz = zs - z;
  let h = -2.0 + 3.4 * smooth(0, 7, dz);
  const side = smooth(9, 32, ax);
  const n = fbm(x * 0.03 + 5.2, 1.3, z * 0.03 + 9.1, 4);
  h += side * smooth(0, 25, dz) * (5 + 34 * n);
  h += (1 - side) * smooth(-8, -27, z) * 4.8; // rise under the stairway behind the gate
  h += (fbm(x * 0.2, 7.7, z * 0.2, 3) - 0.45) * 1.2 * smooth(1, 6, dz) * (0.3 + side);
  return lerp(h, -8, smooth(-48, -90, z));
}
world.add(new THREE.Mesh(
  paramSurface(220, 170, (u, v) => { const x = -140 + 280 * u, z = -95 + 170 * v; return [x, terrainH(x, z), z]; }, true),
  surfMat(K.TERRAIN)));

// ---------------------------------------------------------------- terrace, stairs, paifang gate
const Y0 = 1.5; // terrace top
const stoneG = [], roofG = [], redG = [], lampG = [];
stoneG.push(box(22, 3.5, 16, 0, Y0 - 1.75, -1));
for (let k = 0; k < 4; k++) { // steps down into the lake
  const top = Y0 - 0.3 * (k + 1);
  stoneG.push(box(10, top + 2, 0.6, 0, (top - 2) / 2, 7.3 + 0.6 * k));
}
for (let k = 0; k < 16; k++) { // stairway behind the gate, climbing toward the sect
  const top = Y0 + 0.3 * (k + 1);
  stoneG.push(box(7, top, 1.2, 0, top / 2, -9.6 - 1.2 * k));
}

function makeRoof(L, D, h, up, x0, y0, z0) {
  const surf = paramSurface(48, 20, (u, v) => {
    const uu = 2 * u - 1, vv = 2 * v - 1;
    const a = 1 - Math.abs(vv), b = (1 - Math.abs(uu)) * L / D;
    const e = Math.min(a, b);
    const y = h * Math.pow(e, 1.5) + up * Math.pow(Math.abs(uu), 4) * (0.3 + 0.7 * vv * vv);
    return [x0 + uu * L / 2, y0 + y, z0 + vv * D / 2];
  }, true, (u, v) => {
    const uu = 2 * u - 1, vv = 2 * v - 1;
    const a = 1 - Math.abs(vv), b = (1 - Math.abs(uu)) * L / D;
    return [a < b ? uu * L / 2 : vv * D / 2, Math.min(a, b)];
  });
  roofG.push(surf);
  const rl = Math.max(L - D * 0.95, 0.2);
  const ridge = box(rl, 0.36, 0.24, x0, y0 + h + 0.08, z0);
  // uv.y > 0.07 on boxes would pick the gold trim for part of them; push uv away from the trim band
  const fixUv = (g) => { const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * 0.3, 0.5); return g; };
  roofG.push(fixUv(ridge));
  if (L > 3) for (const s of [-1, 1]) { // ridge-end ornaments (skipped on the tiny lantern roofs)
    const orn = new THREE.BoxGeometry(0.28, 0.75, 0.28).rotateZ(-s * 0.35).translate(x0 + s * rl / 2, y0 + h + 0.36, z0);
    roofG.push(fixUv(orn));
  }
  redG.push(box(L * 0.88, 0.14, D * 0.84, x0, y0 - 0.02, z0));
}

for (const [x, hh, s] of [[-3.4, 10, 0.8], [3.4, 10, 0.8], [-7, 7.5, 0.7], [7, 7.5, 0.7]]) {
  stoneG.push(box(s, hh, s, x, Y0 + hh / 2, 0));
  stoneG.push(box(s + 0.5, 0.9, 2.5, x, Y0 + 0.45, 0));
  stoneG.push(box(s + 0.26, 0.35, s + 0.26, x, Y0 + 1.1, 0));
  for (const sz of [-1, 1]) {
    stoneG.push(new THREE.CylinderGeometry(0.62, 0.62, 0.36, 20).rotateZ(Math.PI / 2).translate(x, Y0 + 1.3, sz * 0.98));
  }
}
// centre bay
stoneG.push(box(7.7, 0.7, 0.7, 0, Y0 + 6.65, 0));
stoneG.push(box(6.0, 2.4, 0.3, 0, Y0 + 8.2, 0));
stoneG.push(box(7.7, 0.6, 0.7, 0, Y0 + 9.7, 0));
redG.push(box(8.2, 0.3, 1.3, 0, Y0 + 10.15, 0));
redG.push(box(8.9, 0.2, 1.9, 0, Y0 + 10.4, 0));
makeRoof(10.6, 4.0, 1.5, 0.95, 0, Y0 + 10.5, 0);
// side bays
for (const sx of [-1, 1]) {
  stoneG.push(box(4.3, 0.55, 0.6, sx * 5.2, Y0 + 4.9, 0));
  stoneG.push(box(3.0, 1.5, 0.25, sx * 5.2, Y0 + 5.9, 0));
  stoneG.push(box(4.3, 0.5, 0.6, sx * 5.2, Y0 + 6.9, 0));
  redG.push(box(4.6, 0.25, 1.1, sx * 5.4, Y0 + 7.3, 0));
  redG.push(box(5.0, 0.18, 1.6, sx * 5.5, Y0 + 7.5, 0));
  makeRoof(6.0, 3.2, 1.15, 0.7, sx * 5.6, Y0 + 7.6, 0);
}
// stone lanterns flanking the lake steps
for (const sx of [-1, 1]) {
  const x = sx * 6.4, z = 5.6;
  stoneG.push(box(0.8, 0.25, 0.8, x, Y0 + 0.125, z));
  stoneG.push(box(0.36, 1.5, 0.36, x, Y0 + 1.0, z));
  stoneG.push(box(0.9, 0.14, 0.9, x, Y0 + 1.8, z));
  lampG.push(box(0.56, 0.6, 0.56, x, Y0 + 2.17, z));
  makeRoof(1.5, 1.5, 0.5, 0.22, x, Y0 + 2.47, z);
}
world.add(new THREE.Mesh(mergeGeometries(stoneG), surfMat(K.STONE)));
world.add(new THREE.Mesh(mergeGeometries(roofG), surfMat(K.ROOF)));
world.add(new THREE.Mesh(mergeGeometries(redG), surfMat(K.RED)));
world.add(new THREE.Mesh(mergeGeometries(lampG), surfMat(K.LANTERN)));

// plaque: the characters are drawn with the Canvas 2D API (system CJK font, no image assets)
const PLAQUE_TEXT = '青云宗';
{
  const cw = 1400, ch = 544;
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#0d1626'); bg.addColorStop(1, '#070c16');
  g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
  const gold = g.createLinearGradient(0, 0, 0, ch);
  gold.addColorStop(0, '#ffe7a0'); gold.addColorStop(0.55, '#f2c25a'); gold.addColorStop(1, '#c88a2a');
  g.strokeStyle = gold; g.lineWidth = 22; g.strokeRect(18, 18, cw - 36, ch - 36);
  g.lineWidth = 5; g.strokeRect(50, 50, cw - 100, ch - 100);
  g.fillStyle = gold; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 330px "Songti SC","STSong","Kaiti SC","STKaiti","PingFang SC","Heiti SC","Hiragino Sans GB","Noto Serif CJK SC",serif';
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 14; g.shadowOffsetY = 6;
  const xs = [cw * 0.2, cw * 0.5, cw * 0.8];
  [...PLAQUE_TEXT].forEach((chr, i) => g.fillText(chr, xs[i], ch * 0.52));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 2.14), surfMat(K.PLAQUE, { map: tex }));
  m.position.set(0, Y0 + 8.2, 0.36); m.rotation.x = 0.09;
  world.add(m);
}

// ---------------------------------------------------------------- pines
function pineGeo(h, x, y, z) {
  const parts = [new THREE.CylinderGeometry(0.05 * h, 0.07 * h, 0.4 * h, 6).translate(0, 0.2 * h, 0)];
  const tiers = [[0.30, 0.45, 0.28], [0.24, 0.40, 0.52], [0.16, 0.36, 0.76]];
  for (const [r, hh, yy] of tiers) parts.push(new THREE.ConeGeometry(r * h, hh * h, 8).translate(0, (yy + hh / 2) * h, 0));
  return parts.map((g) => g.translate(x, y, z));
}
{
  const rnd = mulberry32(4242), geos = [];
  let tries = 0;
  while (geos.length < 150 * 4 && tries++ < 4000) {
    const x = -70 + rnd() * 140, z = -62 + rnd() * 90;
    const ax = Math.abs(x), zs = 10 + 0.018 * x * x;
    const h = terrainH(x, z);
    if (ax < 11 || z > zs - 3 || h < 1.2 || h > 36) continue;
    geos.push(...pineGeo(3.2 + rnd() * 3.6, x, h - 0.3, z));
  }
  world.add(new THREE.Mesh(mergeGeometries(geos), surfMat(K.PINE)));
}

// ---------------------------------------------------------------- floating rocks
function rockGeo(seed) {
  const rnd = mulberry32(seed), ox = rnd() * 40, oy = rnd() * 40, oz = rnd() * 40;
  return paramSurface(44, 30, (u, v) => {
    const lon = u * Math.PI * 2, lat = (v - 0.5) * Math.PI;
    const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
    const r = 0.62 + 0.75 * fbm(dx * 1.5 + ox, dy * 1.5 + oy, dz * 1.5 + oz, 4);
    let y = dy * r;
    if (y > 0) y *= 0.32;
    else y *= 1.5 + 1.4 * fbm(dx * 2.6 + ox, 3.3, dz * 2.6 + oz, 3); // jagged underside
    return [dx * r, y, dz * r];
  }, true);
}
const rocks = [];
{
  const rockMat = surfMat(K.FROCK), pineMat = surfMat(K.PINE);
  const rnd = mulberry32(99);
  const defs = [
    // x, y, z, scale, pine?
    [-8.5, 12.5, 16, 2.0, false], [10.8, 18.5, -6, 2.5, true], [-12.5, 21, -30, 3.4, true],
    [16, 29, -72, 5.0, true], [-24, 35, -115, 6.5, false], [-4, 46, -190, 8.0, true], [30, 44, -150, 5.5, false],
  ];
  defs.forEach(([x, y, z, s, pine], i) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(rockGeo(500 + i), rockMat); m.scale.setScalar(s); g.add(m);
    if (pine) {
      const p = new THREE.Mesh(mergeGeometries(pineGeo(s * 0.75, s * 0.15, s * 0.16, -s * 0.1)), pineMat);
      g.add(p);
    }
    const debris = [];
    for (let k = 0; k < 3; k++) {
      const dm = new THREE.Mesh(rockGeo(900 + i * 7 + k), rockMat);
      dm.scale.setScalar(s * (0.1 + rnd() * 0.14));
      const a = rnd() * Math.PI * 2, rr = s * (1.3 + rnd() * 0.9);
      const base = new THREE.Vector3(Math.cos(a) * rr, (rnd() - 0.6) * s * 1.2, Math.sin(a) * rr);
      dm.position.copy(base); g.add(dm);
      debris.push({ m: dm, base, ph: rnd() * 6.28, T: 4 + rnd() * 3 });
    }
    g.position.set(x, y, z);
    world.add(g);
    rocks.push({ g, y, amp: 0.35 + s * 0.14, T: 6.5 + rnd() * 3.5, ph: rnd() * 6.28, rot: rnd() * 6.28, rs: (rnd() - 0.5) * 0.06, debris });
  });
}

// ---------------------------------------------------------------- lake
const waterMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uRefl: { value: null } },
  vertexShader: SURF_VERT,
  fragmentShader: COMMON + /* glsl */ `
    varying vec3 vWp;
    uniform sampler2D uRefl; uniform vec2 uRes;
    const vec4 RC[5] = vec4[5](vec4(-6.0,30.0,6.0,0.5), vec4(5.0,22.0,7.5,3.0), vec4(-2.0,45.0,5.5,4.2), vec4(8.0,38.0,8.0,6.0), vec4(-10.0,18.0,6.5,1.7));
    float rings(vec2 q){
      float s = 0.0;
      for(int i=0;i<5;i++){
        float age = mod(uTime + RC[i].w, RC[i].z);
        float front = age * 2.0;
        float x = length(q - RC[i].xy) - front;
        s += sin(x*5.0) * exp(-x*x*0.45) * exp(-age*0.4) * smoothstep(0.0, 0.5, age) / (1.0 + front*0.35);
      }
      return s;
    }
    float height(vec2 q){
      float t = uTime;
      return vnoise(vec3(q*0.45 + vec2(0.07,0.03)*t, t*0.16)) * 0.13
           + vnoise(vec3(q*1.3 - vec2(0.05,0.09)*t, 4.0 + t*0.27)) * 0.045
           + rings(q) * 0.035;
    }
    void main(){
      vec3 toCam = uCamTrue - vWp; float d = length(toCam); vec3 V = toCam / d;
      vec2 q = vWp.xz; float e = 0.07;
      float h0 = height(q), hx = height(q + vec2(e,0.0)), hz = height(q + vec2(0.0,e));
      float fade = 1.0 / (1.0 + d*0.02); // far ripples fade out to avoid shimmer
      vec2 slope = vec2(hx-h0, hz-h0) / e * fade;
      vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
      // planar reflection: the mirrored scene was rendered with the same camera, so it is sampled at this
      // fragment's own screen position, offset by the ripple normal.
      vec2 uv = gl_FragCoord.xy / uRes + N.xz * vec2(0.06, 0.13) / (1.0 + d*0.015);
      uv = clamp(uv, vec2(0.002), vec2(0.998));
      vec3 refl = texture2D(uRefl, uv).rgb;
      float F = mix(0.46, 1.0, pow(1.0 - max(dot(N, V), 0.0), 3.0));
      vec3 col = mix(vec3(0.012,0.045,0.06), refl * 0.96, F);
      col += SUN_COL * pow(max(dot(reflect(-V, N), uSunDir), 0.0), 700.0) * 1.2;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000).rotateX(-Math.PI / 2), waterMat);
scene.add(water);

// ---------------------------------------------------------------- spirit-energy particles
const fxScene = new THREE.Scene();
const fxGroup = new THREE.Group(); fxScene.add(fxGroup);
const partMat = new THREE.ShaderMaterial({
  uniforms: { ...U, tDepth: { value: null }, uProjScale: { value: IH / (2 * Math.tan((50 * Math.PI) / 360)) } },
  vertexShader: /* glsl */ `
    uniform float uTime, uProjScale;
    attribute vec4 aSeed;
    varying float vViewZ; varying vec4 vSeed; varying float vFade;
    void main(){
      vec3 p = position;
      float sp = 0.22 + aSeed.x * 0.55;
      p.y = 0.2 + mod(p.y + uTime * sp, 21.0);
      p.x += sin(uTime*0.45 + aSeed.y*6.283) * (0.6 + aSeed.z);
      p.z += cos(uTime*0.37 + aSeed.w*6.283) * (0.6 + aSeed.x);
      vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
      vViewZ = -mv.z; vSeed = aSeed;
      vFade = smoothstep(0.2, 1.6, p.y) * (1.0 - smoothstep(16.0, 21.2, p.y)) * smoothstep(2.0, 6.0, vViewZ);
      float size = 0.10 + 0.22 * aSeed.z * aSeed.z;
      gl_PointSize = clamp(size * uProjScale / max(vViewZ, 0.1), 1.5, 64.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDepth; uniform vec2 uRes; uniform float uTime;
    varying float vViewZ; varying vec4 vSeed; varying float vFade;
    void main(){
      float dz = texture2D(tDepth, gl_FragCoord.xy / uRes).r * 2.0 - 1.0;
      float sceneZ = 2.0*0.5*8000.0 / (8000.5 - dz*7999.5);
      if (vViewZ > sceneZ) discard; // manual depth test against the opaque scene
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float a = exp(-r*r*5.0) * 0.55 + exp(-r*r*40.0) * 1.0;
      a *= (1.0 - smoothstep(0.7, 1.0, r));
      float tw = 0.55 + 0.45 * sin(uTime * (1.5 + vSeed.y*2.5) + vSeed.w * 6.283);
      vec3 c = mix(vec3(1.0,0.80,0.42), vec3(0.50,0.95,0.86), step(0.62, vSeed.w));
      gl_FragColor = vec4(c * a * tw * vFade * 2.2, 1.0);
    }`,
  // additive on RGB only; alpha is left untouched because rtComp.a is the light-shaft source
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  depthTest: false, depthWrite: false, transparent: true,
});
{
  const N = 760, rnd = mulberry32(31337);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.87;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    if (rnd() < 0.6) pos.set([gauss() * 9, rnd() * 21, 2 + gauss() * 9], i * 3);
    else pos.set([-24 + rnd() * 48, rnd() * 21, -18 + rnd() * 76], i * 3);
    seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const pts = new THREE.Points(g, partMat); pts.frustumCulled = false;
  fxGroup.add(pts);
}

// ---------------------------------------------------------------- render targets + post passes
function makeRT(w, h, depth) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: depth, generateMipmaps: false,
  });
  if (depth) { rt.depthTexture = new THREE.DepthTexture(w, h); rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter; }
  return rt;
}
const rtMirrorScene = makeRT(IW, IH, true), rtMirror = makeRT(IW, IH, false);
const rtScene = makeRT(IW, IH, true), rtComp = makeRT(IW, IH, false);
const rtRays = makeRT(RW, RH, false);
const BW = Math.round(RW / 4), BH = Math.round(RH / 4);
const rtB0 = makeRT(BW, BH, false), rtB1 = makeRT(BW, BH, false);

const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null); fsQuad.frustumCulled = false; fsScene.add(fsQuad);
function fsMat(frag, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({ uniforms, defines, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
}
function pass(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }

// Volumetric pass: ray-marched sea of clouds + drifting mist, composited over the scene using its depth buffer.
const CLOUD_FRAG = COMMON + /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor, tDepth;
uniform mat4 uInvVP;
const float YMAX = 300.0;

float density(vec3 p){
  float r = length(p.xz - vec2(0.0, 15.0));
  vec3 w = vec3(2.6, 0.0, 0.8) * uTime; // wind
  float d = 0.0;
  // sea of clouds: clear pocket around the lake, billowing tops further out
  float sea = smoothstep(60.0, 170.0, r);
  if (sea > 0.0) {
    float nl = vnoise(vec3((p.xz + w.xz*1.5) * 0.0045, 1.7 + uTime*0.012));
    float top = 16.0 + min(r, 600.0) * (0.15 + 0.31 * nl);
    float h = p.y / top;
    if (h < 1.0) {
      float base = fbm4((p + w) * vec3(0.012, 0.030, 0.012) + vec3(0.0, uTime*0.02, 0.0));
      float v = base * 1.6 + (1.0 - h) * 0.50 - 1.0;
      d += sea * clamp(v * 5.0, 0.0, 1.0) * 0.09 * (1.0 - smoothstep(0.92, 1.0, h));
    }
  }
  // thin mist bank drifting behind the gate
  float bank = smoothstep(-20.0, -60.0, p.z) * (1.0 - sea);
  if (bank > 0.0 && p.y < 30.0) {
    float mn = fbm4((p + w*1.7) * vec3(0.030, 0.085, 0.030));
    d += bank * (1.0 - smoothstep(2.0, 30.0, p.y)) * clamp((mn - 0.42) * 3.0, 0.0, 1.0) * 0.020;
  }
  // low wisps over the lake
  if (p.y < 5.0) {
    float ln = fbm4(vec3((p.xz + w.xz*0.8) * 0.055, p.y*0.3 + uTime*0.05));
    d += (1.0 - smoothstep(0.2, 5.0, p.y)) * clamp((ln - 0.45) * 4.0, 0.0, 1.0) * 0.017 * smoothstep(5.0, 16.0, length(p.xz - uCamTrue.xz));
  }
  return d;
}

void main(){
  vec4 scene = texture2D(tColor, vUv);
  float depth = texture2D(tDepth, vUv).r;
  vec4 w4 = uInvVP * vec4(vUv*2.0-1.0, depth*2.0-1.0, 1.0);
  vec3 wp = w4.xyz / w4.w; wp.y *= uMirror;
  vec3 ro = uCamTrue; vec3 rv = wp - ro; float sd = length(rv); vec3 rd = rv / sd;
  bool isSky = depth > 0.99999;
  float tmin = 0.0, tmax = isSky ? 1600.0 : min(sd, 1600.0);
  if (rd.y > 0.0) { tmax = min(tmax, (YMAX - ro.y) / rd.y); if (ro.y < 0.0) tmin = -ro.y / rd.y; }
  else if (ro.y < 0.0) tmax = tmin;

  float cosT = dot(rd, uSunDir);
  float ph = 0.30 + 0.95 * pow(max(cosT, 0.0), 6.0);
  vec3 fc = fogColor(rd);
  float jit = ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.0); float T = 1.0; float prev = tmin;
  if (tmax > tmin) {
    for (int i = 0; i < STEPS; i++) {
      float t1 = tmin + (tmax - tmin) * pow((float(i) + 1.0) / float(STEPS), 1.6);
      float dt = t1 - prev; float t = prev + dt * jit; prev = t1;
      vec3 p = ro + rd * t;
      float dn = density(p);
      if (dn > 0.0004) {
        float dl = density(p + uSunDir * 18.0);
        float sh = exp(-dl * 18.0 * 1.5);
        vec3 amb = mix(vec3(0.24,0.28,0.40), vec3(0.56,0.58,0.70), clamp(p.y / 55.0, 0.0, 1.0));
        vec3 lit = SUN_COL * sh * ph * 0.42 + amb;
        lit = mix(lit, fc, 1.0 - exp(-t * 0.0006));
        float a = 1.0 - exp(-dn * dt);
        acc += T * a * lit; T *= 1.0 - a;
        if (T < 0.01) break;
      }
    }
  }
  vec3 col = scene.rgb * T + acc;
  if (DBG == 4) col = scene.rgb;
  if (DBG == 5) col = vec3(T);
  // alpha: unoccluded sun glow, the source for the screen-space light shafts
  float src = isSky ? T * scene.a * (pow(max(cosT, 0.0), 220.0) * 0.45 + smoothstep(0.99990, 0.99996, cosT) * 14.0) : 0.0;
  gl_FragColor = vec4(col, src);
}`;
const mkCloud = (steps) => fsMat(CLOUD_FRAG, { ...U, tColor: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() } }, { STEPS: steps, DBG });
const cloudMain = mkCloud(110), cloudMirror = mkCloud(64);

const sunUV = new THREE.Vector2();
const raysMat = fsMat(/* glsl */ `
  precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uSunUV;
  float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }
  void main(){
    vec2 d = uSunUV - vUv; float jit = ign(gl_FragCoord.xy);
    float acc = 0.0, w = 1.0, ws = 0.0;
    for (int i = 0; i < 90; i++) {
      vec2 uv = vUv + d * ((float(i) + jit) / 90.0) * 0.98;
      float s = texture2D(tSrc, uv).a;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) s = 0.0;
      acc += s * w; ws += w; w *= 0.982;
    }
    gl_FragColor = vec4(vec3(acc / ws), 1.0);
  }`, { tSrc: { value: rtComp.texture }, uSunUV: { value: sunUV } });

const brightMat = fsMat(/* glsl */ `
  precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
  void main(){
    vec3 c = vec3(0.0);
    for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++)
      c += min(texture2D(tSrc, vUv + (vec2(float(x), float(y)) - 1.5) * 2.0 * uTexel).rgb, vec3(16.0));
    c /= 16.0;
    float l = dot(c, vec3(0.3, 0.6, 0.1));
    gl_FragColor = vec4(min(c * smoothstep(1.3, 3.0, l), vec3(12.0)), 1.0);
  }`, { tSrc: { value: rtComp.texture }, uTexel: { value: new THREE.Vector2(1 / IW, 1 / IH) } });
const blurMat = fsMat(/* glsl */ `
  precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uDir;
  void main(){
    vec3 c = vec3(0.0); float ws = 0.0;
    for (int i = -8; i <= 8; i++) { float w = exp(-float(i*i) / 22.0); c += texture2D(tSrc, vUv + uDir * float(i) * 2.2).rgb * w; ws += w; }
    gl_FragColor = vec4(c / ws, 1.0);
  }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });

const finalMat = fsMat(/* glsl */ `
  precision highp float; varying vec2 vUv;
  uniform sampler2D tComp, tRays, tBloom; uniform float uTime;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03)) / (x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
  void main(){
    vec3 c = texture2D(tComp, vUv).rgb;
    c += pow(texture2D(tRays, vUv).r, 1.6) * vec3(1.0, 0.66, 0.36) * 0.6;
    c += texture2D(tBloom, vUv).rgb * 0.30;
    if (DBG == 1 || DBG >= 4) c = texture2D(tComp, vUv).rgb;
    if (DBG == 2) c = texture2D(tRays, vUv).rrr;
    if (DBG == 3) c = texture2D(tBloom, vUv).rgb;
    vec2 q = vUv - 0.5;
    c *= 1.0 - dot(q, q) * 0.55;
    c = aces(c * 0.85);
    c = pow(c, vec3(1.0 / 2.2));
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);                 // gentle contrast
    c += (hash(gl_FragCoord.xy + floor(uTime * 30.0 + 0.5) * 17.0) - 0.5) * 0.012; // deterministic grain
    gl_FragColor = vec4(c, 1.0);
  }`, { tComp: { value: rtComp.texture }, tRays: { value: rtRays.texture }, tBloom: { value: rtB0.texture }, uTime: U.uTime }, { DBG });

// ---------------------------------------------------------------- animation (pure function of t)
const look = new THREE.Vector3(), tmpV = new THREE.Vector3(), invVP = new THREE.Matrix4();
function update(t) {
  U.uTime.value = t;
  const s = Math.min(Math.max(t / DURATION, 0), 1);
  const e = s * 0.45 + 0.55 * (s * s * (3 - 2 * s)); // eased, never fully stopping
  camera.position.set(lerp(-1.4, 0.4, e), lerp(2.3, 3.0, e), lerp(62, 41, e));
  look.set(0, lerp(8.6, 9.6, e), 0);
  camera.lookAt(look);
  camera.updateMatrixWorld(true);
  sky.position.copy(camera.position);
  for (const r of rocks) {
    r.g.position.y = r.y + Math.sin((t / r.T) * 6.2832 + r.ph) * r.amp;
    r.g.rotation.y = r.rot + t * r.rs;
    r.g.rotation.z = Math.sin((t / (r.T * 1.3)) * 6.2832 + r.ph * 2) * 0.03;
    for (const d of r.debris) d.m.position.y = d.base.y + Math.sin((t / d.T) * 6.2832 + d.ph) * 0.35;
  }
}

function renderFrame(t) {
  update(t);
  invVP.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);

  // 1. mirrored world -> reflection (scene, then its own cloud pass, then particles)
  U.uMirror.value = -1;
  U.uCamTrue.value.set(camera.position.x, -camera.position.y, camera.position.z);
  world.scale.y = -1; fxGroup.scale.y = -1; water.visible = false;
  renderer.setRenderTarget(rtMirrorScene); renderer.render(scene, camera);
  cloudMirror.uniforms.tColor.value = rtMirrorScene.texture;
  cloudMirror.uniforms.tDepth.value = rtMirrorScene.depthTexture;
  cloudMirror.uniforms.uInvVP.value.copy(invVP);
  pass(cloudMirror, rtMirror);
  partMat.uniforms.tDepth.value = rtMirrorScene.depthTexture;
  renderer.autoClear = false; renderer.setRenderTarget(rtMirror); renderer.render(fxScene, camera); renderer.autoClear = true;

  // 2. main view, the lake samples the reflection
  U.uMirror.value = 1;
  U.uCamTrue.value.copy(camera.position);
  world.scale.y = 1; fxGroup.scale.y = 1; water.visible = true;
  waterMat.uniforms.uRefl.value = rtMirror.texture;
  renderer.setRenderTarget(rtScene); renderer.render(scene, camera);
  cloudMain.uniforms.tColor.value = rtScene.texture;
  cloudMain.uniforms.tDepth.value = rtScene.depthTexture;
  cloudMain.uniforms.uInvVP.value.copy(invVP);
  pass(cloudMain, rtComp);
  partMat.uniforms.tDepth.value = rtScene.depthTexture;
  renderer.autoClear = false; renderer.setRenderTarget(rtComp); renderer.render(fxScene, camera); renderer.autoClear = true;

  // 3. light shafts (radial blur of the unoccluded sun glow toward the sun's screen position)
  tmpV.copy(camera.position).addScaledVector(SUN_DIR, 1000).project(camera);
  sunUV.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
  pass(raysMat, rtRays);

  // 4. bloom
  pass(brightMat, rtB0);
  blurMat.uniforms.tSrc.value = rtB0.texture; blurMat.uniforms.uDir.value.set(1 / BW, 0); pass(blurMat, rtB1);
  blurMat.uniforms.tSrc.value = rtB1.texture; blurMat.uniforms.uDir.value.set(0, 1 / BH); pass(blurMat, rtB0);

  // 5. tone map + grade to screen
  pass(finalMat, null);
}

window.renderFrame = renderFrame;
window.__canvas = canvas;
window.__info = { W: RW, H: RH, DURATION, DBG, glRenderer: (() => { const gl = renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })(), plaqueFontOk: document.fonts.check('900 100px "Songti SC"') };
renderFrame(0);
window.sceneReady = true;

if (!CAPTURE) { // live preview loop when opened directly in a browser
  const t0 = performance.now();
  const loop = () => { renderFrame(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
