// 青云宗 · 御剑采灵 — a small sword-flight game in a procedural xianxia mountain sect at dawn.
// Everything (geometry, textures, text, noise, audio) is generated in code from fixed seeds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GameAudio, renderOffline } from './audio.js';
import { botInput } from './bot.js';
import { parseGLB, modelGeometry, decodeBase64 } from './models.js';

const QS = new URLSearchParams(location.search);
const CAPTURE = QS.has('capture'); // no rAF loop: the playthrough script calls __game.step(dt)
const BOT = QS.has('bot');         // autopilot provides the inputs
const FORCE_PR = parseFloat(QS.get('ss') || '0');
const $ = (id) => document.getElementById(id);

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
{ const r = mulberry32(20261110); for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.floor(r() * 256); }
const wrap = (i) => ((i % NS) + NS) % NS;
function vnoise(x, y, z) { // identical lattice noise to the GLSL version (same 3D texture)
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const x0 = wrap(xi), x1 = wrap(xi + 1), y0 = wrap(yi) * NS, y1 = wrap(yi + 1) * NS;
  const z0 = wrap(zi) * NS * NS, z1 = wrap(zi + 1) * NS * NS, d = noiseData;
  const a = d[x0 + y0 + z0] + (d[x1 + y0 + z0] - d[x0 + y0 + z0]) * fx;
  const b = d[x0 + y1 + z0] + (d[x1 + y1 + z0] - d[x0 + y1 + z0]) * fx;
  const c = d[x0 + y0 + z1] + (d[x1 + y0 + z1] - d[x0 + y0 + z1]) * fx;
  const e = d[x0 + y1 + z1] + (d[x1 + y1 + z1] - d[x0 + y1 + z1]) * fx;
  const ab = a + (b - a) * fy, ce = c + (e - c) * fy;
  return (ab + (ce - ab) * fz) / 255;
}
function fbm(x, y, z, oct = 4) {
  let a = 0.5, s = 0;
  for (let k = 0; k < oct; k++) { s += a * vnoise(x, y, z); x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.2; a *= 0.5; }
  return s;
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- Blender-built models (rider, sword, crane, dragon, trees, props)
const MODELS = parseGLB(decodeBase64($('glb').textContent.trim()));
const MODEL_META = JSON.parse($('meta').textContent);

// ---------------------------------------------------------------- quality + renderer
const QUALITY = {
  high: { pr: 1.5, cloudScale: 0.5, cloudSteps: 34, mirrorScale: 0.5, rayTaps: 36, bloom: 1, shadow: 1, aa: 1 },
  low: { pr: 0.7, cloudScale: 0.34, cloudSteps: 13, mirrorScale: 0.25, rayTaps: 0, bloom: 0, shadow: 0, aa: 0 },
};
let qualityName = QS.get('q') || 'high';
try { if (!QS.get('q')) qualityName = localStorage.getItem('qy-quality') || 'high'; } catch (e) { /* storage unavailable */ }
if (!QUALITY[qualityName]) qualityName = 'high';
let quality = QUALITY[qualityName];

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
const glRendererName = (() => {
  const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
})();

const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 6000);
const scene = new THREE.Scene();
const world = new THREE.Group(); // mirrored (scale.y = -1) for the lake reflection pass
scene.add(world);

const noiseTex = new THREE.Data3DTexture(noiseData, NS, NS, NS);
noiseTex.format = THREE.RedFormat; noiseTex.type = THREE.UnsignedByteType;
noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter;
noiseTex.wrapS = noiseTex.wrapT = noiseTex.wrapR = THREE.RepeatWrapping;
noiseTex.unpackAlignment = 1; noiseTex.needsUpdate = true;

const LC = { x: 0, z: 56 }; // lake centre
const SUN_DIR = new THREE.Vector3(0.13, 0.367, -1).normalize();
const RIPPLES = 10;
const U = { // shared by reference between all materials
  uNoise: { value: noiseTex }, uTime: { value: 0 }, uSunDir: { value: SUN_DIR },
  uCamTrue: { value: new THREE.Vector3() }, uMirror: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) },
  uGlow: { value: 0 }, uFocus: { value: new THREE.Vector3() }, uProj: { value: 1 }, uSpeed: { value: 0 },
  uWave: { value: -1 }, tShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
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
uniform float uWave; // seconds since the gate was unlocked (-1 before): drives a ring of golden light across the land
const vec3 SUN_COL = vec3(1.0, 0.60, 0.34) * 3.4;
vec3 waveGlow(vec3 wp){
  if (uWave < 0.0 || uWave > 12.1) return vec3(0.0); // gone once the ring has crossed the land
  float R = uWave * 58.0, d = length(wp.xz);
  float a = (d - R) / (4.0 + R * 0.035), b = (d - R * 0.82) / (10.0 + R * 0.06); // squared by hand: pow() of a negative base is undefined
  float ring = exp(-a * a) + 0.25 * exp(-b * b);
  return vec3(1.0, 0.72, 0.32) * ring * 0.95 * (1.0 - smoothstep(380.0, 700.0, R));
}
float vnoise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f); return texture(uNoise, (i+f+0.5)/64.0).r; }
float fbm4(vec3 p){ float a = 0.5, s = 0.0; for(int k=0;k<4;k++){ s += a*vnoise(p); p = p*2.03 + vec3(17.1,3.7,9.2); a *= 0.5; } return s; }
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for(int k=0;k<3;k++){ s += a*vnoise(p); p = p*2.03 + vec3(17.1,3.7,9.2); a *= 0.5; } return s; }
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
vec3 applyFog(vec3 col, vec3 wp){ // analytic exponential height fog
  vec3 v = wp - uCamTrue; float d = length(v); vec3 dir = v / max(d, 1e-4);
  float b = 0.010, a = 0.0012;
  float dy = dir.y; if (abs(dy) < 1e-4) dy = 1e-4;
  float amt = a * exp(-max(uCamTrue.y, -40.0)*b) * (1.0 - exp(-d*dy*b)) / (dy*b);
  return mix(col, fogColor(dir), 1.0 - exp(-max(amt, 0.0)));
}
`;

const SURF_VERT = /* glsl */ `
uniform float uMirror;
attribute vec4 aColor; // Blender-built models only: rgb albedo, a emission mask
varying vec3 vWp; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying vec4 vCol;
void main(){
  vCol = aColor;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz * vec3(1.0, uMirror, 1.0); // "true" world space (undo the reflection mirror)
  vN = (mat3(modelMatrix) * normal) * vec3(1.0, uMirror, 1.0);
  vObj = position; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const K = { PEAK: 0, TERRAIN: 1, STONE: 2, ROOF: 3, PLAQUE: 4, PINE: 5, FROCK: 6, RED: 7, EMIT: 8, TINT: 9, SWORD: 10, LILY: 11, MODEL: 12 };
const SURF_FRAG = COMMON + /* glsl */ `
varying vec3 vWp; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying vec4 vCol;
uniform sampler2D uMap; uniform vec3 uTint; uniform float uGlow;
uniform float uSpec, uEmis, uDetail, uTrans, uSoft; uniform vec3 uRim;
uniform sampler2D tShadow; uniform mat4 uShadowMat; uniform float uShadowOn;
// sun shadow from a depth map rendered along the sun direction (4-tap PCF, normal-offset bias)
float shadowAt(vec3 wp, vec3 N){
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMat * vec4(wp + N * 0.30, 1.0);
  vec3 p = sc.xyz * 0.5 + 0.5;
  if (p.x < 0.01 || p.x > 0.99 || p.y < 0.01 || p.y > 0.99 || p.z > 1.0) return 1.0;
  float tx = 1.0 / 2048.0, z = p.z - 0.0005, s = 0.0;
  s += step(z, texture2D(tShadow, p.xy + vec2(-0.6, -0.3) * tx).r);
  s += step(z, texture2D(tShadow, p.xy + vec2(0.3, -0.6) * tx).r);
  s += step(z, texture2D(tShadow, p.xy + vec2(0.6, 0.3) * tx).r);
  s += step(z, texture2D(tShadow, p.xy + vec2(-0.3, 0.6) * tx).r);
  return s * 0.25;
}
vec3 shade(vec3 alb, vec3 N, vec3 wp, float spec){
  vec3 V = normalize(uCamTrue - wp);
  float ndl = dot(N, uSunDir);
  float sh = shadowAt(wp, N);
  vec3 amb = mix(vec3(0.25,0.24,0.29), vec3(0.50,0.55,0.70), N.y*0.5+0.5);
  float back = max(dot(N, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  amb += vec3(0.50,0.30,0.15) * back * 0.5 * (0.5 + 0.5 * sh);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0) * smoothstep(-0.2, 0.6, ndl);
  vec3 c = alb * (SUN_COL * max(ndl, 0.0) * sh + amb) + SUN_COL * alb * rim * 0.6 * sh;
  if (spec > 0.0) c += SUN_COL * spec * sh * pow(max(dot(reflect(-V, N), uSunDir), 0.0), 48.0);
  return c;
}
vec3 rockAlb(vec3 p){
  float n = fbm4(p * vec3(0.05, 0.12, 0.05));
  vec3 rock = mix(vec3(0.30,0.28,0.28), vec3(0.52,0.47,0.43), n);
  rock *= 0.78 + 0.44 * vnoise(vec3(p.x*0.35, p.y*0.04, p.z*0.35));
  rock *= 0.92 + 0.10 * sin(p.y * 0.9 + vnoise(p * 0.08) * 9.0);                       // strata
  // soft vertical fissures, broken up so they do not read as drawn contour lines
  float crack = (1.0 - smoothstep(0.0, 0.09, abs(vnoise(p * vec3(0.55, 0.10, 0.55)) - 0.5))) * smoothstep(0.35, 0.7, vnoise(p * 0.23 + 31.0));
  float pit = smoothstep(0.62, 0.8, vnoise(p * 1.9));
  return rock * (1.0 - 0.20 * crack) * (1.0 - 0.18 * pit);
}
vec3 bump(vec3 N, vec3 p, float a){
  return normalize(N + (vec3(vnoise(p), vnoise(p + 7.3), vnoise(p + 13.9)) - 0.5) * a);
}
void main(){
  if (uMirror < 0.0 && vWp.y < 0.0) discard; // nothing below the water plane is reflected
  vec3 N = normalize(vN); vec3 wp = vWp; vec3 col;
#if KIND == 0
  N = bump(bump(N, wp * 0.33, 0.7), wp * 1.3, 0.35);
  vec3 alb = rockAlb(wp);
  float veg = smoothstep(0.30, 0.62, N.y + (fbm3(wp*0.06) - 0.44) * 1.1);
  vec3 green = mix(vec3(0.07,0.13,0.08), vec3(0.15,0.23,0.11), vnoise(wp*0.4)) * (0.8 + 0.4 * vnoise(wp * 2.1));
  alb = mix(alb, green, veg);
  col = shade(alb, N, wp, 0.0);
#elif KIND == 1
  float n = fbm3(wp * 0.15), fine = vnoise(wp * 2.3), micro = vnoise(wp * 8.7);
  N = bump(normalize(N + (vec3(vnoise(wp*0.8), 0.5, vnoise(wp*0.8+5.1)) - 0.5) * 0.35), wp * 3.1, 0.22);
  vec3 grass = mix(vec3(0.07,0.13,0.06), vec3(0.17,0.22,0.09), n) * (0.72 + 0.56 * fine) * (0.86 + 0.28 * micro);
  grass = mix(grass, vec3(0.26,0.25,0.10), smoothstep(0.60, 0.80, vnoise(wp * 0.33 + 11.0)) * 0.55);          // dry patches
  float fl = step(0.90, vnoise(wp * 5.3 + 2.0)) * smoothstep(0.55, 0.75, vnoise(wp * 0.21 + 4.0));             // wildflowers
  grass = mix(grass, mix(vec3(0.75,0.62,0.78), vec3(0.85,0.80,0.45), step(0.5, vnoise(wp * 0.9))), fl * 0.8);
  vec3 rock = rockAlb(wp * 2.2) * 0.95;
  float gmask = smoothstep(0.60, 0.84, N.y + (n - 0.44) * 0.3 + (fine - 0.5) * 0.12);
  // worn stone path from the terrace toward the lake shore and up to the hall
  float path = (1.0 - smoothstep(2.6, 4.2, abs(wp.x) + (vnoise(wp * 0.4) - 0.5) * 1.6)) * step(wp.z, 12.0) * step(-36.0, wp.z);
  vec3 alb = mix(rock, grass, gmask);
  alb = mix(alb, vec3(0.36,0.33,0.29) * (0.8 + 0.4 * micro), path * 0.8);
  alb *= mix(0.5, 1.0, smoothstep(0.0, 0.9, wp.y));
  col = shade(alb, N, wp, 0.0);
#elif KIND == 2
  float n = fbm3(wp * 1.3);
  vec3 alb = mix(vec3(0.34,0.33,0.33), vec3(0.52,0.50,0.47), n) * (0.93 + 0.14 * vnoise(wp * 3.1)) * (0.92 + 0.16 * vnoise(wp * 11.0));
  // masonry: courses on vertical faces, paving slabs on top faces
  float course = floor(wp.y / 0.52);
  vec2 jv = vec2(fract(wp.y / 0.52), fract((wp.x + wp.z) / 1.3 + course * 0.5));
  float jointV = max(1.0 - smoothstep(0.0, 0.05, min(jv.x, 1.0 - jv.x)), 1.0 - smoothstep(0.0, 0.025, min(jv.y, 1.0 - jv.y)));
  vec2 jh = fract(wp.xz / 1.6);
  float jointH = 1.0 - smoothstep(0.0, 0.03, min(min(jh.x, 1.0 - jh.x), min(jh.y, 1.0 - jh.y)));
  float joint = mix(jointV * step(wp.y, 1.45), jointH, step(0.9, N.y));
  alb *= 1.0 - 0.38 * joint;
  alb *= 0.90 + 0.10 * step(0.5, fract(course * 0.37 + floor((wp.x + wp.z) / 1.3 + course * 0.5) * 0.61));     // slab-to-slab tone
  float moss = smoothstep(0.50, 0.72, vnoise(wp*0.9 + 3.0)) * (1.0 - smoothstep(1.4, 5.5, wp.y));
  alb = mix(alb, vec3(0.16,0.22,0.13), moss * 0.6);
  float streak = smoothstep(0.55, 0.8, vnoise(vec3(wp.x * 2.5, wp.y * 0.25, wp.z * 2.5))) * (1.0 - step(0.9, N.y)); // rain streaks
  alb *= 1.0 - 0.22 * streak;
  alb *= mix(0.62, 1.0, smoothstep(0.0, 0.7, wp.y));
  col = shade(alb, bump(N, wp * 4.0, 0.12), wp, 0.0);
#elif KIND == 3
  if (!gl_FrontFacing) N = -N;
  float st = 0.5 + 0.5 * sin(vUv.x * 6.2832 / 0.30);                 // tile ridges running down the slope
  float row = fract(vUv.y * 13.0);                                   // overlapping tile courses
  vec3 alb = mix(vec3(0.035,0.085,0.10), vec3(0.10,0.23,0.25), st) * (0.72 + 0.28 * row) * (0.9 + 0.2 * vnoise(wp * 6.0));
  float eave = 1.0 - smoothstep(0.03, 0.07, vUv.y);
  alb = mix(alb, vec3(0.50,0.38,0.16) * (0.6 + 0.6 * smoothstep(0.2, 0.8, st)), eave);   // round gilt end caps along the eave
  N = normalize(N + vec3(cos(vUv.x * 6.2832 / 0.30) * 0.35, 0.0, 0.0));
  col = shade(alb, N, wp, 0.35 * st);
#elif KIND == 4
  vec3 tex = texture2D(uMap, vUv).rgb;
  col = shade(tex, N, wp, 0.0);
  float mask = smoothstep(0.22, 0.6, dot(tex, vec3(0.3,0.6,0.1)));
  float pulse = 0.85 + 0.15 * sin(uTime * 5.0);
  col += tex * mask * (0.75 + uGlow * 7.0 * pulse);        // gilded text; blazes once the gate is unlocked
  col += vec3(0.03,0.09,0.08) * uGlow * (1.0 - mask) * pulse;
#elif KIND == 5
  // uv.x = per-tree tint, uv.y = 1 foliage / 0 trunk
  vec3 leaf = mix(vec3(0.035,0.095,0.065), vec3(0.10,0.17,0.07), vUv.x) * (0.6 + 0.8 * vnoise(wp * 1.7)) * (0.8 + 0.4 * vnoise(wp * 6.0));
  vec3 alb = mix(vec3(0.15,0.10,0.07) * (0.7 + 0.6 * vnoise(wp * vec3(9.0, 1.5, 9.0))), leaf, vUv.y);
  col = shade(alb, bump(N, wp * 3.0, 0.5 * vUv.y), wp, 0.0);
#elif KIND == 6
  vec3 p = vObj * 9.0;
  N = bump(bump(N, p * 0.5, 0.6), p * 2.2, 0.3);
  vec3 alb = rockAlb(p * 2.0) * 1.05;
  float top = smoothstep(0.45, 0.8, N.y + (vnoise(p*0.6)-0.5)*0.4);
  alb = mix(alb, mix(vec3(0.10,0.19,0.08), vec3(0.18,0.26,0.10), vnoise(p * 3.0)), top);
  col = shade(alb, N, wp, 0.0);
#elif KIND == 7
  // lacquered timber: plank seams and wear
  float seam = 1.0 - smoothstep(0.0, 0.04, abs(fract((wp.x + wp.z) * 1.6) - 0.5) - 0.44);
  vec3 alb = vec3(0.40,0.075,0.055) * (0.75 + 0.45 * vnoise(wp * 5.0)) * (0.82 + 0.18 * seam) * (0.9 + 0.2 * vnoise(wp * vec3(2.0, 14.0, 2.0)));
  col = shade(alb, N, wp, 0.15);
#elif KIND == 8
  col = uTint * (1.0 + 0.12 * sin(uTime*7.0 + wp.x) * sin(uTime*3.1));
#elif KIND == 9
  col = shade(uTint * (0.9 + 0.2 * vnoise(vObj * 14.0)), N, wp, 0.0);
#elif KIND == 10
  vec3 V = normalize(uCamTrue - wp);
  float fr = pow(1.0 - abs(dot(N, V)), 2.0);
  float rune = smoothstep(0.55, 0.6, vnoise(vec3(vObj.z * 5.0, uTime * 0.6, 3.0)));
  col = shade(vec3(0.55,0.62,0.66), N, wp, 1.2) + vec3(0.35,0.95,0.85) * (0.8 + 1.6 * fr + 0.9 * rune);
#elif KIND == 12
  // Blender-built model: painted vertex colour with baked occlusion, emission mask in alpha
  if (!gl_FrontFacing) N = -N;
  vec3 alb = vCol.rgb * uTint * (0.84 + 0.32 * vnoise(vObj * uDetail));
  if (uSoft > 0.0) { // foliage: melt the facets into one rounded mass, then break it up into needles and petals
    N = bump(normalize(mix(N, vec3(0.0, 1.0, 0.0), uSoft)), wp * 5.5, 0.75);
    alb *= 0.62 + 0.76 * vnoise(wp * 7.0) * (0.6 + 0.8 * vnoise(wp * 23.0));
  }
  col = shade(alb, N, wp, uSpec);
  vec3 Vm = normalize(uCamTrue - wp);
  // light coming through leaves and petals when the sun is behind them
  col += alb * SUN_COL * uTrans * (0.16 + 0.95 * pow(max(dot(-Vm, uSunDir), 0.0), 3.0)) * shadowAt(wp, N);
  col += vCol.rgb * vCol.a * uEmis * (0.82 + 0.18 * sin(uTime * 3.0 + vObj.z * 2.0));
  col += uRim * pow(1.0 - abs(dot(N, Vm)), 2.0);
#else
  // lily pad: radial veins, darker centre, a notch; lotus petals use the same kind with uTint
  vec2 q = vUv - 0.5; float r = length(q) * 2.0, a = atan(q.y, q.x);
  if (uTint.r < 0.5 && abs(a) < 0.22 && r > 0.25) discard;
  float vein = 0.5 + 0.5 * cos(a * 14.0);
  vec3 alb = uTint.r < 0.5 ? mix(vec3(0.05,0.16,0.07), vec3(0.14,0.30,0.10), r) * (0.85 + 0.15 * vein) * (0.8 + 0.4 * vnoise(wp * 2.0))
                           : uTint * (0.75 + 0.35 * vUv.y);
  col = shade(alb, N.y < 0.0 ? -N : N, wp, 0.2);
#endif
  col = applyFog(col + waveGlow(wp), wp);
  gl_FragColor = vec4(col, 0.0); // alpha 0: opaque surfaces block the light-shaft source
}`;
function surfMat(kind, extra = {}) {
  return new THREE.ShaderMaterial({
    defines: { KIND: kind },
    uniforms: {
      ...U, uMap: { value: extra.map || null }, uTint: { value: new THREE.Color().setRGB(...(extra.tint || [1, 1, 1])) },
      uSpec: { value: extra.spec || 0 }, uEmis: { value: extra.emis || 0 }, uDetail: { value: extra.detail || 2 },
      uTrans: { value: extra.trans || 0 }, uSoft: { value: extra.soft || 0 },
      uRim: { value: new THREE.Color().setRGB(...(extra.rim || [0, 0, 0])) }, ...(extra.uniforms || {}),
    },
    vertexShader: extra.vert || SURF_VERT, fragmentShader: SURF_FRAG, side: THREE.DoubleSide,
  });
}
const cast = (m) => { m.userData.cast = true; return m; }; // marks a mesh as a sun-shadow caster
// additive on RGB only: the alpha channel of the scene target carries the light-shaft source
const ADDITIVE = {
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, depthWrite: false, transparent: true,
};

// ---------------------------------------------------------------- geometry helpers
function paramSurface(nu, nv, P, flip = false, uvFn = null) { // P(u,v) -> [x,y,z], finite-difference normals
  const n = (nu + 1) * (nv + 1);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const e = 1e-3; let k = 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) {
    const u = i / nu, v = j / nv, p = P(u, v);
    const pa = P(Math.max(u - e, 0), v), pb = P(Math.min(u + e, 1), v), pc = P(u, Math.max(v - e, 0)), pd = P(u, Math.min(v + e, 1));
    const dux = pb[0] - pa[0], duy = pb[1] - pa[1], duz = pb[2] - pa[2];
    const dvx = pd[0] - pc[0], dvy = pd[1] - pc[1], dvz = pd[2] - pc[2];
    let nx = duy * dvz - duz * dvy, ny = duz * dvx - dux * dvz, nz = dux * dvy - duy * dvx;
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { nx = 0; ny = flip ? -1 : 1; nz = 0; l = 1; }
    const s = (flip ? -1 : 1) / l;
    pos.set(p, k * 3); nor.set([nx * s, ny * s, nz * s], k * 3); uv.set(uvFn ? uvFn(u, v) : [u, v], k * 2);
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

// ---------------------------------------------------------------- game layout (needed before the peaks are placed)
const Y0 = 1.5; // terrace top
const ROCK_DEFS = [ // x, y, z, scale, pine?
  [-9, 12, 18, 2.0, 0], [11, 18, -6, 2.5, 1], [-13, 21, -30, 3.4, 1], [24, 10, 48, 2.2, 0], [-28, 16, 70, 2.8, 1], [6, 26, 96, 3.0, 0],
  [16, 30, -72, 5.0, 1], [-24, 35, -115, 6.5, 0], [-4, 48, -190, 8.0, 1], [30, 44, -150, 5.5, 0], [90, 34, 20, 5.0, 1], [-95, 40, 60, 6.0, 1],
  [70, 50, 140, 6.0, 0], [-60, 30, 170, 5.0, 1], [140, 60, -60, 7.0, 0], [-150, 55, -40, 7.0, 1],
];
const ORB_DEFS = [
  [0, 3, 40], [-14, 2.6, 58], [14, 2.6, 70], [0, 3, 92], [22, 6, 30],            // skimming the lake
  [0, 5, -16], [0, 17.5, 2],                                                     // behind and above the gate
  [-9, 16.5, 18], [11, 24, -6], [-21, 21, -30], [24, 14.5, 48], [6, 31.5, 96],   // around the near rocks
  [16, 38.5, -72], [-24, 44.5, -115], [90, 42, 20], [-95, 49, 60],               // above the far rocks
  [78, 20, 190], [-60, 38, 170], [130, 21, -30], [-128, 23, -92],                // out over the sea of clouds
];
const ORB_TOTAL = ORB_DEFS.length;

// ---------------------------------------------------------------- sky dome
const skyMat = new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: /* glsl */ `varying vec3 vDir; uniform float uMirror;
    void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vDir = (wp.xyz - cameraPosition)*vec3(1.0,uMirror,1.0);
      gl_Position = projectionMatrix*viewMatrix*wp; }`,
  fragmentShader: COMMON + /* glsl */ `
    varying vec3 vDir;
    float cov(vec2 uv){ return smoothstep(0.47, 0.74, fbm3(vec3(uv, uTime*0.012))); }
    void main(){
      vec3 d = normalize(vDir);
      vec3 col = skyBase(d);
      float sd = max(dot(d, uSunDir), 0.0);
      float trans = 1.0;
      if (d.y > 0.0) { // broken high cloud layer, lit from the sun side
        vec2 drift = vec2(uTime*0.020, uTime*0.006);
        vec2 uv = d.xz / (d.y + 0.14) * 1.5;
        vec2 suv = uSunDir.xz / (uSunDir.y + 0.14) * 1.5;
        float c0 = cov(uv + drift) * smoothstep(0.04, 0.22, d.y);
        float lit = exp(-2.6 * cov(uv + drift + normalize(suv - uv + 1e-4) * 0.22));
        vec3 cl = mix(vec3(0.30,0.30,0.42), vec3(1.0,0.74,0.52) * 1.05, lit);
        cl += vec3(1.0,0.55,0.25) * pow(sd, 8.0) * lit;
        col = mix(col, cl, c0 * 0.88);
        trans = 1.0 - c0 * 0.88;
      }
      float disc = smoothstep(0.99990, 0.99996, sd);
      col += vec3(1.0,0.86,0.62) * (disc * 40.0 + pow(sd, 2500.0) * 4.0) * trans;
      gl_FragColor = vec4(col, trans * (pow(sd, 220.0) * 0.45 + disc * 14.0)); // alpha = light-shaft source
    }`,
  side: THREE.BackSide, depthWrite: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 40, 20), skyMat);
sky.frustumCulled = false; scene.add(sky);

// ---------------------------------------------------------------- pines (shared by hills, floating rocks and peak ledges)
// gnarled mountain pines modelled in Blender (three variants); each call returns one placed, tinted copy
function pineGeo(h, x, y, z, tint = 0.5, seed = 1, hi = false) { // hi: the detailed variant, for trees you fly close to
  const name = `pine${hi ? 'h' : ''}${Math.abs(Math.floor(seed)) % 3}`, t = 0.78 + 0.4 * tint;
  return [modelGeometry(MODELS[name], {
    scale: (h * 1.25) / MODEL_META[name].max[2], rotY: seed * 1.7 + tint * 6, at: [x, y, z],
    tint: [t * (1.06 - 0.12 * tint), t, t * (0.9 + 0.2 * tint)],
  })];
}

// ---------------------------------------------------------------- peaks (also colliders)
const spires = [];
const peakPines = [];
const PEAK_BASE = -60;
function spireProfile(v, pw) { return (0.52 + 0.48 * Math.pow(1 - v, pw)) * Math.pow(Math.max(1 - Math.pow(v, 4), 0), 0.6); }
function makeSpire(cx, cz, HH, R, seed, big) {
  const rnd = mulberry32(seed);
  const ox = rnd() * 50, oy = rnd() * 50, oz = rnd() * 50;
  const la = rnd() * Math.PI * 2, lean = rnd() * 0.07 * HH, pw = 0.75 + rnd() * 0.5;
  spires.push({ x: cx, z: cz, H: HH, R, pw, lx: Math.cos(la) * lean, lz: Math.sin(la) * lean });
  const P = (u, v) => {
    const th = u * Math.PI * 2, y = PEAK_BASE + v * (HH - PEAK_BASE), cs = Math.cos(th), sn = Math.sin(th);
    const n1 = fbm(cs * 1.3 + ox, y * 0.02 + oy, sn * 1.3 + oz, 4);
    const n2 = fbm(cs * 4.2 + ox, y * 0.07 + oy, sn * 4.2 + oz, 3);
    const n3 = vnoise(cs * 11 + ox, y * 0.3 + oy, sn * 11 + oz);
    const ledge = vnoise(ox, y * 0.085 + oy, oz) * 0.6 + vnoise(ox + 9, y * 0.23 + oy, oz) * 0.4;
    const lobes = 1 + 0.16 * Math.sin(th * 3 + ox) * (1 - v) + 0.10 * Math.sin(th * 5 + oz + y * 0.02);
    const r = R * 0.66 * spireProfile(v, pw) * lobes * (0.40 + 1.2 * n1) * (0.70 + 0.60 * n2) * (0.72 + 0.56 * ledge) * (0.95 + 0.10 * n3);
    return [cx + cs * r + Math.cos(la) * lean * v * v, y, cz + sn * r + Math.sin(la) * lean * v * v];
  };
  // pines clinging to ledges: wherever the rock steps back sharply with height
  let placed = 0;
  for (let k = 0; k < (big ? 40 : 16) && placed < (big ? 7 : 3); k++) {
    const u = rnd(), v = 0.42 + rnd() * 0.5, a = P(u, v), b = P(u, v + 0.012);
    const stepBack = Math.hypot(a[0] - cx, a[2] - cz) - Math.hypot(b[0] - cx, b[2] - cz);
    if (stepBack / (b[1] - a[1]) < 0.55) continue;
    peakPines.push(...pineGeo(4 + rnd() * 5 + HH * 0.012, a[0], a[1] + 0.4, a[2], rnd(), k)); placed++;
  }
  return paramSurface(big ? 46 : 34, big ? 58 : 40, P, true);
}
// approximate collision radius of a spire at height y (mean of the noise terms)
function spireRadius(s, y) {
  const v = (y - PEAK_BASE) / (s.H - PEAK_BASE);
  if (v >= 1 || v < 0) return 0;
  return s.R * 0.66 * spireProfile(v, s.pw) * 0.95;
}
{
  const rnd = mulberry32(777);
  const mains = [ // hero composition behind the gate (seen from the spawn point)
    [-46, -95, 72, 17], [50, -120, 58, 15], [-80, -150, 96, 22], [86, -170, 90, 20],
    [-70, -260, 150, 32], [30, -300, 116, 26], [108, -280, 142, 30], [-150, -330, 172, 36],
    [-22, -470, 278, 48], [128, -520, 222, 44], [-172, -500, 236, 46], [214, -560, 252, 50],
  ];
  const avoid = [...ROCK_DEFS.map((r) => [r[0], r[2], r[3] * 2 + 26]), ...ORB_DEFS.map((o) => [o[0], o[2], 30])];
  let tries = 0;
  while (mains.length < 40 && tries++ < 3000) { // ring of peaks all around the plateau
    const a = rnd() * Math.PI * 2, rad = 185 + rnd() * 470;
    const x = LC.x + Math.sin(a) * rad, z = LC.z + Math.cos(a) * rad;
    if (z < LC.z && Math.abs(Math.atan2(x - LC.x, -(z - LC.z))) < 0.5) continue; // keep the hero sector as composed
    const hh = lerp(85, 290, (rad - 185) / 470) * (0.7 + 0.6 * rnd()), r = hh * 0.17 + 9;
    if (mains.some((m) => Math.hypot(m[0] - x, m[1] - z) < (m[3] + r) * 0.8 + 22)) continue;
    if (avoid.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + r)) continue;
    mains.push([x, z, hh, r]);
  }
  const geos = []; let seed = 100;
  for (const [x, z, hh, r] of mains) {
    geos.push(makeSpire(x, z, hh, r, seed++, true));
    const sats = 1 + Math.floor(rnd() * 2);
    for (let s = 0; s < sats; s++) {
      const a = rnd() * Math.PI * 2, dd = r * (0.65 + rnd() * 0.5);
      const sx = x + Math.cos(a) * dd, sz = z + Math.sin(a) * dd * 0.6, sr = r * (0.42 + rnd() * 0.25), sh = hh * (0.4 + rnd() * 0.35);
      if (avoid.some((p) => Math.hypot(p[0] - sx, p[1] - sz) < p[2] + sr)) continue;
      geos.push(makeSpire(sx, sz, sh, sr, seed++, false));
    }
  }
  world.add(new THREE.Mesh(mergeGeometries(geos), surfMat(K.PEAK)));
  world.add(new THREE.Mesh(mergeGeometries(peakPines), surfMat(K.MODEL, { detail: 1.6, trans: 0.3, soft: 0.35 })));
}

// ---------------------------------------------------------------- terrain: a lake plateau that falls away into the clouds
function terrainH(x, z) {
  const dx = x - LC.x, dz = z - LC.z, r = Math.hypot(dx, dz), ax = Math.abs(x);
  const ang = Math.abs(Math.atan2(dx, -dz)); // 0 = toward the gate
  const rs = 46 + (fbm(dx * 0.02 + 3, 2.2, dz * 0.02 + 8, 3) - 0.47) * 22 * smooth(0.3, 1.0, ang); // shoreline radius
  const d = r - rs;
  let h = -2.2 + 3.6 * smooth(0, 7, d);
  const side = Math.max(smooth(9, 32, ax), smooth(8, 30, z)); // 0 in the gate corridor
  const n = fbm(x * 0.03 + 5.2, 1.3, z * 0.03 + 9.1, 4);
  h += side * smooth(2, 28, d) * (4 + 30 * n);
  h += (1 - smooth(9, 32, ax)) * smooth(-8, -27, z) * (1 - smooth(8, 30, z)) * 4.8; // rise under the stairway
  h += (fbm(x * 0.2, 7.7, z * 0.2, 3) - 0.45) * 1.2 * smooth(1, 6, d) * (0.3 + side);
  return lerp(h, -75, smooth(108, 168, r));
}
// what the player actually flies over: terrain, lake surface, terrace and stairway
function groundH(x, z) {
  let g = Math.max(terrainH(x, z), 0);
  if (Math.abs(x) < 11 && z > -9 && z < 7) g = Math.max(g, Y0);
  if (Math.abs(x) < 3.5 && z <= -9 && z > -28.2) g = Math.max(g, Y0 + 0.3 * Math.ceil((-9 - z) / 1.2));
  return g;
}
world.add(cast(new THREE.Mesh(
  paramSurface(236, 236, (u, v) => { const x = LC.x - 180 + 360 * u, z = LC.z - 180 + 360 * v; return [x, terrainH(x, z), z]; }, true),
  surfMat(K.TERRAIN))));

// ---------------------------------------------------------------- terrace, stairs, paifang gate, hall, pagodas
const MAT = { stone: surfMat(K.STONE), roof: surfMat(K.ROOF), red: surfMat(K.RED), gold: surfMat(K.TINT, { tint: [0.62, 0.46, 0.16] }), pine: surfMat(K.PINE), frock: surfMat(K.FROCK),
  tree: surfMat(K.MODEL, { detail: 1.6, trans: 0.3, soft: 0.45 }), bronze: surfMat(K.MODEL, { detail: 5, spec: 0.5, emis: 3.0 }), bloom: surfMat(K.MODEL, { detail: 9, spec: 0.1, trans: 0.5 }) };
const stoneG = [], roofG = [], redG = [], lampG = [], goldG = [], hangG = [];
const fixUv = (g) => { const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * 0.3, 0.5); return g; };
stoneG.push(box(22, 3.5, 16, 0, Y0 - 1.75, -1));
for (let k = 0; k < 4; k++) { const top = Y0 - 0.3 * (k + 1); stoneG.push(box(10, top + 2, 0.6, 0, (top - 2) / 2, 7.3 + 0.6 * k)); }
for (let k = 0; k < 16; k++) { const top = Y0 + 0.3 * (k + 1); stoneG.push(box(7, top, 1.2, 0, top / 2, -9.6 - 1.2 * k)); }
// hip roof with a concave slope and upturned eaves; L = D gives a pyramid roof
function makeRoof(L, D, h, up, x0, y0, z0, RG = roofG, DG = redG) {
  const f = (u, v) => { const uu = 2 * u - 1, vv = 2 * v - 1; return [uu, vv, 1 - Math.abs(vv), (1 - Math.abs(uu)) * L / D]; };
  RG.push(paramSurface(40, 16, (u, v) => {
    const [uu, vv, a, b] = f(u, v), e = Math.min(a, b);
    return [x0 + uu * L / 2, y0 + h * Math.pow(e, 1.5) + up * Math.pow(Math.abs(uu), 4) * (0.3 + 0.7 * vv * vv), z0 + vv * D / 2];
  }, true, (u, v) => { const [uu, vv, a, b] = f(u, v); return [a < b ? uu * L / 2 : vv * D / 2, Math.min(a, b)]; }));
  const rl = Math.max(L - D * 0.95, 0.2), s = Math.min(1, D / 4);
  RG.push(fixUv(box(rl, 0.36 * s, 0.24 * s, x0, y0 + h + 0.08 * s, z0)));
  if (rl > 1.5) for (const sg of [-1, 1]) { // ridge-end ornaments and a row of small ridge beasts
    RG.push(fixUv(new THREE.BoxGeometry(0.28, 0.75, 0.28).rotateZ(-sg * 0.35).translate(x0 + sg * rl / 2, y0 + h + 0.36, z0)));
    for (let k = 1; k <= 3; k++) RG.push(fixUv(box(0.14, 0.2, 0.14, x0 + sg * (rl / 2 - k * 0.42), y0 + h + 0.32, z0)));
  }
  DG.push(box(L * 0.88, 0.14, D * 0.84, x0, y0 - 0.02, z0));
}
// rows of bracket blocks (dougong) under an eave
function brackets(xa, xb, y, zHalf, z0 = 0, RG = roofG, DG = redG) {
  const n = Math.max(2, Math.round((xb - xa) / 0.62));
  for (let i = 0; i <= n; i++) for (const sz of [-1, 1]) {
    const x = lerp(xa, xb, i / n);
    (i % 2 ? RG : DG).push(fixUv(box(0.26, 0.22, 0.42, x, y, z0 + sz * zHalf)));
    (i % 2 ? DG : RG).push(fixUv(box(0.34, 0.12, 0.3, x, y + 0.17, z0 + sz * (zHalf + 0.12))));
  }
}
for (const [x, hh, s] of [[-3.4, 10, 0.8], [3.4, 10, 0.8], [-7, 7.5, 0.7], [7, 7.5, 0.7]]) {
  stoneG.push(box(s, hh, s, x, Y0 + hh / 2, 0), box(s + 0.5, 0.9, 2.5, x, Y0 + 0.45, 0), box(s + 0.26, 0.35, s + 0.26, x, Y0 + 1.1, 0));
  stoneG.push(box(s + 0.16, 0.22, s + 0.16, x, Y0 + hh * 0.46, 0), box(s + 0.2, 0.3, s + 0.2, x, Y0 + hh - 0.5, 0)); // pillar bands
  for (const sz of [-1, 1]) {
    stoneG.push(new THREE.CylinderGeometry(0.62, 0.62, 0.36, 16).rotateZ(Math.PI / 2).translate(x, Y0 + 1.3, sz * 0.98));
    stoneG.push(new THREE.CylinderGeometry(0.34, 0.34, 0.44, 12).rotateZ(Math.PI / 2).translate(x, Y0 + 1.3, sz * 0.98)); // drum boss
  }
}
stoneG.push(box(7.7, 0.7, 0.7, 0, Y0 + 6.65, 0), box(6.0, 2.4, 0.3, 0, Y0 + 8.2, 0), box(7.7, 0.6, 0.7, 0, Y0 + 9.7, 0));
for (const sx of [-1, 1]) stoneG.push(box(0.5, 0.5, 0.9, sx * 4.05, Y0 + 6.65, 0), box(0.5, 0.42, 0.9, sx * 4.05, Y0 + 9.7, 0)); // beam end caps
for (let i = -3; i <= 3; i++) stoneG.push(box(0.5, 0.3, 0.78, i * 0.95, Y0 + 6.1, 0));                                         // carved corbels under the lintel
redG.push(box(8.2, 0.3, 1.3, 0, Y0 + 10.15, 0), box(8.9, 0.2, 1.9, 0, Y0 + 10.4, 0));
brackets(-4.3, 4.3, Y0 + 10.13, 0.82);
makeRoof(10.6, 4.0, 1.5, 0.95, 0, Y0 + 10.5, 0);
for (const sx of [-1, 1]) {
  stoneG.push(box(4.3, 0.55, 0.6, sx * 5.2, Y0 + 4.9, 0), box(3.0, 1.5, 0.25, sx * 5.2, Y0 + 5.9, 0), box(4.3, 0.5, 0.6, sx * 5.2, Y0 + 6.9, 0));
  stoneG.push(box(2.2, 0.9, 0.34, sx * 5.2, Y0 + 5.9, 0)); // raised panel
  redG.push(box(4.6, 0.25, 1.1, sx * 5.4, Y0 + 7.3, 0), box(5.0, 0.18, 1.6, sx * 5.5, Y0 + 7.5, 0));
  brackets(sx * 5.5 - 2.2, sx * 5.5 + 2.2, Y0 + 7.27, 0.66);
  makeRoof(6.0, 3.2, 1.15, 0.7, sx * 5.6, Y0 + 7.6, 0);
  // hanging lantern in each side bay
  goldG.push(box(0.05, 0.5, 0.05, sx * 5.2, Y0 + 4.4, 0), new THREE.CylinderGeometry(0.2, 0.2, 0.1, 10).translate(sx * 5.2, Y0 + 4.13, 0), new THREE.CylinderGeometry(0.2, 0.2, 0.1, 10).translate(sx * 5.2, Y0 + 3.4, 0), box(0.06, 0.45, 0.06, sx * 5.2, Y0 + 3.15, 0));
  hangG.push(new THREE.SphereGeometry(0.4, 14, 10).scale(1, 0.85, 1).translate(sx * 5.2, Y0 + 3.77, 0));
  const x = sx * 8.6, z = 5.6; // stone lanterns
  stoneG.push(box(0.8, 0.25, 0.8, x, Y0 + 0.125, z), box(0.36, 1.5, 0.36, x, Y0 + 1.0, z), box(0.9, 0.14, 0.9, x, Y0 + 1.8, z));
  lampG.push(box(0.56, 0.6, 0.56, x, Y0 + 2.17, z));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) stoneG.push(box(0.1, 0.62, 0.1, x + dx * 0.3, Y0 + 2.17, z + dz * 0.3));
  makeRoof(1.5, 1.5, 0.5, 0.22, x, Y0 + 2.47, z);
}
// balustrade around the terrace (open at the lake steps and at the stairway)
{
  const post = (x, z) => stoneG.push(box(0.3, 1.15, 0.3, x, Y0 + 0.575, z), box(0.4, 0.14, 0.4, x, Y0 + 1.2, z), box(0.22, 0.16, 0.22, x, Y0 + 1.33, z));
  const run = (xa, za, xb, zb) => {
    const len = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.round(len / 2.1)), alongX = Math.abs(xb - xa) > Math.abs(zb - za);
    for (let i = 0; i <= n; i++) post(lerp(xa, xb, i / n), lerp(za, zb, i / n));
    for (let i = 0; i < n; i++) {
      const x = lerp(xa, xb, (i + 0.5) / n), z = lerp(za, zb, (i + 0.5) / n), l = len / n - 0.3;
      stoneG.push(alongX ? box(l, 0.14, 0.16, x, Y0 + 0.98, z) : box(0.16, 0.14, l, x, Y0 + 0.98, z));
      stoneG.push(alongX ? box(l, 0.5, 0.09, x, Y0 + 0.5, z) : box(0.09, 0.5, l, x, Y0 + 0.5, z));
    }
  };
  for (const sx of [-1, 1]) { run(sx * 10.7, -8.7, sx * 10.7, 6.7); run(sx * 5.5, 6.7, sx * 10.7, 6.7); run(sx * 4.0, -8.7, sx * 10.7, -8.7); }
}
// sect hall at the head of the stairway (double-eaved), a solid obstacle
const HALL = { x0: -8.4, x1: 8.4, z0: -45.6, z1: -34.6, y1: 6.2 + 11.6 };
{
  const hy = 6.2, hz = -40;
  stoneG.push(box(17.6, 1.6, 11.6, 0, hy + 0.1, hz), box(6, 0.5, 1.0, 0, hy + 0.15, hz + 6.3), box(6, 0.25, 1.0, 0, hy + 0.02, hz + 7.2));
  redG.push(box(13.6, 4.4, 6.8, 0, hy + 3.1, hz - 0.6));
  for (let i = 0; i < 6; i++) redG.push(new THREE.CylinderGeometry(0.3, 0.33, 4.4, 10).translate(-7 + i * 2.8, hy + 3.1, hz + 4.2));
  for (let i = 0; i < 6; i++) stoneG.push(new THREE.CylinderGeometry(0.42, 0.48, 0.3, 10).translate(-7 + i * 2.8, hy + 1.05, hz + 4.2));
  lampG.push(box(2.6, 3.0, 0.1, 0, hy + 2.4, hz + 2.83));                                           // lit doorway
  for (const sx of [-1, 1]) lampG.push(box(1.5, 1.2, 0.1, sx * 4.2, hy + 3.2, hz + 2.83));          // lit lattice windows
  for (const sx of [-1, 1]) for (let k = -1; k <= 1; k++) redG.push(box(0.08, 1.24, 0.14, sx * 4.2 + k * 0.42, hy + 3.2, hz + 2.86));
  redG.push(box(0.1, 3.0, 0.14, 0, hy + 2.4, hz + 2.86), box(15.4, 0.4, 9.6, 0, hy + 5.45, hz));
  brackets(-7.3, 7.3, hy + 5.35, 4.9, hz);
  makeRoof(18.4, 12.2, 2.3, 1.3, 0, hy + 5.7, hz);
  redG.push(box(9.6, 1.5, 4.6, 0, hy + 8.2, hz));
  brackets(-4.9, 4.9, hy + 8.9, 2.45, hz);
  makeRoof(12.6, 7.4, 2.4, 1.1, 0, hy + 9.1, hz);
  goldG.push(new THREE.SphereGeometry(0.34, 10, 8).translate(0, hy + 11.9, hz), box(3.2, 0.9, 0.1, 0, hy + 6.4, hz + 4.7)); // ridge pearl, name board
}
// small pagodas on the rim hilltops
function pagoda(x, y, z, s, tiers, SG = stoneG, RG = roofG, DG = redG, GG = goldG) {
  SG.push(box(4.4 * s, 0.9 * s, 4.4 * s, x, y + 0.45 * s, z));
  let top = y + 0.9 * s;
  for (let k = 0; k < tiers; k++) {
    const w = (3.0 - 0.5 * k) * s;
    DG.push(box(w, 1.7 * s, w, x, top + 0.85 * s, z));
    SG.push(box(w * 0.45, 1.0 * s, w + 0.06 * s, x, top + 0.75 * s, z), box(w + 0.06 * s, 1.0 * s, w * 0.45, x, top + 0.75 * s, z)); // doorways
    makeRoof(w * 1.95, w * 1.95, 0.75 * s, 0.5 * s, x, top + 1.7 * s, z, RG, DG);
    top += 2.35 * s;
  }
  GG.push(new THREE.ConeGeometry(0.22 * s, 1.5 * s, 8).translate(x, top + 0.75 * s, z), new THREE.SphereGeometry(0.26 * s, 8, 6).translate(x, top + 0.2 * s, z));
}
{
  const cands = [];
  for (let x = -105; x <= 105; x += 5) for (let z = LC.z - 105; z <= LC.z + 105; z += 5) {
    const h = terrainH(x, z);
    if (h > 17 && Math.hypot(x - LC.x, z - LC.z) < 100 && h >= terrainH(x + 5, z) && h >= terrainH(x - 5, z) && h >= terrainH(x, z + 5) && h >= terrainH(x, z - 5)) cands.push([h, x, z]);
  }
  cands.sort((a, b) => b[0] - a[0]);
  const chosen = [];
  for (const c of cands) { if (chosen.length < 4 && chosen.every((d) => Math.hypot(d[1] - c[1], d[2] - c[2]) > 60)) chosen.push(c); }
  chosen.forEach(([h, x, z], i) => pagoda(x, h - 0.8, z, 1.0, i === 0 ? 4 : 3));
}
world.add(cast(new THREE.Mesh(mergeGeometries(stoneG), MAT.stone)));
world.add(cast(new THREE.Mesh(mergeGeometries(roofG), MAT.roof)));
world.add(cast(new THREE.Mesh(mergeGeometries(redG), MAT.red)));
world.add(cast(new THREE.Mesh(mergeGeometries(goldG), MAT.gold)));
world.add(new THREE.Mesh(mergeGeometries(lampG), surfMat(K.EMIT, { tint: [4.2, 2.3, 0.9] })));
world.add(new THREE.Mesh(mergeGeometries(hangG), surfMat(K.EMIT, { tint: [3.6, 0.7, 0.22] })));

const CJK_FONT = '"Songti SC","STSong","Kaiti SC","STKaiti","Noto Serif CJK SC","Source Han Serif SC","SimSun","PingFang SC","Microsoft YaHei",serif';
// plaques: characters drawn with the Canvas 2D API. vertical = one character per row (pillar couplets).
function plaqueTexture(text, cw, ch, fontPx, vertical) {
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, ch); bg.addColorStop(0, '#0d1626'); bg.addColorStop(1, '#070c16');
  g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
  const gold = g.createLinearGradient(0, 0, 0, ch);
  gold.addColorStop(0, '#ffe7a0'); gold.addColorStop(0.55, '#f2c25a'); gold.addColorStop(1, '#c88a2a');
  const m = Math.min(cw, ch);
  g.strokeStyle = gold; g.lineWidth = m * 0.04; g.strokeRect(m * 0.035, m * 0.035, cw - m * 0.07, ch - m * 0.07);
  g.lineWidth = m * 0.01; g.strokeRect(m * 0.095, m * 0.095, cw - m * 0.19, ch - m * 0.19);
  g.fillStyle = gold; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${fontPx}px ${CJK_FONT}`;
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = fontPx * 0.04; g.shadowOffsetY = fontPx * 0.02;
  const chars = [...text], n = chars.length;
  chars.forEach((c, i) => (vertical ? g.fillText(c, cw / 2, ch * (0.5 + (i - (n - 1) / 2) * (0.86 / n))) : g.fillText(c, cw * (0.5 + (i - (n - 1) / 2) * 0.3), ch * 0.52)));
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
{
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 2.14), surfMat(K.PLAQUE, { map: plaqueTexture('青云宗', 1400, 544, 330, false) }));
  m.position.set(0, Y0 + 8.2, 0.36); m.rotation.x = 0.09; world.add(m);
  // couplets on the inner pillars (upper line on the viewer's right, as is traditional)
  for (const [sx, text] of [[1, '青云直上三千界'], [-1, '紫气东来第一峰']]) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 4.4), surfMat(K.PLAQUE, { map: plaqueTexture(text, 192, 1280, 138, true) }));
    c.position.set(sx * 3.4, Y0 + 3.9, 0.43); world.add(c);
  }
}
// shimmering veil in the centre opening, visible once the gate is unlocked
const portal = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 6.3).translate(0, Y0 + 3.15, 0), new THREE.ShaderMaterial({
  uniforms: U, vertexShader: SURF_VERT,
  fragmentShader: COMMON + /* glsl */ `varying vec3 vWp; varying vec2 vUv; uniform float uGlow;
    void main(){
      if (uMirror < 0.0 && vWp.y < 0.0) discard;
      float n = fbm3(vec3(vUv * vec2(3.0, 3.0) + vec2(0.0, -uTime*0.5), uTime*0.3));
      float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(0.0, 0.25, 1.0 - vUv.x) * smoothstep(0.0, 0.2, 1.0 - vUv.y);
      gl_FragColor = vec4(vec3(0.45,1.0,0.85) * (0.25 + 1.5 * smoothstep(0.4, 0.75, n)) * edge * uGlow, 1.0);
    }`,
  side: THREE.DoubleSide, ...ADDITIVE,
}));
world.add(portal);
// a pillar of light over the gate once it is unlocked
const beam = new THREE.Mesh(new THREE.CylinderGeometry(9, 2.4, 560, 28, 1, true).translate(0, Y0 + 284, 0), new THREE.ShaderMaterial({
  uniforms: U, vertexShader: SURF_VERT,
  fragmentShader: COMMON + /* glsl */ `varying vec3 vWp; varying vec3 vN; varying vec2 vUv; uniform float uGlow;
    void main(){
      if (uMirror < 0.0 && vWp.y < 0.0) discard;
      vec3 V = normalize(uCamTrue - vWp);
      float edge = pow(abs(dot(normalize(vN), V)), 1.6);
      float n = fbm3(vec3(vUv.x * 9.0, vUv.y * 16.0 - uTime * 1.3, uTime * 0.2));
      float a = edge * (0.3 + 1.0 * n) * pow(1.0 - vUv.y, 1.7) * uGlow * (0.8 + 0.2 * sin(uTime * 4.0));
      gl_FragColor = vec4(vec3(1.0, 0.80, 0.44) * a * 0.85, 1.0);
    }`,
  side: THREE.DoubleSide, ...ADDITIVE,
}));
world.add(beam);

// ---------------------------------------------------------------- hillside vegetation: pines, bushes, boulders
{
  const rnd = mulberry32(4242), pines = [], bushes = [], boulders = []; let tries = 0;
  const steep = (x, z, h) => Math.max(Math.abs(terrainH(x + 1.5, z) - h), Math.abs(terrainH(x, z + 1.5) - h));
  const corridor = (x, z) => Math.abs(x) < 11.5 && z < 12 && z > -47;
  while (pines.length < 270 && tries++ < 9000) {
    const x = LC.x - 118 + rnd() * 236, z = LC.z - 118 + rnd() * 236, h = terrainH(x, z);
    if (h < 1.6 || h > 38 || corridor(x, z) || steep(x, z, h) > 2.2) continue;
    if (fbm(x * 0.035 + 40, 3.1, z * 0.035 + 17, 2) < 0.40) continue; // groves, not an even scatter
    pines.push(...pineGeo(3.4 + rnd() * rnd() * 6.5, x, h - 0.3, z, rnd(), Math.floor(rnd() * 9), Math.hypot(x - LC.x, z - LC.z) < 78)); // detailed only round the lake
  }
  tries = 0;
  while (bushes.length < 420 && tries++ < 6000) {
    const x = LC.x - 112 + rnd() * 224, z = LC.z - 112 + rnd() * 224, h = terrainH(x, z);
    if (h < 0.9 || h > 34 || corridor(x, z) || steep(x, z, h) > 1.8) continue;
    const s = 0.5 + rnd() * 1.0, g = new THREE.SphereGeometry(s, 7, 5).scale(1 + rnd() * 0.6, 0.62, 1 + rnd() * 0.6), a = g.attributes.uv, t = rnd();
    for (let i = 0; i < a.count; i++) a.setXY(i, t, 1);
    bushes.push(g.rotateY(rnd() * 3).translate(x, h + s * 0.2, z));
  }
  tries = 0;
  while (boulders.length < 260 && tries++ < 6000) {
    const x = LC.x - 115 + rnd() * 230, z = LC.z - 115 + rnd() * 230, h = terrainH(x, z);
    if (h < -0.6 || h > 36 || (Math.abs(x) < 11.5 && z < 9 && z > -47)) continue;
    const s = 0.35 + rnd() * rnd() * 2.6, ox = rnd() * 30, oz = rnd() * 30;
    boulders.push(paramSurface(9, 6, (u, v) => {
      const lon = u * Math.PI * 2, lat = (v - 0.5) * Math.PI, dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
      const r = s * (0.6 + 0.8 * vnoise(dx * 1.4 + ox, dy * 1.4, dz * 1.4 + oz));
      return [x + dx * r * 1.25, h + s * 0.15 + dy * r * 0.8, z + dz * r];
    }, true));
  }
  world.add(cast(new THREE.Mesh(mergeGeometries(pines), MAT.tree)));
  world.add(cast(new THREE.Mesh(mergeGeometries(bushes), MAT.pine)));
  world.add(cast(new THREE.Mesh(mergeGeometries(boulders), surfMat(K.PEAK))));
}

// ---------------------------------------------------------------- lily pads and lotus in the shallows
{
  const rnd = mulberry32(8080), pads = [], petals = []; let tries = 0, n = 0;
  while (n < 150 && tries++ < 6000) {
    const x = LC.x - 60 + rnd() * 120, z = LC.z - 60 + rnd() * 120, h = terrainH(x, z);
    if (h > -0.25 || h < -1.75 || (Math.abs(x) < 8 && z < 20)) continue;
    if (fbm(x * 0.09 + 3, 9.1, z * 0.09 + 5, 2) < 0.46) continue; // clusters
    const r = 0.3 + rnd() * 0.55;
    pads.push(new THREE.CircleGeometry(r, 12).rotateX(-Math.PI / 2).rotateY(rnd() * 6.28).translate(x, 0.035 + rnd() * 0.01, z)); n++;
    if (rnd() < 0.16) { // a lotus bloom: two rings of petals
      petals.push(modelGeometry(MODELS.lotus, { scale: 1.2 + rnd() * 0.6, rotY: rnd() * 6.28, at: [x + 0.2, 0.02, z + 0.1] }));
    }
  }
  world.add(new THREE.Mesh(mergeGeometries(pads), surfMat(K.LILY, { tint: [0.1, 0.3, 0.1] })));
  if (petals.length) world.add(new THREE.Mesh(mergeGeometries(petals), MAT.bloom));
}

// ---------------------------------------------------------------- peach blossom round the lake, incense burners before the hall
{
  const rnd = mulberry32(2718), trees = [], spots = []; let tries = 0;
  while (spots.length < 24 && tries++ < 6000) {
    const a = rnd() * 6.283, r = 47 + rnd() * 20, x = LC.x + Math.sin(a) * r, z = LC.z + Math.cos(a) * r, h = terrainH(x, z);
    if (h < 0.5 || h > 6 || (Math.abs(x) < 12.5 && z < 16)) continue;
    if (spots.some((p) => Math.hypot(p[0] - x, p[1] - z) < 6.5)) continue;
    spots.push([x, z, h]);
  }
  for (const [x, z, h] of spots) {
    const name = rnd() < 0.5 ? 'peach0' : 'peach1';
    trees.push(modelGeometry(MODELS[name], { scale: (3.8 + rnd() * 2.4) / MODEL_META[name].max[2], rotY: rnd() * 6.28, at: [x, h - 0.15, z], tint: [1, 0.9 + rnd() * 0.14, 0.94 + rnd() * 0.1] }));
  }
  world.add(cast(new THREE.Mesh(mergeGeometries(trees), MAT.tree)));
  const smokeMat = new THREE.ShaderMaterial({ // incense smoke: a noise ribbon that widens and thins as it climbs
    uniforms: U, vertexShader: SURF_VERT,
    fragmentShader: COMMON + /* glsl */ `varying vec3 vWp; varying vec2 vUv;
      void main(){
        if (uMirror < 0.0 && vWp.y < 0.0) discard;
        float h = vUv.y, x = (vUv.x - 0.5) / (0.12 + 0.5 * h) + sin(h * 6.0 - uTime * 0.7 + vWp.x) * 0.5 * h;
        float n = fbm3(vec3(x * 1.4, h * 4.0 - uTime * 0.5, uTime * 0.12 + vWp.x));
        float a = smoothstep(1.0, 0.2, abs(x)) * smoothstep(0.3, 0.7, n) * smoothstep(0.0, 0.08, h) * (1.0 - h) * (1.0 - h);
        gl_FragColor = vec4(vec3(0.80, 0.74, 0.70) * a * 0.42, 1.0);
      }`,
    side: THREE.DoubleSide, ...ADDITIVE,
  });
  const dings = [];
  for (const sx of [-1, 1]) {
    const x = sx * 5.8, z = -31.2, y = terrainH(x, z) - 0.05, sc = 1.25;
    dings.push(modelGeometry(MODELS.ding, { scale: sc, rotY: sx * 0.4, at: [x, y, z] }));
    for (const r of [0, Math.PI / 2]) world.add(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 9).rotateY(r).translate(x, y + MODEL_META.ding.top * sc + 4.3, z), smokeMat));
  }
  world.add(cast(new THREE.Mesh(mergeGeometries(dings), MAT.bronze)));
}
// falling peach petals over the lake basin (the field wraps around the player)
{
  const N = 420, rnd = mulberry32(1618), pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { pos.set([rnd() * 70, rnd() * 30, rnd() * 70], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { ...U, uLake: { value: new THREE.Vector2(LC.x, LC.z) } },
    vertexShader: /* glsl */ `
      uniform float uTime, uProj; uniform vec3 uFocus; uniform vec2 uLake;
      attribute vec4 aSeed; varying vec4 vSeed; varying float vFade;
      void main(){
        vec3 p = position;
        p.y -= uTime * (0.55 + aSeed.x * 0.7);
        p.x += sin(uTime * 0.6 + aSeed.y * 6.283) * (1.0 + aSeed.z) + uTime * 0.8;
        p.z += cos(uTime * 0.5 + aSeed.w * 6.283) * (1.0 + aSeed.x);
        vec3 box = vec3(70.0, 30.0, 70.0);
        p = uFocus + mod(p - uFocus + box * 0.5, box) - box * 0.5;
        vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
        float vz = -mv.z; vSeed = aSeed;
        vec3 q = abs(p - uFocus) / (box * 0.5);
        vFade = smoothstep(0.1, 0.8, p.y) * (1.0 - smoothstep(0.8, 1.0, max(q.x, max(q.y, q.z)))) * smoothstep(1.5, 4.0, vz)
              * (1.0 - smoothstep(70.0, 105.0, length(p.xz - uLake))) * (1.0 - smoothstep(22.0, 34.0, p.y));
        gl_PointSize = clamp((0.09 + 0.09 * aSeed.z) * uProj / max(vz, 0.1), 1.0, 26.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; uniform float uTime; varying vec4 vSeed; varying float vFade;
      void main(){
        float a = uTime * (1.0 + vSeed.y * 2.0) + vSeed.w * 6.283;
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * (gl_PointCoord - 0.5) * 2.0;
        q.y *= 1.5 + 1.2 * abs(sin(a * 0.7 + vSeed.x * 6.0)); // tumbling: the petal turns edge-on
        float m = 1.0 - smoothstep(0.75, 1.0, length(q));
        vec3 c = mix(vec3(1.0, 0.62, 0.74), vec3(1.0, 0.90, 0.92), vSeed.z) * (0.85 + 0.5 * vSeed.x);
        gl_FragColor = vec4(c * 1.15, m * vFade * 0.9);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));
  pts.frustumCulled = false; world.add(pts);
}

// ---------------------------------------------------------------- floating rocks (obstacles)
function rockGeo(seed, nu = 44, nv = 30) {
  const rnd = mulberry32(seed), ox = rnd() * 40, oy = rnd() * 40, oz = rnd() * 40;
  return paramSurface(nu, nv, (u, v) => {
    const lon = u * Math.PI * 2, lat = (v - 0.5) * Math.PI;
    const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
    const r = 0.62 + 0.75 * fbm(dx * 1.5 + ox, dy * 1.5 + oy, dz * 1.5 + oz, 4) + 0.07 * vnoise(dx * 7 + ox, dy * 7 + oy, dz * 7 + oz);
    let y = dy * r;
    if (y > 0) y *= 0.32; else y *= 1.5 + 1.4 * fbm(dx * 2.6 + ox, 3.3, dz * 2.6 + oz, 3);
    return [dx * r, y, dz * r];
  }, true);
}
const fallMat = new THREE.ShaderMaterial({ // thin waterfalls spilling off the larger rocks and dissolving into mist
  uniforms: U, vertexShader: SURF_VERT,
  fragmentShader: COMMON + /* glsl */ `varying vec3 vWp; varying vec2 vUv;
    void main(){
      if (uMirror < 0.0 && vWp.y < 0.0) discard;
      float fall = 1.0 - vUv.y;
      float n = vnoise(vec3(vUv.x * 5.0, vUv.y * 9.0 + uTime * (2.2 + fall * 2.0), 2.0)) * 0.6 + vnoise(vec3(vUv.x * 14.0, vUv.y * 30.0 + uTime * 6.0, 7.0)) * 0.4;
      float a = smoothstep(0.25, 0.7, n) * smoothstep(0.0, 0.25, vUv.x) * smoothstep(0.0, 0.25, 1.0 - vUv.x) * smoothstep(0.0, 0.06, fall) * (1.0 - smoothstep(0.55, 1.0, fall));
      gl_FragColor = vec4(vec3(0.75,0.85,0.95) * a * 0.55, 1.0);
    }`,
  side: THREE.DoubleSide, ...ADDITIVE,
});
const rocks = [];
{
  const rnd = mulberry32(99);
  ROCK_DEFS.forEach(([x, y, z, s, pine], i) => {
    const g = new THREE.Group();
    const m = cast(new THREE.Mesh(rockGeo(500 + i), MAT.frock)); m.scale.setScalar(s); g.add(m);
    if (pine) {
      const pg = [...pineGeo(s * 0.8, s * 0.15, s * 0.16, -s * 0.1, 0.3, i), ...pineGeo(s * 0.5, -s * 0.3, s * 0.14, s * 0.2, 0.7, i + 3)];
      g.add(cast(new THREE.Mesh(mergeGeometries(pg), MAT.tree)));
    }
    if (s >= 6.5) { // a little pavilion on the largest rocks
      const SG = [], RG = [], DG = [], GG = [];
      pagoda(-s * 0.28, s * 0.12, s * 0.05, s * 0.13, 2, SG, RG, DG, GG);
      g.add(cast(new THREE.Mesh(mergeGeometries(SG), MAT.stone)), cast(new THREE.Mesh(mergeGeometries(RG), MAT.roof)), cast(new THREE.Mesh(mergeGeometries(DG), MAT.red)), new THREE.Mesh(mergeGeometries(GG), MAT.gold));
    }
    if (s >= 5) { // waterfall
      const a = rnd() * 6.28, L = 40 + s * 4;
      for (const rot of [0, Math.PI / 2]) g.add(new THREE.Mesh(new THREE.PlaneGeometry(s * 0.3, L).rotateY(rot).translate(Math.cos(a) * s * 0.55, s * 0.1 - L / 2, Math.sin(a) * s * 0.55), fallMat));
    }
    const debris = [];
    for (let k = 0; k < 4; k++) {
      const dm = cast(new THREE.Mesh(rockGeo(900 + i * 7 + k, 16, 12), MAT.frock)); dm.scale.setScalar(s * (0.08 + rnd() * 0.15));
      const a = rnd() * Math.PI * 2, rr = s * (1.3 + rnd() * 0.9);
      const base = new THREE.Vector3(Math.cos(a) * rr, (rnd() - 0.6) * s * 1.2, Math.sin(a) * rr);
      dm.position.copy(base); g.add(dm); debris.push({ m: dm, base, ph: rnd() * 6.28, T: 4 + rnd() * 3 });
    }
    g.position.set(x, y, z); world.add(g);
    rocks.push({ g, x, y, z, s, amp: 0.35 + s * 0.14, T: 6.5 + rnd() * 3.5, ph: rnd() * 6.28, rot: rnd() * 6.28, rs: (rnd() - 0.5) * 0.06, debris });
  });
}

// ---------------------------------------------------------------- cranes circling in formation (one instanced Blender model)
{
  const flocks = [[LC.x, 78, LC.z, 135, 9, 0.11], [-150, 150, -300, 90, 7, -0.09], [220, 110, 120, 70, 5, 0.13], [LC.x + 12, 36, LC.z - 24, 92, 7, 0.125]];
  const orbit = [], bird = [];
  for (const [cx, cy, cz, R, n, w] of flocks) for (let i = 0; i < n; i++) {
    const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1; // V formation
    orbit.push(cx, cy + row * 0.8, cz, R); bird.push(-(row * 3.6) / R * Math.sign(w), i ? side * row * 2.6 : 0, i * 1.7, w);
  }
  const base = modelGeometry(MODELS.crane, { scale: 1.5 });
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const k of ['position', 'normal', 'aColor']) g.setAttribute(k, base.getAttribute(k));
  g.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(new Float32Array(orbit), 4));
  g.setAttribute('aBird', new THREE.InstancedBufferAttribute(new Float32Array(bird), 4));
  g.instanceCount = orbit.length / 4;
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `
      uniform float uTime, uMirror; attribute vec4 aOrbit, aBird, aColor; varying vec3 vWp; varying vec3 vN; varying vec4 vCol;
      void main(){
        float phase = aBird.z, out1 = clamp((abs(position.x) - 0.25) / 3.3, 0.0, 1.0); // how far out along the wing
        float a = uTime * aBird.w + aBird.x;
        vec3 radial = vec3(cos(a), 0.0, sin(a)), tang = vec3(-sin(a), 0.0, cos(a)) * sign(aBird.w);
        vec3 c = aOrbit.xyz + radial * (aOrbit.w + aBird.y);
        float beat = sin(uTime * 3.2 + phase);
        float flap = beat * out1 * out1 * 1.9 + out1 * 0.3;
        vec3 p = c + radial * position.x * (1.0 - 0.14 * out1 * abs(beat)) - tang * position.z
               + vec3(0.0, position.y + flap + sin(uTime * 0.7 + phase) * 0.6 - beat * 0.12, 0.0);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWp = wp.xyz * vec3(1.0, uMirror, 1.0);
        vN = radial * normal.x + vec3(0.0, normal.y, 0.0) - tang * normal.z;
        vCol = aColor;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: COMMON + /* glsl */ `varying vec3 vWp; varying vec3 vN; varying vec4 vCol;
      void main(){ if (uMirror < 0.0 && vWp.y < 0.0) discard;
        vec3 N = normalize(vN);
        vec3 light = mix(vec3(0.34,0.33,0.42), vec3(0.62,0.66,0.82), N.y * 0.5 + 0.5) + SUN_COL * 0.42 * max(dot(N, uSunDir), 0.0);
        gl_FragColor = vec4(applyFog(vCol.rgb * light, vWp), 0.0); }`,
    side: THREE.DoubleSide,
  }));
  m.frustumCulled = false; world.add(m);
}

// ---------------------------------------------------------------- the azure dragon
// One straight Blender model, bent along its flight path in the vertex shader. It circles high and far away until the
// gate is unlocked, then comes down to coil round the lake.
const dragonU = { uDA: { value: 0 }, uDPath: { value: new THREE.Vector3(380, 250, 14) }, uDCen: { value: new THREE.Vector2(LC.x, LC.z) } };
const dragonMat = surfMat(K.MODEL, {
  detail: 0.9, spec: 0.7, emis: 1.2, rim: [0.02, 0.10, 0.09], uniforms: dragonU,
  vert: /* glsl */ `
    uniform float uMirror, uTime, uDA; uniform vec3 uDPath; uniform vec2 uDCen; // path: radius, height, bob
    attribute vec4 aColor;
    varying vec3 vWp; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying vec4 vCol;
    vec3 path(float a){ return vec3(uDCen.x + uDPath.x * cos(a), uDPath.y + uDPath.z * sin(a * 2.0 + 1.0), uDCen.y + uDPath.x * 0.82 * sin(a)); }
    void main(){
      float s = position.z;                       // metres behind the head (negative: the snout)
      float a = uDA - s / uDPath.x;
      vec3 c = path(a);
      vec3 T = normalize(path(a + 0.012) - path(a - 0.012));
      vec3 B = normalize(cross(T, vec3(0.0, 1.0, 0.0)));
      vec3 Nn = cross(B, T);
      float w = smoothstep(-2.0, 10.0, s);        // the head leads steadily, the body snakes after it
      c += Nn * sin(s * 0.30 - uTime * 2.4) * 1.7 * w + B * cos(s * 0.19 - uTime * 1.7) * 1.4 * w;
      vec4 wp = modelMatrix * vec4(c + B * position.x + Nn * position.y, 1.0);
      vWp = wp.xyz * vec3(1.0, uMirror, 1.0);
      vN = (mat3(modelMatrix) * (B * normal.x + Nn * normal.y - T * normal.z)) * vec3(1.0, uMirror, 1.0);
      vObj = position; vUv = vec2(0.0); vCol = aColor;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
});
{
  const m = new THREE.Mesh(modelGeometry(MODELS.dragon, { scale: 1.4 }), dragonMat);
  m.frustumCulled = false; world.add(m);
}
// swoop: 0 while the gate is locked, easing to 1 over the nine seconds after it opens
function updateDragon(dt) {
  const k = G.glowT >= 0 ? smooth(0, 9, G.t - G.glowT) : 0;
  const R = lerp(380, 74, k), speed = lerp(20, 30, k);
  dragonU.uDA.value += (speed / R) * dt;
  dragonU.uDPath.value.set(R, lerp(250, 38, k), lerp(14, 7, k));
  dragonMat.uniforms.uEmis.value = lerp(1.2, 3.2, k);
}

// ---------------------------------------------------------------- lake
const ripData = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
let ripNext = 0;
const waterMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uRefl: { value: null }, uRip: { value: ripData } },
  vertexShader: SURF_VERT,
  fragmentShader: COMMON + /* glsl */ `
    varying vec3 vWp;
    uniform sampler2D uRefl; uniform vec2 uRes; uniform vec4 uRip[${RIPPLES}];
    float rings(vec2 q){ // wake rings left where the player skims the surface: (x, z, start time, strength)
      float s = 0.0;
      for (int i = 0; i < ${RIPPLES}; i++) {
        float age = uTime - uRip[i].z;
        if (age > 0.0 && age < 5.0) {
          float front = age * 3.2, x = length(q - uRip[i].xy) - front;
          s += uRip[i].w * sin(x * 4.0) * exp(-x*x*0.5) * exp(-age*0.8) * smoothstep(0.0, 0.25, age) / (1.0 + front*0.25);
        }
      }
      return s;
    }
    float height(vec2 q){
      float t = uTime;
      return vnoise(vec3(q*0.45 + vec2(0.07,0.03)*t, t*0.16)) * 0.13 + vnoise(vec3(q*1.3 - vec2(0.05,0.09)*t, 4.0 + t*0.27)) * 0.045 + rings(q) * 0.16;
    }
    void main(){
      vec3 toCam = uCamTrue - vWp; float d = length(toCam); vec3 V = toCam / d;
      vec2 q = vWp.xz; float e = 0.07;
      float h0 = height(q);
      vec2 slope = vec2(height(q + vec2(e,0.0)) - h0, height(q + vec2(0.0,e)) - h0) / e / (1.0 + d*0.02);
      vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
      // planar reflection: the mirrored scene was rendered through the same camera, so sample it at this
      // fragment's own screen position, offset by the ripple normal
      vec2 uv = clamp(gl_FragCoord.xy / uRes + N.xz * vec2(0.06, 0.13) / (1.0 + d*0.015), vec2(0.002), vec2(0.998));
      vec3 refl = texture2D(uRefl, uv).rgb;
      float F = mix(0.46, 1.0, pow(1.0 - max(dot(N, V), 0.0), 3.0));
      vec3 col = mix(vec3(0.012,0.045,0.06), refl * 0.96, F);
      col += SUN_COL * pow(max(dot(reflect(-V, N), uSunDir), 0.0), 700.0) * 1.2;
      gl_FragColor = vec4(applyFog(col + waveGlow(vWp) * 0.6, vWp), 0.0);
    }`,
});
const water = new THREE.Mesh(new THREE.CircleGeometry(64, 48).rotateX(-Math.PI / 2).translate(LC.x, 0, LC.z), waterMat);
scene.add(water);
const lakeSphere = new THREE.Sphere(new THREE.Vector3(LC.x, 0, LC.z), 66);

// ---------------------------------------------------------------- spirit-energy particles (an endless field that wraps around the player)
const partMat = new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: /* glsl */ `
    uniform float uTime, uProj, uMirror; uniform vec3 uFocus;
    attribute vec4 aSeed; varying vec4 vSeed; varying float vFade;
    void main(){
      vec3 p = position;
      p.y += uTime * (0.22 + aSeed.x * 0.55);
      p.x += sin(uTime*0.45 + aSeed.y*6.283) * (0.6 + aSeed.z);
      p.z += cos(uTime*0.37 + aSeed.w*6.283) * (0.6 + aSeed.x);
      vec3 box = vec3(90.0, 44.0, 90.0);
      p = uFocus + mod(p - uFocus + box*0.5, box) - box*0.5; // wrap around the player
      vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
      float vz = -mv.z; vSeed = aSeed;
      vec3 q = abs(p - uFocus) / (box*0.5);
      vFade = smoothstep(0.3, 1.5, p.y) * (1.0 - smoothstep(0.8, 1.0, max(q.x, max(q.y, q.z)))) * smoothstep(1.5, 5.0, vz);
      gl_PointSize = clamp((0.10 + 0.22 * aSeed.z * aSeed.z) * uProj / max(vz, 0.1), 1.0, 48.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    precision highp float; uniform float uTime; varying vec4 vSeed; varying float vFade;
    void main(){
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float a = (exp(-r*r*5.0) * 0.55 + exp(-r*r*40.0)) * (1.0 - smoothstep(0.7, 1.0, r));
      float tw = 0.55 + 0.45 * sin(uTime * (1.5 + vSeed.y*2.5) + vSeed.w * 6.283);
      vec3 c = mix(vec3(1.0,0.80,0.42), vec3(0.50,0.95,0.86), step(0.62, vSeed.w));
      gl_FragColor = vec4(c * a * tw * vFade * 2.0, 1.0);
    }`,
  ...ADDITIVE,
});
const particles = (() => {
  const N = 900, rnd = mulberry32(31337), pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { pos.set([rnd() * 90, rnd() * 44, rnd() * 90], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const pts = new THREE.Points(g, partMat); pts.frustumCulled = false; world.add(pts); return pts;
})();

// ---------------------------------------------------------------- spirit orbs
const orbs = ORB_DEFS.map(([x, y, z], i) => ({ x, y, z, i, alive: true, mesh: null }));
const orbCoreMat = surfMat(K.EMIT, { tint: [1.6, 3.2, 2.7] });
const orbCoreGeo = new THREE.SphereGeometry(0.42, 14, 10);
for (const o of orbs) { o.mesh = new THREE.Mesh(orbCoreGeo, orbCoreMat); o.mesh.position.set(o.x, o.y, o.z); world.add(o.mesh); }
const orbBobY = (o, t) => o.y + Math.sin(t * 1.3 + o.i) * 0.4;
const haloGeo = new THREE.BufferGeometry();
haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ORB_DEFS.flat()), 3));
haloGeo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(orbs.map((o) => o.i)), 1));
const haloT = new THREE.BufferAttribute(new Float32Array(ORB_TOTAL).fill(-1), 1); // time of collection, -1 while alive
haloGeo.setAttribute('aT', haloT);
const haloMat = new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: /* glsl */ `
    uniform float uTime, uProj; attribute float aPhase, aT; varying float vA; varying float vBurst;
    void main(){
      vec3 p = position; p.y += sin(uTime*1.3 + aPhase) * 0.4;
      vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
      float age = uTime - aT; bool alive = aT < 0.0;
      float scale = alive ? 1.0 + 0.12 * sin(uTime*3.0 + aPhase) : 1.0 + age * 7.0;
      vA = alive ? 1.0 : max(0.0, 1.0 - age / 0.45); vBurst = alive ? 0.0 : 1.0;
      gl_PointSize = clamp(4.2 * scale * uProj / max(-mv.z, 0.1), alive ? 7.0 : 0.0, 420.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    precision highp float; varying float vA; varying float vBurst;
    void main(){
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float glow = exp(-r*r*6.0) * 0.8 + exp(-r*r*60.0) * 1.6;
      float rr = (r - 0.8) / 0.08, ring = exp(-rr * rr) * 1.5;
      float a = mix(glow, ring + glow * 0.3, vBurst) * (1.0 - smoothstep(0.85, 1.0, r));
      gl_FragColor = vec4(vec3(0.42,1.0,0.82) * a * vA, 1.0);
    }`,
  ...ADDITIVE,
});
const halos = new THREE.Points(haloGeo, haloMat); halos.frustumCulled = false; world.add(halos);
// when an orb is taken its spirit bursts outward, then streams into the rider
const SPARKS = 22;
const sparkT = new THREE.BufferAttribute(new Float32Array(ORB_TOTAL * SPARKS).fill(-1), 1);
{
  const rnd = mulberry32(60606), pos = new Float32Array(ORB_TOTAL * SPARKS * 3), seed = new Float32Array(ORB_TOTAL * SPARKS * 4);
  ORB_DEFS.forEach((o, i) => { for (let k = 0; k < SPARKS; k++) { pos.set(o, (i * SPARKS + k) * 3); seed.set([rnd(), rnd(), rnd(), rnd()], (i * SPARKS + k) * 4); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4)); g.setAttribute('aT', sparkT);
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `
      uniform float uTime, uProj; uniform vec3 uFocus; attribute vec4 aSeed; attribute float aT; varying float vA;
      void main(){
        float age = uTime - aT, u = clamp(age / (0.55 + aSeed.x * 0.6), 0.0, 1.0);
        float e = u * u * (3.0 - 2.0 * u);
        vec3 dir = normalize(aSeed.yzw - 0.5);
        vec3 swirl = cross(dir, vec3(0.0, 1.0, 0.0)) * sin(u * 9.0 + aSeed.x * 6.0) * 0.8 * (1.0 - u);
        vec3 p = mix(position + dir * (4.0 * u * (1.0 - u) + 1.2 * sin(u * 3.1416)) + swirl, uFocus + vec3(0.0, 1.2, 0.0), e * e);
        vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
        bool live = aT >= 0.0 && u < 1.0;
        vA = live ? (1.0 - e * 0.5) * smoothstep(0.0, 0.08, u) : 0.0;
        gl_PointSize = live ? clamp((0.5 + 0.7 * aSeed.x) * (1.0 - 0.5 * e) * uProj / max(-mv.z, 0.1), 1.5, 60.0) : 1.0;
        gl_Position = live ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); // idle sparks are clipped away
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vA;
      void main(){
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (exp(-r * r * 7.0) * 0.7 + exp(-r * r * 60.0) * 1.6) * (1.0 - smoothstep(0.8, 1.0, r));
        gl_FragColor = vec4(mix(vec3(0.42, 1.0, 0.82), vec3(1.0, 0.95, 0.75), a * 0.3) * a * vA * 1.4, 1.0);
      }`,
    ...ADDITIVE,
  }));
  pts.frustumCulled = false; world.add(pts);
}

// ---------------------------------------------------------------- player: rider on a flying sword, with flowing cloth and a light trail
const player = new THREE.Group();
{
  // sword and rider are Blender models; the loose cloth below still streams in the vertex shader
  player.add(cast(new THREE.Mesh(modelGeometry(MODELS.sword), surfMat(K.MODEL, { detail: 30, spec: 1.3, emis: 2.8, rim: [0.16, 0.62, 0.55] }))));
  player.add(cast(new THREE.Mesh(modelGeometry(MODELS.rider, { rotY: 0.3, at: [0, 0.02, 0.1] }), surfMat(K.MODEL, { detail: 24, spec: 0.12, emis: 0.9, tint: [0.70, 0.72, 0.77] }))));
  // cloth strips that stream behind with speed (animated in the vertex shader)
  const CLOTH_VERT = /* glsl */ `
    uniform float uMirror, uTime, uSpeed; attribute vec3 aCloth; // (0..1 along the strip, length, phase)
    varying vec3 vWp; varying vec3 vN; varying vec3 vObj; varying vec2 vUv;
    void main(){
      vec3 p = position; float s = aCloth.x, L = aCloth.y, ph = aCloth.z;
      p.z += s * s * L * (0.30 + 0.75 * uSpeed) + sin(uTime * 5.3 + s * 4.0 + ph * 1.7) * s * 0.07;
      p.y += s * s * L * 0.62 * uSpeed;
      p.x += sin(uTime * 7.0 + s * 5.0 + ph) * s * 0.11 * (0.4 + uSpeed);
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vWp = wp.xyz * vec3(1.0, uMirror, 1.0);
      vN = (mat3(modelMatrix) * normalize(vec3(0.0, 0.35 + 0.6 * uSpeed * s, 1.0))) * vec3(1.0, uMirror, 1.0);
      vObj = position; vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const strip = (w, L, ax, ay, az, ph, taper = 0.3) => {
    const n = 8, pos = [], nor = [], uv = [], cl = [], idx = [];
    for (let j = 0; j <= n; j++) {
      const s = j / n, hw = (w / 2) * (1 - taper * s);
      pos.push(ax - hw, ay - s * L, az, ax + hw, ay - s * L, az); nor.push(0, 0, 1, 0, 0, 1); uv.push(0, 1 - s, 1, 1 - s); cl.push(s, L, ph, s, L, ph);
      if (j < n) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aCloth', new THREE.Float32BufferAttribute(cl, 3)); g.setIndex(idx);
    return g;
  };
  const cloth = (geos, t) => { const m = new THREE.Mesh(mergeGeometries(geos), surfMat(K.TINT, { tint: t, vert: CLOTH_VERT })); m.frustumCulled = false; player.add(m); };
  cloth([strip(0.62, 1.25, 0, 1.5, 0.3, 0.0, 0.15), strip(0.30, 0.95, -0.44, 1.14, 0.2, 1.3, -0.5), strip(0.30, 0.95, 0.44, 1.14, 0.2, 2.6, -0.5),
    strip(0.9, 0.55, 0, 0.42, 0.56, 4.0, -0.2)], [0.84, 0.88, 0.94]);                                              // outer robe, sleeves, hem
  cloth([strip(0.24, 0.85, 0, 1.96, 0.26, 0.7, 0.5)], [0.05, 0.05, 0.07]);                                           // long hair
  cloth([strip(0.05, 1.25, -0.05, 2.08, 0.2, 2.0, 0.2), strip(0.05, 1.05, 0.05, 2.08, 0.2, 3.3, 0.2), strip(0.1, 0.95, 0.14, 1.14, 0.3, 5.0, 0.2)], [0.16, 0.62, 0.60]); // ribbons, sash tail
  cloth([strip(0.05, 0.7, 0, -0.02, 2.06, 6.0, 0.0)], [0.75, 0.12, 0.10]);                                           // sword tassel
  world.add(player);
}
const TRAIL_N = 30;
const trailPos = new Float32Array(TRAIL_N * 4 * 3), trailA = new Float32Array(TRAIL_N * 4); // two crossed ribbons: flat and on edge
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('aA', new THREE.BufferAttribute(trailA, 1));
trailGeo.setAttribute('aS', new THREE.BufferAttribute(Float32Array.from({ length: TRAIL_N * 4 }, (_, i) => (i % 2 ? 1 : -1)), 1));
{ const idx = []; for (const o of [0, TRAIL_N * 2]) for (let i = 0; i < TRAIL_N - 1; i++) { const a = o + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } trailGeo.setIndex(idx); }
const trail = new THREE.Mesh(trailGeo, new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: /* glsl */ `attribute float aA, aS; varying float vA; varying float vS; varying vec3 vP;
    void main(){ vA = aA; vS = aS; vP = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `precision highp float; precision highp sampler3D; uniform sampler3D uNoise; uniform float uTime;
    varying float vA; varying float vS; varying vec3 vP;
    void main(){ // sword light: a white-hot core inside a soft jade sheath, streaked along its length
      float streak = texture(uNoise, vec3(vS * 0.35, dot(vP, vec3(0.11)) - uTime * 0.6, 0.3)).r;
      float core = exp(-vS * vS * 26.0), sheath = exp(-vS * vS * 3.2) * (0.55 + 0.9 * streak);
      vec3 c = vec3(0.30, 1.0, 0.82) * sheath * 0.55 + vec3(0.92, 1.0, 0.95) * core * 1.5;
      gl_FragColor = vec4(c * vA * vA * (1.0 - smoothstep(0.85, 1.0, abs(vS))), 1.0);
    }`,
  side: THREE.DoubleSide, ...ADDITIVE,
}));
trail.frustumCulled = false; world.add(trail);
const trailHist = [];

// ---------------------------------------------------------------- render targets + post passes
const hdrOK = !!(renderer.getContext().getExtension('EXT_color_buffer_float') || renderer.getContext().getExtension('EXT_color_buffer_half_float'));
if (!hdrOK) console.warn('no float render targets: falling back to 8-bit (no HDR bloom)');
const rtOpts = { type: hdrOK ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
const rtScene = new THREE.WebGLRenderTarget(4, 4, { ...rtOpts, depthBuffer: true });
rtScene.depthTexture = new THREE.DepthTexture(4, 4); rtScene.depthTexture.minFilter = rtScene.depthTexture.magFilter = THREE.NearestFilter;
const rtMirror = new THREE.WebGLRenderTarget(4, 4, { ...rtOpts, depthBuffer: true });
const rtCloud = new THREE.WebGLRenderTarget(4, 4, { ...rtOpts, depthBuffer: false });
const rtRays = new THREE.WebGLRenderTarget(4, 4, { ...rtOpts, depthBuffer: false });
const rtB0 = new THREE.WebGLRenderTarget(4, 4, { ...rtOpts, depthBuffer: false }), rtB1 = rtB0.clone();

// sun shadow map: an orthographic depth render of the plateau along the sun direction
const SHADOW_SIZE = 2048;
const rtShadow = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthBuffer: true });
rtShadow.depthTexture = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
rtShadow.depthTexture.minFilter = rtShadow.depthTexture.magFilter = THREE.NearestFilter;
const shadowCam = new THREE.OrthographicCamera(-150, 150, 150, -150, 40, 640);
{
  const c = new THREE.Vector3(LC.x, 8, LC.z - 22);
  shadowCam.position.copy(c).addScaledVector(SUN_DIR, 330); shadowCam.lookAt(c); shadowCam.updateMatrixWorld(true);
  shadowCam.layers.set(1); // only meshes marked with cast()
  U.uShadowMat.value.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
  U.tShadow.value = rtShadow.depthTexture;
}
const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
world.traverse((o) => { if (o.isMesh && o.userData.cast) o.layers.enable(1); });

const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null); fsQuad.frustumCulled = false; fsScene.add(fsQuad);
const fsMat = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
function pass(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }

// Volumetric pass: a ray-marched sea of clouds below the plateau plus low mist over the lake. Outputs (in-scatter, transmittance).
const cloudMat = fsMat(COMMON + /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDepth; uniform mat4 uInvVP; uniform int uSteps; uniform vec2 uLake;
const float YB = -48.0, YT = 28.0;
const vec3 WIND = vec3(2.6, 0.0, 0.8);
float topH(vec2 xz){ // height of the cloud surface; pulled far down around the plateau so the lake sits in clear air
  vec2 q = xz + WIND.xz * uTime * 1.5;
  float r = length(xz - uLake);
  return 2.0 + 15.0 * vnoise(vec3(q * 0.006, 1.7 + uTime*0.012)) + 4.0 * vnoise(vec3(q * 0.021, 5.3)) - 40.0 * (1.0 - smoothstep(95.0, 152.0, r));
}
float density(vec3 p, out float top){
  top = topH(p.xz);
  float d = 0.0, depth = top - p.y;
  if (depth > -7.0) {
    float base = fbm3((p + WIND*uTime) * vec3(0.020, 0.045, 0.020) + vec3(0.0, uTime*0.02, 0.0));
    d = clamp((depth / 13.0 + (base - 0.47) * 1.7) * 1.6, 0.0, 1.0) * 0.12;
  }
  if (p.y < 5.0 && p.y > 0.0) { // low wisps drifting over the lake
    float r = length(p.xz - uLake);
    if (r < 75.0) {
      float ln = fbm3(vec3((p.xz + WIND.xz*uTime*0.8) * 0.055, p.y*0.3 + uTime*0.05));
      d += (1.0 - smoothstep(0.2, 5.0, p.y)) * clamp((ln - 0.45) * 4.0, 0.0, 1.0) * 0.017 * smoothstep(5.0, 16.0, length(p.xz - uCamTrue.xz)) * (1.0 - smoothstep(55.0, 75.0, r));
    }
  }
  return d;
}
void main(){
  float depth = texture2D(tDepth, vUv).r;
  vec4 w4 = uInvVP * vec4(vUv*2.0-1.0, depth*2.0-1.0, 1.0);
  vec3 ro = uCamTrue; vec3 rv = w4.xyz / w4.w - ro; float sd = length(rv); vec3 rd = rv / sd;
  float lim = depth > 0.99999 ? 1500.0 : min(sd, 1500.0);
  float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  float ta = (YB - ro.y) / ry, tb = (YT - ro.y) / ry;
  float t0 = max(min(ta, tb), 0.0), t1 = min(max(ta, tb), lim);
  vec3 acc = vec3(0.0); float T = 1.0;
  if (t1 > t0) {
    float cosT = dot(rd, uSunDir);
    float ph = 0.30 + 0.95 * pow(max(cosT, 0.0), 6.0);
    vec3 fc = fogColor(rd);
    vec2 sxz = normalize(uSunDir.xz) * 16.0;
    float jit = ign(gl_FragCoord.xy), prev = t0, n = float(uSteps);
    for (int i = 0; i < 40; i++) {
      if (i >= uSteps) break;
      float t1i = t0 + (t1 - t0) * pow((float(i) + 1.0) / n, 1.5);
      float dt = t1i - prev, t = prev + dt * jit; prev = t1i;
      vec3 p = ro + rd * t; float top;
      float dn = density(p, top);
      if (dn > 0.0004) {
        float hrel = clamp((p.y - (top - 12.0)) / 12.0, 0.0, 1.0);             // 1 at the cloud surface, 0 deep inside
        float sun = clamp((top - topH(p.xz + sxz)) / 9.0 + 0.55, 0.0, 1.0);    // is the surface toward the sun lower? then lit
        vec3 lit = mix(vec3(0.20,0.24,0.36), vec3(0.56,0.58,0.72), hrel) + SUN_COL * 0.46 * ph * hrel * sun;
        lit = mix(lit, fc, 1.0 - exp(-t * 0.0007));
        float a = 1.0 - exp(-dn * dt);
        acc += T * a * lit; T *= 1.0 - a;
        if (T < 0.03) { T = 0.0; break; }
      }
    }
  }
  gl_FragColor = vec4(acc, T);
}`, { ...U, tDepth: { value: rtScene.depthTexture }, uInvVP: { value: new THREE.Matrix4() }, uSteps: { value: 30 }, uLake: { value: new THREE.Vector2(LC.x, LC.z) } });

const sunUV = new THREE.Vector2();
const raysMat = fsMat(/* glsl */ `
  precision highp float; varying vec2 vUv; uniform sampler2D tScene, tCloud; uniform vec2 uSunUV; uniform int uTaps;
  float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }
  void main(){ // radial blur of (unoccluded sun glow x cloud transmittance) toward the sun
    vec2 d = uSunUV - vUv; float jit = ign(gl_FragCoord.xy), acc = 0.0, w = 1.0, ws = 0.0, n = float(uTaps);
    for (int i = 0; i < 48; i++) {
      if (i >= uTaps) break;
      vec2 uv = vUv + d * ((float(i) + jit) / n) * 0.98;
      float s = texture2D(tScene, uv).a * texture2D(tCloud, uv).a;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) s = 0.0;
      acc += s * w; ws += w; w *= 0.965;
    }
    gl_FragColor = vec4(vec3(acc / ws), 1.0);
  }`, { tScene: { value: rtScene.texture }, tCloud: { value: rtCloud.texture }, uSunUV: { value: sunUV }, uTaps: { value: 36 } });
const brightMat = fsMat(/* glsl */ `
  precision highp float; varying vec2 vUv; uniform sampler2D tScene, tCloud; uniform vec2 uTexel;
  void main(){
    vec3 c = vec3(0.0);
    for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
      vec2 uv = vUv + (vec2(float(x), float(y)) - 1.5) * uTexel;
      vec4 cl = texture2D(tCloud, uv);
      c += min(texture2D(tScene, uv).rgb * cl.a + cl.rgb, vec3(16.0));
    }
    c /= 16.0;
    gl_FragColor = vec4(min(c * smoothstep(1.3, 3.0, dot(c, vec3(0.3,0.6,0.1))), vec3(12.0)), 1.0);
  }`, { tScene: { value: rtScene.texture }, tCloud: { value: rtCloud.texture }, uTexel: { value: new THREE.Vector2() } });
const blurMat = fsMat(/* glsl */ `
  precision highp float; varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uDir;
  void main(){
    vec3 c = vec3(0.0); float ws = 0.0;
    for (int i = -5; i <= 5; i++) { float w = exp(-float(i*i) / 9.0); c += texture2D(tSrc, vUv + uDir * float(i) * 1.6).rgb * w; ws += w; }
    gl_FragColor = vec4(c / ws, 1.0);
  }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
const finalMat = fsMat(/* glsl */ `
  precision highp float; varying vec2 vUv;
  uniform sampler2D tScene, tCloud, tRays, tBloom; uniform float uRayStr, uBloom, uAA; uniform vec2 uTexel;
  uniform float uInk, uAspect; // uInk 1: the frame is an ink-wash painting; easing to 0, colour floods out from the centre
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fb2(vec2 p){ return vn2(p) * 0.5 + vn2(p * 2.1 + 3.1) * 0.25 + vn2(p * 4.3 + 7.7) * 0.125 + vn2(p * 8.9 + 1.3) * 0.0625; }
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03)) / (x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  float luma(vec3 c){ c = c / (1.0 + c); return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 sceneAA(vec2 uv){ // FXAA on the opaque scene (the clouds are soft already)
    vec3 m = texture2D(tScene, uv).rgb;
    if (uAA < 0.5) return m;
    float lNW = luma(texture2D(tScene, uv + vec2(-1.0, 1.0) * uTexel).rgb), lNE = luma(texture2D(tScene, uv + vec2(1.0, 1.0) * uTexel).rgb);
    float lSW = luma(texture2D(tScene, uv + vec2(-1.0, -1.0) * uTexel).rgb), lSE = luma(texture2D(tScene, uv + vec2(1.0, -1.0) * uTexel).rgb), lM = luma(m);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    if (lMax - lMin < max(0.02, lMax * 0.10)) return m;
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * uTexel;
    vec3 a = 0.5 * (texture2D(tScene, uv + dir * (1.0/3.0 - 0.5)).rgb + texture2D(tScene, uv + dir * (2.0/3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
    float lB = luma(b);
    return (lB < lMin || lB > lMax) ? a : b;
  }
  void main(){
    vec4 cl = texture2D(tCloud, vUv);
    vec3 c = sceneAA(vUv) * cl.a + cl.rgb;
    if (uRayStr > 0.0) c += pow(texture2D(tRays, vUv).r, 1.6) * vec3(1.0, 0.66, 0.36) * 0.6 * uRayStr;
    if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * 0.30;
    vec2 q = vUv - 0.5;
    c *= 1.0 - dot(q, q) * 0.5;
    c = pow(aces(c * 0.76), vec3(1.0 / 2.2));
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.34);
    c = max(mix(vec3(dot(c, vec3(0.30, 0.59, 0.11))), c, 1.16), 0.0); // a little more colour
    if (uInk > 0.001) {
      vec2 pa = vUv * vec2(uAspect, 1.0);
      float l = dot(c, vec3(0.30, 0.59, 0.11));
      float lx = luma(texture2D(tScene, vUv + vec2(uTexel.x * 1.6, 0.0)).rgb) - luma(texture2D(tScene, vUv - vec2(uTexel.x * 1.6, 0.0)).rgb);
      float ly = luma(texture2D(tScene, vUv + vec2(0.0, uTexel.y * 1.6)).rgb) - luma(texture2D(tScene, vUv - vec2(0.0, uTexel.y * 1.6)).rgb);
      float edge = smoothstep(0.035, 0.17, length(vec2(lx, ly)));
      vec3 paper = vec3(0.935, 0.895, 0.80) * (0.93 + 0.09 * fb2(pa * 95.0));
      float tone = smoothstep(0.10, 0.88, l);
      tone = mix(tone, floor(tone * 4.0 + 0.5) / 4.0, 0.5);              // layered washes
      tone += (fb2(pa * 13.0) - 0.5) * 0.13;                               // uneven pigment
      vec3 ink = mix(vec3(0.07, 0.08, 0.10), paper, clamp(tone, 0.0, 1.0));
      ink = mix(ink, vec3(0.05, 0.05, 0.07), edge * 0.7);                  // brush outlines
      ink = mix(ink, ink * (0.55 + 0.9 * c), 0.2);                         // a breath of the true colour
      float w = length(pa - vec2(uAspect, 1.0) * 0.5) / (0.5 * length(vec2(uAspect, 1.0))) + (fb2(pa * 4.5 + 3.0) - 0.5) * 0.55;
      float r0 = (1.0 - uInk) * 1.75 - 0.35;
      float mask = smoothstep(-0.06, 0.06, w - r0);
      float seam = (w - r0) / 0.035;
      c = mix(c, ink, mask) + vec3(1.0, 0.80, 0.45) * exp(-seam * seam) * 0.35 * step(uInk, 0.999);
    }
    gl_FragColor = vec4(c, 1.0);
  }`, { tScene: { value: rtScene.texture }, tCloud: { value: rtCloud.texture }, tRays: { value: rtRays.texture }, tBloom: { value: rtB0.texture }, uRayStr: { value: 0 }, uBloom: { value: 0 }, uAA: { value: 0 }, uTexel: brightMat.uniforms.uTexel, uInk: { value: 1 }, uAspect: { value: 1 } });

function resize() {
  const cssW = window.innerWidth, cssH = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const pr = FORCE_PR || (qualityName === 'high' ? Math.min(dpr, quality.pr) : Math.min(dpr, 1.5) * quality.pr);
  renderer.setPixelRatio(pr); renderer.setSize(cssW, cssH, false);
  const w = Math.max(2, Math.round(cssW * pr)), h = Math.max(2, Math.round(cssH * pr));
  const sz = (rt, s) => rt.setSize(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
  sz(rtScene, 1); sz(rtMirror, quality.mirrorScale); sz(rtCloud, quality.cloudScale); sz(rtRays, 0.25); sz(rtB0, 0.25); sz(rtB1, 0.25);
  U.uRes.value.set(w, h);
  camera.aspect = cssW / cssH; camera.fov = camera.aspect < 1 ? 74 : 60; camera.updateProjectionMatrix();
  U.uProj.value = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
  brightMat.uniforms.uTexel.value.set(1 / w, 1 / h); finalMat.uniforms.uAspect.value = w / h;
  cloudMat.uniforms.uSteps.value = quality.cloudSteps;
  raysMat.uniforms.uTaps.value = quality.rayTaps;
  finalMat.uniforms.uBloom.value = quality.bloom; finalMat.uniforms.uAA.value = quality.aa;
}
window.addEventListener('resize', resize);

const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), invVP = new THREE.Matrix4(), tmpV = new THREE.Vector3(), camDir = new THREE.Vector3();
function render() {
  camera.updateMatrixWorld(true);
  sky.position.copy(camera.position);
  U.uShadowOn.value = quality.shadow;
  if (quality.shadow) { // 0. sun shadow map (rocks and the player move, so it is redrawn every frame)
    scene.overrideMaterial = shadowMat; renderer.setRenderTarget(rtShadow); renderer.render(scene, shadowCam); scene.overrideMaterial = null;
  }
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
  // 1. lake reflection: the world mirrored about y = 0, through the same camera (skipped when the lake is out of view)
  if (frustum.intersectsSphere(lakeSphere) && camera.position.y < 260) {
    U.uMirror.value = -1; U.uCamTrue.value.set(camera.position.x, -camera.position.y, camera.position.z);
    world.scale.y = -1; water.visible = false;
    const proj = U.uProj.value; U.uProj.value = proj * quality.mirrorScale; // point sprites sized for the smaller target
    renderer.setRenderTarget(rtMirror); renderer.render(scene, camera);
    U.uProj.value = proj; world.scale.y = 1; water.visible = true;
  }
  // 2. main view
  U.uMirror.value = 1; U.uCamTrue.value.copy(camera.position);
  waterMat.uniforms.uRefl.value = rtMirror.texture;
  renderer.setRenderTarget(rtScene); renderer.render(scene, camera);
  // 3. clouds at reduced resolution
  invVP.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  cloudMat.uniforms.uInvVP.value.copy(invVP);
  pass(cloudMat, rtCloud);
  // 4. light shafts, only while the sun is in front of the camera
  camera.getWorldDirection(camDir);
  const facing = quality.rayTaps > 0 ? smooth(0.05, 0.35, camDir.dot(SUN_DIR)) : 0;
  finalMat.uniforms.uRayStr.value = facing;
  if (facing > 0) {
    tmpV.copy(camera.position).addScaledVector(SUN_DIR, 1000).project(camera);
    sunUV.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
    pass(raysMat, rtRays);
  }
  // 5. bloom
  if (quality.bloom) {
    pass(brightMat, rtB0);
    blurMat.uniforms.tSrc.value = rtB0.texture; blurMat.uniforms.uDir.value.set(1 / rtB0.width, 0); pass(blurMat, rtB1);
    blurMat.uniforms.tSrc.value = rtB1.texture; blurMat.uniforms.uDir.value.set(0, 1 / rtB0.height); pass(blurMat, rtB0);
  }
  pass(finalMat, null);
}

// ---------------------------------------------------------------- game state
const MAX_SPEED = 34, CLIMB_SPEED = 16, PICK_R = 2.9;
const SPAWN = { x: 0, y: 3.6, z: 60 };
const G = {
  mode: 'title', t: 0, time: 0, count: 0, hits: 0, bumps: 0,
  pos: new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z), yaw: 0, camPitch: 0.16, fwd: 0, vy: 0, roll: 0, pitch: 0,
  knock: new THREE.Vector3(), stun: 0, shake: 0, hitCd: 0, unlocked: false, glowT: -1, ripT: 0, finishT: -1, startT: -100,
  camPos: new THREE.Vector3(0, 6, 72), bot: {},
};
const audio = new GameAudio(mulberry32(555));
const keys = new Set();
const touch = { turn: 0, thrust: 0, climb: 0 };
let lookDX = 0, lookDY = 0;

function resetRun() {
  G.time = 0; G.count = 0; G.hits = 0; G.bumps = 0; G.unlocked = false; G.glowT = -1; G.finishT = -1;
  G.pos.set(SPAWN.x, SPAWN.y, SPAWN.z); G.yaw = 0; G.camPitch = 0.16; G.fwd = 0; G.vy = 0; G.knock.set(0, 0, 0); G.stun = 0; G.shake = 0;
  G.bot = {}; trailHist.length = 0; U.uGlow.value = 0; G.roll = 0; G.pitch = 0; G.hitCd = 0; G.ripT = 0; lookDX = 0; lookDY = 0;
  for (const r of ripData) r.set(0, 0, -100, 0);
  for (const o of orbs) { o.alive = true; o.mesh.visible = true; haloT.array[o.i] = -1; }
  haloT.needsUpdate = true;
  sparkT.array.fill(-1); sparkT.needsUpdate = true;
  G.camPos.set(SPAWN.x, SPAWN.y + 4, SPAWN.z + 11);
  updateHud();
}
function startGame() {
  audio.start(); audio.play('click', 0, G.t);
  const fromTitle = G.mode === 'title';
  resetRun(); G.mode = 'play';
  if (fromTitle) G.startT = G.t; // the ink-to-colour bloom plays once, not on every restart
  $('title').classList.add('hidden'); $('done').classList.add('hidden'); $('hud').classList.remove('hidden');
  toast('收集二十道灵气 · Collect 20 spirit orbs', 3.5);
}
function finish() {
  G.mode = 'done'; G.finishT = G.t;
  audio.play('win', 0, G.t);
  $('doneTime').textContent = fmtTime(G.time);
  $('doneStats').textContent = `灵气 ${G.count}/${ORB_TOTAL} · 撞石 ${G.hits} 次`;
  $('done').classList.remove('hidden'); $('marker').style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
}
const fmtTime = (s) => { const t = Math.round(s * 10); return `${String(Math.floor(t / 600)).padStart(2, '0')}:${((t % 600) / 10).toFixed(1).padStart(4, '0')}`; };
let toastUntil = 0;
function toast(msg, dur = 2.5) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); toastUntil = G.t + dur; }
function updateHud() { $('count').textContent = `灵气 ${G.count}/${ORB_TOTAL}`; $('timer').textContent = fmtTime(G.time); }

function readInput() {
  if (BOT && G.mode === 'play') return botInput(G, { orbs, rocks, spires, spireRadius, orbBobY, Y0 });
  const k = (...c) => c.some((x) => keys.has(x));
  return {
    turn: clamp((k('KeyA', 'ArrowLeft') ? 1 : 0) - (k('KeyD', 'ArrowRight') ? 1 : 0) + touch.turn, -1, 1),
    thrust: clamp((k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0) + touch.thrust, -1, 1),
    climb: clamp((k('Space') ? 1 : 0) - (k('ShiftLeft', 'ShiftRight') ? 1 : 0) + touch.climb, -1, 1),
  };
}

const fwdV = new THREE.Vector3(), prevPos = new THREE.Vector3(), nrm = new THREE.Vector3();
function physics(dt) {
  const inp = readInput();
  G.yaw += inp.turn * 1.9 * dt - lookDX * 0.0026;
  G.camPitch = clamp(G.camPitch + lookDY * 0.002, -0.4, 0.95);
  lookDX = 0; lookDY = 0;
  const stunned = G.stun > 0; G.stun = Math.max(0, G.stun - dt); G.hitCd = Math.max(0, G.hitCd - dt);
  const target = stunned ? 0 : inp.thrust >= 0 ? inp.thrust * MAX_SPEED : inp.thrust * 8;
  G.fwd += (target - G.fwd) * (1 - Math.exp(-dt * 1.8));
  G.vy += ((stunned ? 0 : inp.climb) * CLIMB_SPEED - G.vy) * (1 - Math.exp(-dt * 4));
  G.roll += (inp.turn * 0.55 - G.roll) * (1 - Math.exp(-dt * 6));
  G.pitch += (clamp(G.vy / CLIMB_SPEED, -1, 1) * 0.35 - G.pitch) * (1 - Math.exp(-dt * 6));
  fwdV.set(-Math.sin(G.yaw), 0, -Math.cos(G.yaw));
  prevPos.copy(G.pos);
  G.pos.addScaledVector(fwdV, G.fwd * dt); G.pos.y += G.vy * dt; G.pos.addScaledVector(G.knock, dt);
  G.knock.multiplyScalar(Math.exp(-dt * 3.5));

  // the gate: three openings; everything else in its plane is solid stone
  if ((prevPos.z > 0) !== (G.pos.z > 0)) {
    // test the point where the path crosses the gate plane, against the gate's actual silhouette
    const f = prevPos.z / (prevPos.z - G.pos.z), ax = Math.abs(lerp(prevPos.x, G.pos.x, f)), y = lerp(prevPos.y, G.pos.y, f);
    const solid = (ax < 5.4 && y < Y0 + 12.6) || (ax < 8.8 && y < Y0 + 9.4);
    const open = (ax < 2.9 && y < Y0 + 6.1) || (ax > 3.95 && ax < 6.55 && y < Y0 + 2.6); // side bays: below the hanging lanterns
    if (solid && open) { if (G.unlocked) { finish(); return; } }
    else if (solid) {
      const s = prevPos.z > 0 ? 1 : -1;
      G.pos.z = s * 0.35; G.knock.set(0, 0, s * 14); G.fwd *= -0.25; G.stun = 0.2; G.shake = Math.max(G.shake, 0.22); G.bumps++;
      audio.play('bump', 0, G.t);
    }
  }
  // the sect hall is a solid box: push out through the nearest face
  if (G.pos.x > HALL.x0 && G.pos.x < HALL.x1 && G.pos.z > HALL.z0 && G.pos.z < HALL.z1 && G.pos.y < HALL.y1) {
    const pen = [G.pos.x - HALL.x0, HALL.x1 - G.pos.x, G.pos.z - HALL.z0, HALL.z1 - G.pos.z, (HALL.y1 - G.pos.y) * 1.5];
    const k = pen.indexOf(Math.min(...pen));
    if (k === 4) { G.pos.y = HALL.y1; if (G.vy < 0) G.vy = 0; }
    else {
      if (k === 0) G.pos.x = HALL.x0; else if (k === 1) G.pos.x = HALL.x1; else if (k === 2) G.pos.z = HALL.z0; else G.pos.z = HALL.z1;
      if (G.hitCd <= 0) {
        G.knock.set(k === 0 ? -12 : k === 1 ? 12 : 0, 0, k === 2 ? -12 : k === 3 ? 12 : 0); G.fwd *= -0.25; G.stun = 0.2; G.shake = Math.max(G.shake, 0.22); G.hitCd = 0.4; G.bumps++;
        audio.play('bump', 0, G.t);
      }
    }
  }
  // ground, lake, terrace
  const floor = groundH(G.pos.x, G.pos.z) + 1.0;
  if (G.pos.y < floor) { G.pos.y = floor; if (G.vy < 0) G.vy = 0; }
  if (G.pos.y > 240) { G.pos.y = 240; if (G.vy > 0) G.vy = 0; }
  // floating rocks: knock-back, screen shake, sound
  for (const r of rocks) {
    const c = r.g.position, dx = G.pos.x - c.x, dy = G.pos.y + 0.6 - c.y, dz = G.pos.z - c.z;
    const rh = r.s * 1.05 + 0.8, rv = (dy > 0 ? r.s * 0.5 : r.s * 1.75) + 0.8;
    const e = Math.hypot(dx / rh, dy / rv, dz / rh);
    if (e < 1) {
      nrm.set(dx, dy * 0.5, dz); if (nrm.lengthSq() < 1e-6) nrm.set(0, 1, 0); nrm.normalize();
      G.pos.addScaledVector(nrm, (1 - e) * rh + 0.25);
      if (G.hitCd <= 0) {
        G.knock.copy(nrm).multiplyScalar(24); G.knock.y += 4; G.fwd *= -0.3; G.vy = 0;
        G.stun = 0.38; G.shake = 0.42; G.hitCd = 0.5; G.hits++;
        audio.play('hit', 0, G.t);
      }
    }
  }
  // peaks: slide around them
  for (const s of spires) {
    if (G.pos.y > s.H) continue;
    const v = (G.pos.y - PEAK_BASE) / (s.H - PEAK_BASE), ax = s.x + s.lx * v * v, az = s.z + s.lz * v * v;
    const dx = G.pos.x - ax, dz = G.pos.z - az, rr = spireRadius(s, G.pos.y) + 1.0, d = Math.hypot(dx, dz);
    if (d < rr && d > 1e-4) { G.pos.x = ax + (dx / d) * rr; G.pos.z = az + (dz / d) * rr; G.fwd *= Math.exp(-dt * 1.5); }
  }
  // soft world boundary
  const br = Math.hypot(G.pos.x - LC.x, G.pos.z - LC.z);
  if (br > 600) { G.pos.x = LC.x + ((G.pos.x - LC.x) / br) * 600; G.pos.z = LC.z + ((G.pos.z - LC.z) / br) * 600; }

  // orbs
  for (const o of orbs) {
    if (!o.alive) continue;
    if (Math.hypot(G.pos.x - o.x, G.pos.y + 0.7 - orbBobY(o, G.t), G.pos.z - o.z) < PICK_R) {
      o.alive = false; o.mesh.visible = false; haloT.array[o.i] = G.t; haloT.needsUpdate = true;
      sparkT.array.fill(G.t, o.i * SPARKS, (o.i + 1) * SPARKS); sparkT.needsUpdate = true;
      G.count++; audio.play('orb', G.count, G.t); updateHud();
      if (G.count === ORB_TOTAL) {
        G.unlocked = true; G.glowT = G.t; audio.play('unlock', 0, G.t, 0.25);
        toast('灵气已满 · 山门已开，穿过山门！ The gate is open — fly through it', 6);
      }
    }
  }
  // wake ripples when skimming the lake
  G.ripT -= dt;
  const speed = Math.hypot(G.fwd, G.vy);
  if (G.ripT <= 0 && G.pos.y < 4.6 && terrainH(G.pos.x, G.pos.z) < -0.1) {
    ripData[ripNext].set(G.pos.x, G.pos.z, G.t, (1 - (G.pos.y - 1) / 3.6) * (0.35 + 0.65 * Math.min(speed / MAX_SPEED, 1)));
    ripNext = (ripNext + 1) % RIPPLES; G.ripT = 0.16;
  }
  audio.setWind(Math.min(speed / MAX_SPEED, 1));
}

const camTarget = new THREE.Vector3(), lookAt = new THREE.Vector3(), rightV = new THREE.Vector3();
function updateCamera(dt) {
  if (G.mode === 'title') {
    camera.position.set(-1.4 + Math.sin(G.t * 0.11) * 4, 3.2 + Math.sin(G.t * 0.07) * 0.5, 70 - Math.sin(G.t * 0.06) * 5);
    lookAt.set(0, 8.8, 0); camera.lookAt(lookAt); return;
  }
  if (G.mode === 'done') {
    const a = (G.t - G.finishT) * 0.12;
    camTarget.set(Math.sin(a) * 7, 6.2, 27 + Math.cos(a) * 3);
    G.camPos.lerp(camTarget, 1 - Math.exp(-dt * 1.6));
    camera.position.copy(G.camPos); lookAt.set(0, 8.4, 0); camera.lookAt(lookAt); return;
  }
  const back = 9.5, cp = G.camPitch;
  fwdV.set(-Math.sin(G.yaw), 0, -Math.cos(G.yaw));
  camTarget.copy(G.pos).addScaledVector(fwdV, -back * Math.cos(cp)); camTarget.y += 2.6 + back * Math.sin(cp);
  G.camPos.lerp(camTarget, 1 - Math.exp(-dt * 7));
  const minY = groundH(G.camPos.x, G.camPos.z) + 0.7;
  if (G.camPos.y < minY) G.camPos.y = minY;
  camera.position.copy(G.camPos);
  if (G.shake > 0) { // decaying shake, a pure function of game time
    const a = (G.shake / 0.42) * 0.45;
    camera.position.x += Math.sin(G.t * 83) * a; camera.position.y += Math.sin(G.t * 97 + 1) * a; camera.position.z += Math.sin(G.t * 71 + 2) * a;
    G.shake = Math.max(0, G.shake - dt);
  }
  lookAt.copy(G.pos).addScaledVector(fwdV, 4); lookAt.y += 1.5;
  camera.lookAt(lookAt);
}

function updateTrail() {
  const fx = -Math.sin(G.yaw), fz = -Math.cos(G.yaw);
  rightV.set(Math.cos(G.yaw), 0, -Math.sin(G.yaw));
  trailHist.unshift({ x: G.pos.x - fx * 1.7, y: G.pos.y, z: G.pos.z - fz * 1.7, rx: rightV.x, rz: rightV.z }); // sword tail
  if (trailHist.length > TRAIL_N) trailHist.pop();
  const sp = clamp(Math.abs(G.fwd) / MAX_SPEED, 0, 1);
  for (let i = 0; i < TRAIL_N; i++) {
    const h = trailHist[Math.min(i, trailHist.length - 1)], f = i / (TRAIL_N - 1), w = (0.2 + 0.5 * sp) * Math.pow(1 - f, 0.7) * (0.35 + 0.65 * Math.min(i / 3, 1)) + 0.01;
    trailPos.set([h.x - h.rx * w, h.y, h.z - h.rz * w, h.x + h.rx * w, h.y, h.z + h.rz * w], i * 6);
    trailPos.set([h.x, h.y - w * 0.8, h.z, h.x, h.y + w * 0.8, h.z], (TRAIL_N + i) * 6);
    trailA[i * 2] = trailA[i * 2 + 1] = (1 - f) * sp; trailA[(TRAIL_N + i) * 2] = trailA[(TRAIL_N + i) * 2 + 1] = (1 - f) * sp * 0.7;
  }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.aA.needsUpdate = true;
}

const mk = new THREE.Vector3();
function updateMarker() { // points at the nearest remaining orb, or at the gate once it is open
  const el = $('marker');
  if (G.mode !== 'play') { el.style.display = 'none'; return; }
  let best = null, bd = 1e9;
  if (G.unlocked) { best = { x: 0, y: Y0 + 3.4, z: 0 }; bd = G.pos.distanceTo(mk.set(0, Y0 + 3.4, 0)); }
  else for (const o of orbs) if (o.alive) { const d = Math.hypot(o.x - G.pos.x, o.y - G.pos.y, o.z - G.pos.z); if (d < bd) { bd = d; best = o; } }
  if (!best) { el.style.display = 'none'; return; }
  mk.set(best.x, best.y, best.z).project(camera);
  let x = mk.x, y = mk.y; const behind = mk.z > 1;
  if (behind) { x = -x; y = -y; }
  const off = behind || Math.abs(x) > 0.9 || Math.abs(y) > 0.86;
  if (off) { const m = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.86, 1e-3); x /= m; y /= m; if (behind && Math.abs(y) < 0.3) x = Math.sign(x || 1) * 0.9; }
  el.style.display = 'block';
  el.style.left = `${(x * 0.5 + 0.5) * 100}%`; el.style.top = `${(-y * 0.5 + 0.5) * 100}%`;
  el.classList.toggle('off', off);
  el.firstElementChild.style.transform = `rotate(${Math.atan2(x, y)}rad)`;
  el.lastElementChild.textContent = `${Math.round(bd)}`;
}

function step(dt, doRender = true) {
  G.t += dt; U.uTime.value = G.t;
  for (const r of rocks) {
    r.g.position.y = r.y + Math.sin((G.t / r.T) * 6.2832 + r.ph) * r.amp;
    r.g.rotation.y = r.rot + G.t * r.rs;
    r.g.rotation.z = Math.sin((G.t / (r.T * 1.3)) * 6.2832 + r.ph * 2) * 0.03;
    for (const d of r.debris) d.m.position.y = d.base.y + Math.sin((G.t / d.T) * 6.2832 + d.ph) * 0.35;
  }
  for (const o of orbs) if (o.alive) o.mesh.position.y = orbBobY(o, G.t);
  if (G.mode === 'play') { G.time += dt; physics(dt); }
  else if (G.mode === 'done') { // drift on past the gate
    G.fwd += (9 - G.fwd) * (1 - Math.exp(-dt)); G.vy += (1.2 - G.vy) * (1 - Math.exp(-dt));
    fwdV.set(-Math.sin(G.yaw), 0, -Math.cos(G.yaw)); G.pos.addScaledVector(fwdV, G.fwd * dt); G.pos.y += G.vy * dt;
    G.pos.y = Math.max(G.pos.y, groundH(G.pos.x, G.pos.z) + 1); G.roll *= Math.exp(-dt * 3); audio.setWind(0.2);
  } else { G.pos.set(2.6, 2.4 + Math.sin(G.t * 0.9) * 0.25, 50); G.yaw = 0.25; G.fwd = 0; }
  if (G.glowT >= 0) U.uGlow.value = smooth(0, 1.2, G.t - G.glowT);
  U.uWave.value = G.glowT >= 0 ? G.t - G.glowT : -1;
  beam.visible = portal.visible = U.uGlow.value > 0.001;
  // the title is an ink painting; colour floods in as the flight begins
  finalMat.uniforms.uInk.value = G.mode === 'title' ? 1 : 1 - smooth(0.1, 2.8, G.t - G.startT);
  player.position.copy(G.pos); player.rotation.set(G.pitch, G.yaw, G.roll, 'YXZ');
  U.uFocus.value.copy(G.pos); U.uSpeed.value = G.mode === 'title' ? 0.12 : clamp(Math.abs(G.fwd) / MAX_SPEED, 0, 1);
  updateDragon(dt); updateCamera(dt); updateTrail();
  const cine = window.__game && window.__game.cine; // a scripted camera (film renderer) replaces the game camera for this frame
  if (cine) { camera.position.set(cine.pos[0], cine.pos[1], cine.pos[2]); lookAt.set(cine.look[0], cine.look[1], cine.look[2]); camera.lookAt(lookAt); }
  if (G.mode === 'play') $('timer').textContent = fmtTime(G.time);
  if (toastUntil && G.t > toastUntil) { $('toast').classList.remove('show'); toastUntil = 0; }
  if (doRender) { render(); updateMarker(); }
}

// ---------------------------------------------------------------- input wiring
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code); audio.resume();
  if (e.repeat) return;
  if (e.code === 'KeyQ') toggleQuality();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyF') $('fps').classList.toggle('hidden');
  if (e.code === 'Enter' && G.mode !== 'play') startGame();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); dragging = false; touch.turn = touch.thrust = touch.climb = 0; lookDX = lookDY = 0; });
document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));
window.addEventListener('pointerdown', () => audio.resume());
let dragging = false;
canvas.addEventListener('mousedown', () => { dragging = true; if (G.mode === 'play' && canvas.requestPointerLock) canvas.requestPointerLock(); });
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => { if (G.mode === 'play' && (document.pointerLockElement === canvas || dragging)) { lookDX += e.movementX; lookDY += e.movementY; } });

// touch: left stick steers, right side drags to look, two buttons rise / dive
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) $('touch').classList.remove('hidden');
{
  const joy = $('joy'), knob = $('joyKnob'), held = { up: false, down: false }; let joyId = null, lookId = null, lx = 0, ly = 0;
  const setJoy = (e) => {
    const r = joy.getBoundingClientRect(), dx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1), dy = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
    touch.turn = -dx; touch.thrust = -dy; knob.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
  };
  joy.addEventListener('pointerdown', (e) => { if (joyId !== null) return; joyId = e.pointerId; joy.setPointerCapture(e.pointerId); setJoy(e); e.preventDefault(); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) setJoy(e); });
  const endJoy = (e) => { if (e.pointerId === joyId) { joyId = null; touch.turn = 0; touch.thrust = 0; knob.style.transform = ''; } };
  joy.addEventListener('pointerup', endJoy); joy.addEventListener('pointercancel', endJoy);
  for (const [id, v] of [['btnUp', 1], ['btnDown', -1]]) {
    const b = $(id);
    const sync = () => { touch.climb = (held.up ? 1 : 0) - (held.down ? 1 : 0); }, key = v > 0 ? 'up' : 'down';
    b.addEventListener('pointerdown', (e) => { held[key] = true; sync(); b.setPointerCapture(e.pointerId); e.preventDefault(); });
    const up = () => { held[key] = false; sync(); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  }
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && lookId === null && G.mode === 'play') { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; } });
  canvas.addEventListener('pointermove', (e) => { if (e.pointerId === lookId) { lookDX += (e.clientX - lx) * 1.6; lookDY += (e.clientY - ly) * 1.6; lx = e.clientX; ly = e.clientY; } });
  const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
}

function toggleQuality(name, remember = true) {
  qualityName = name || (qualityName === 'high' ? 'low' : 'high'); quality = QUALITY[qualityName];
  if (remember) try { localStorage.setItem('qy-quality', qualityName); } catch (e) { /* storage unavailable */ }
  $('btnQ').textContent = `画质 ${qualityName === 'high' ? '高' : '低'}`;
  resize();
}
function toggleMute() { $('btnM').textContent = audio.toggleMute() ? '声音 关' : '声音 开'; }
$('btnQ').addEventListener('click', () => toggleQuality());
$('btnM').addEventListener('click', toggleMute);
$('startBtn').addEventListener('click', startGame);
$('restartBtn').addEventListener('click', startGame);
$('btnQ').textContent = `画质 ${qualityName === 'high' ? '高' : '低'}`;

// ---------------------------------------------------------------- boot
resize();
resetRun();
step(0);
const perf = { fps: 0, avgMs: 0, frames: 0, worstMs: 0, samples: [] };
window.__game = {
  G, step, render, startGame, toggleQuality, perf, orbs, rocks, ORB_TOTAL, audio, renderOffline, groundH,
  cine: null,
  // where the dragon's head is right now (the same path the vertex shader follows)
  dragonHead: () => { const p = dragonU.uDPath.value, a = dragonU.uDA.value; return [dragonU.uDCen.value.x + p.x * Math.cos(a), p.y + p.z * Math.sin(a * 2 + 1), dragonU.uDCen.value.y + p.x * 0.82 * Math.sin(a)]; },
  info: () => ({ glRenderer: glRendererName, quality: qualityName, w: U.uRes.value.x, h: U.uRes.value.y, spires: spires.length }),
  state: () => ({ mode: G.mode, t: G.t, time: G.time, count: G.count, hits: G.hits, bumps: G.bumps, unlocked: G.unlocked, glow: U.uGlow.value,
    pos: G.pos.toArray(), fwd: G.fwd, shake: G.shake, ripples: ripData.filter((r) => G.t - r.z < 5).length, sfx: audio.log.length, audio: audio.ctx ? audio.ctx.state : 'none' }),
  // layout sanity check used by the playthrough script: no orb may sit inside a collider
  validate: () => {
    const bad = [];
    for (const o of orbs) {
      if (o.y < groundH(o.x, o.z) + 1.2) bad.push(`orb ${o.i} below ground`);
      for (const s of spires) { const v = (o.y - PEAK_BASE) / (s.H - PEAK_BASE); if (o.y < s.H && Math.hypot(o.x - s.x - s.lx * v * v, o.z - s.z - s.lz * v * v) < spireRadius(s, o.y) + 3) bad.push(`orb ${o.i} inside a peak`); }
      if (o.x > HALL.x0 - 2 && o.x < HALL.x1 + 2 && o.z > HALL.z0 - 2 && o.z < HALL.z1 + 2 && o.y < HALL.y1 + 2) bad.push(`orb ${o.i} inside the hall`);
      for (const r of rocks) if (Math.hypot((o.x - r.x) / (r.s * 1.05 + 0.8), (o.y - r.y) / ((o.y > r.y ? r.s * 0.5 : r.s * 1.75) + r.amp + 0.8), (o.z - r.z) / (r.s * 1.05 + 0.8)) < 1) bad.push(`orb ${o.i} inside rock`);
    }
    return bad;
  },
};
window.__ready = true;

if (!CAPTURE) {
  let last = performance.now(), acc = 0, n = 0, slowFor = 0, autoLowered = false;
  const loop = (now) => {
    const ms = now - last; last = now;
    const dt = Math.min(ms / 1000, 0.05);
    step(dt);
    perf.frames++; acc += ms; n++; perf.worstMs = Math.max(perf.worstMs, ms); perf.samples.push(ms); if (perf.samples.length > 4000) perf.samples.splice(0, 2000);
    if (acc >= 500) {
      perf.fps = (1000 * n) / acc; perf.avgMs = acc / n; acc = 0; n = 0;
      $('fps').textContent = `${perf.fps.toFixed(0)} fps · ${qualityName}`;
      // drop to low quality automatically if a weak device cannot hold the frame rate
      slowFor = perf.fps < 40 && G.mode === 'play' ? slowFor + 1 : 0;
      if (slowFor >= 6 && qualityName === 'high' && !autoLowered && !BOT) { autoLowered = true; toggleQuality('low', false); /* not remembered: a throttled tab must not downgrade later visits */ toast('已切换到低画质 · Switched to low quality (Q)', 4); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
