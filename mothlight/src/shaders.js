// All hand-written GLSL. Every surface is unlit: "lighting" is faked per shader, which keeps the
// scene at a handful of draw calls and lets the mirror pass re-render it cheaply.
import * as THREE from 'three';
import { DISTRICTS } from './city.js';

// Uniform objects shared by reference across every material.
export const U = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color(0.034, 0.02, 0.06) },
  uFogHigh: { value: new THREE.Color(0.012, 0.013, 0.035) },
  uFogDensity: { value: 0.003 },
  uPulse: { value: new THREE.Vector4(0, 0, -100, 0) }, // x, z, radius, intensity
  uTints: { value: DISTRICTS.map((d) => new THREE.Color(...d.color)) },
  uFlash: { value: 0 },
  uAurora: { value: 0 },
  uHead: { value: new THREE.Vector4(0, -99, 0, 0) }, // the player's headlamps: position, strength
  uHeadDir: { value: new THREE.Vector3(0, 0, -1) },
};

const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform vec3 uFogHigh;
uniform float uFogDensity;
uniform vec4 uPulse;
uniform vec3 uTints[5];
uniform float uFlash;
uniform float uAurora;
uniform vec4 uHead;
uniform vec3 uHeadDir;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

// Must match districtOfBlock() in city.js.
int districtAt(vec2 p) {
  vec2 ij = clamp(floor(p / 76.0 + 4.5), 0.0, 8.0) - 4.0;
  if (abs(ij.x) <= 1.0 && abs(ij.y) <= 1.0) return 0;
  if (ij.x < 0.0 && ij.y <= 0.0) return 1;
  if (ij.x >= 0.0 && ij.y < 0.0) return 2;
  if (ij.x > 0.0 && ij.y >= 0.0) return 3;
  return 4;
}
vec3 applyFog(vec3 col, vec3 wp) {
  float d = distance(cameraPosition, wp);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  return mix(col, mix(uFogColor, uFogHigh, smoothstep(0.0, 240.0, wp.y)), f);
}
// The player's headlamps as a real cone of light on whatever it falls on (the lit colour stands in for albedo).
vec3 headlit(vec3 col, vec3 wp) {
  vec3 L = wp - uHead.xyz;
  float d = length(L);
  float cone = smoothstep(0.78, 0.97, dot(L / max(d, 1e-3), uHeadDir));
  float a = cone * uHead.w * exp(-d * 0.022) / (1.0 + 0.004 * d * d);
  return col + (col * 4.5 + vec3(0.010, 0.010, 0.012)) * vec3(1.0, 0.94, 0.82) * a;
}
float pulseRing(vec3 wp) {
  float d = distance(wp.xz, uPulse.xy);
  float behind = uPulse.z - d; // sharp leading edge, fading wake
  return step(0.0, behind) * exp(-max(behind, 0.0) / 9.0) * uPulse.w; // max() avoids inf * 0 = NaN ahead of the front
}
`;

const shared = (extra = {}) => ({ ...U, ...extra });

// ---------------------------------------------------------------- buildings
export function buildingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared(),
    vertexShader: /* glsl */ `
      attribute vec3 aSize;
      attribute vec3 aTint;
      attribute vec4 aParams; // seed, style, lit fraction, y0
      varying vec3 vWorld; varying vec3 vN; varying vec3 vFace; varying vec3 vSize;
      varying vec3 vTint; varying vec4 vParams; varying vec2 vRoof;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz; vN = normal; vSize = aSize; vTint = aTint; vParams = aParams;
        bool xf = abs(normal.x) > 0.5;
        float fw = xf ? aSize.z : aSize.x;
        vFace = vec3((xf ? position.z : position.x) * fw + fw * 0.5, position.y * aSize.y, fw);
        vRoof = (position.xz + 0.5) * aSize.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying vec3 vFace; varying vec3 vSize;
      varying vec3 vTint; varying vec4 vParams; varying vec2 vRoof;
      // Interior mapping: intersect the view ray with a box behind the glass and shade the wall it hits.
      vec3 room(vec2 wf, vec3 ray, vec2 rs, float depth, vec2 key, float shop) {
        vec3 o = vec3(wf * rs, 0.0);
        vec3 dir = vec3(abs(ray.x) < 1e-4 ? 1e-4 : ray.x, abs(ray.y) < 1e-4 ? 1e-4 : ray.y, ray.z);
        vec3 t3 = (vec3(dir.x > 0.0 ? rs.x : 0.0, dir.y > 0.0 ? rs.y : 0.0, depth) - o) / dir;
        float t = min(t3.x, min(t3.y, t3.z));
        vec3 h = o + dir * t;
        float fade = 1.0 - 0.5 * h.z / depth;
        if (t3.z <= t + 1e-4) {
          if (shop > 0.5) {
            // Shelves of coloured stock on the back wall.
            vec2 sq = h.xy * vec2(2.2, 2.7);
            vec2 cell = floor(sq), cf = fract(sq);
            vec3 stock = 0.3 + 0.7 * vec3(hash21(cell + key), hash21(cell + key + 1.7), hash21(cell + key + 3.1));
            float item = step(0.14, cf.x) * step(cf.x, 0.86) * step(0.14, cf.y) * step(cf.y, 0.78) * step(0.2, hash21(cell + key + 9.0));
            return mix(vec3(0.45), stock * 1.1, item) * (0.35 + 0.65 * step(0.12, cf.y)) * fade;
          }
          vec2 q = h.xy / rs;
          float furn = smoothstep(0.38, 0.34, q.y) * step(0.3, hash21(key + 5.0));
          float pic = step(abs(q.x - 0.3 - 0.4 * hash21(key + 6.0)), 0.13) * step(abs(q.y - 0.62), 0.14) * step(0.55, hash21(key + 8.0));
          return vec3(0.62 - 0.42 * furn) * fade + vec3(0.25, 0.55, 0.9) * pic * 0.5;
        }
        if (t3.y <= t + 1e-4) return (dir.y > 0.0 ? vec3(0.95) : vec3(0.36)) * fade; // lit ceiling / floor
        return vec3(0.72) * fade;
      }
      void main() {
        float seed = vParams.x, style = vParams.y, litFrac = vParams.z;
        vec3 base = vec3(0.010, 0.012, 0.020);
        vec3 col = base;
        if (vN.y > 0.5) {
          // Roof: dark deck, panel seams, a glowing parapet so rooftops read from above.
          vec2 e = min(vRoof, vSize.xz - vRoof);
          float edge = min(e.x, e.y);
          vec2 t = abs(fract(vRoof / 3.0) - 0.5);
          float wet = fbm(vRoof * 0.35 + vParams.x * 30.0);
          col = base * (1.2 + 2.2 * wet) + vec3(0.012) * smoothstep(0.46, 0.5, max(t.x, t.y));
          col += vec3(0.03, 0.035, 0.06) * smoothstep(0.55, 0.7, wet); // standing water catching the sky glow
          col += vTint * smoothstep(0.45, 0.2, edge) * 0.9;
          col += vTint * 0.03 * exp(-edge * 0.25);
        } else if (vN.y > -0.5) {
          float u = vFace.x, v = vFace.y, W = vFace.z, H = vSize.y;
          float fid = dot(vN, vec3(1.0, 0.0, 2.0));
          if (style > 2.5) {
            // The Spire: vertical light channels with packets of light climbing them.
            float s = abs(fract(u / 2.0) - 0.5);
            float lane = floor(u / 2.0) + fid * 7.0;
            float packet = smoothstep(0.75, 1.0, fract(v * 0.012 - uTime * (0.08 + 0.1 * hash11(lane)) + hash11(lane + 3.0)));
            col += vTint * smoothstep(0.12, 0.04, s) * (0.25 + 2.2 * packet);
            col += vTint * 0.05;
          } else {
            vec3 Vd = normalize(vWorld - cameraPosition);
            vec3 ray = vec3(abs(vN.x) > 0.5 ? Vd.z : Vd.x, Vd.y, max(-dot(Vd, vN), 0.03));
            // Wall: per-building concrete tone, rain streaks, lit from below by the street.
            vec3 wall = mix(vec3(0.050, 0.052, 0.062), vec3(0.078, 0.062, 0.052), hash11(seed * 57.0)) * (0.7 + 0.6 * hash11(seed * 23.0));
            wall *= 0.5 + 1.1 * vnoise(vec2(u * 1.3 + seed * 40.0, v * 0.07)) * (0.5 + vnoise(vec2(u * 0.21, v * 0.5 + seed * 9.0)));
            vec3 soft = mix(vTint, vec3(dot(vTint, vec3(0.33))), 0.45); // desaturated district colour for bounce light
            vec3 amb = vec3(0.07, 0.08, 0.16) + (soft * 0.32 + vec3(1.0, 0.72, 0.45) * 0.3) * exp(-vWorld.y * 0.1);

            vec2 cs = style < 0.5 ? vec2(2.4, 3.2) : style < 1.5 ? vec2(1.5, 3.6) : vec2(4.2, 2.9);
            float cols = max(1.0, floor((W - 1.0) / cs.x));
            float mu = (W - cols * cs.x) * 0.5;
            vec2 g = vec2((u - mu) / cs.x, v / cs.y);
            vec2 id = floor(g), f = fract(g);
            float inb = step(mu, u) * step(u, W - mu) * step(vParams.w < 0.5 ? 4.2 : 0.4, v) * step(v, H - 1.2);
            vec2 key = id + seed * 71.3 + fid * 13.7;
            float floorR = hash11(id.y * 1.7 + seed * 91.0);
            float lit = max(step(1.0 - litFrac, hash21(key)), step(0.94, floorR)) * step(0.1, floorR);
            vec2 pad = style < 1.5 ? vec2(0.14, 0.2) : vec2(0.04, 0.24);
            vec2 wf = (f - pad) / (1.0 - 2.0 * pad);
            float aa = max(fwidth(g.x), fwidth(g.y));
            vec3 wcol = wall * amb * (1.0 + 0.9 * smoothstep(0.08, 0.05, f.y) * inb); // floor-slab ledge catches light
            col = wcol;
            if (inb > 0.5 && wf.x > 0.0 && wf.x < 1.0 && wf.y > 0.0 && wf.y < 1.0) {
              float pick = hash21(key + 3.1);
              vec3 wc = pick < 0.55 ? vec3(1.0, 0.70, 0.40) : pick < 0.85 ? vec3(0.55, 0.80, 1.0) : mix(vTint, vec3(1.0), 0.25);
              float bright = 0.3 + 0.85 * hash21(key + 7.7);
              float fl = hash21(key + 9.1);
              if (fl > 0.985) bright *= 0.35 + 0.65 * step(0.4, fract(uTime * (3.0 + fl * 40.0)));
              vec3 rm = room(wf, ray, cs * (1.0 - 2.0 * pad), 3.4, key, 0.0); // fake 3D interior
              vec3 win = mix(vec3(0.010, 0.014, 0.024) * (0.5 + rm), wc * bright * rm * 0.82, lit);
              // Half-drawn blinds on some windows.
              float cut = 0.25 + 0.6 * hash21(key + 4.4);
              win *= mix(1.0, 0.45 + 0.3 * step(0.5, fract(wf.y * 16.0)), step(0.6, hash21(key + 1.3)) * step(cut, wf.y));
              // Frame and mullion.
              float edge = min(min(wf.x, 1.0 - wf.x), min(wf.y, 1.0 - wf.y));
              win *= 0.2 + 0.8 * smoothstep(0.0, 0.05, edge);
              if (style < 0.5) win *= 0.25 + 0.75 * smoothstep(0.012, 0.03, abs(wf.x - 0.5));
              win += vec3(0.02, 0.03, 0.055) * pow(clamp(1.0 - ray.z, 0.0, 1.0), 3.0); // glass sheen at grazing angles
              col = win;
            }
            // When cells shrink below a pixel, fade to the average so far towers do not shimmer.
            col = mix(col, wcol + vec3(0.8, 0.72, 0.62) * litFrac * 0.16 * inb, smoothstep(0.35, 0.9, aa));

            // Street-level shopfronts: open shops, rolled shutters and service doors.
            if (vParams.w < 0.5 && v < 4.2) {
              float bw = W / max(1.0, floor(W / 5.0));
              float bay = floor(u / bw);
              float kind = hash11(bay * 7.0 + seed * 53.0 + fid);
              vec3 sc = mix(vTint, vec3(1.0, 0.8, 0.55), hash11(bay + seed * 17.0));
              vec3 fcol = wall * amb * 1.25;
              col = fcol;
              vec2 sf = vec2((fract(u / bw) - 0.07) / 0.86, (v - 0.25) / 3.2);
              if (sf.x > 0.0 && sf.x < 1.0 && sf.y > 0.0 && sf.y < 1.0) {
                if (kind > 0.42) {
                  col = sc * room(sf, ray, vec2(bw * 0.86, 3.2), 4.5, vec2(bay, seed * 31.0 + fid), 1.0) * 0.45;
                  float third = abs(fract(sf.x * 3.0) - 0.5);
                  col *= 0.25 + 0.75 * smoothstep(0.47, 0.44, third); // glazing bars
                  col += vec3(0.02, 0.03, 0.055) * pow(clamp(1.0 - ray.z, 0.0, 1.0), 3.0);
                } else if (kind > 0.15) {
                  float slat = 0.6 + 0.4 * sin(sf.y * 70.0);
                  float tag = smoothstep(0.55, 0.75, vnoise(sf * vec2(3.0, 2.0) + seed * 20.0 + bay));
                  col = (vec3(0.07, 0.075, 0.085) * slat + vTint * tag * 0.05) * amb * 1.5;
                } else {
                  float door = step(abs(sf.x - 0.5), 0.14) * step(sf.y, 0.72);
                  col = mix(fcol, vec3(0.03, 0.035, 0.045) * amb * 2.0, door);
                  col += vec3(1.0, 0.3, 0.2) * step(abs(sf.x - 0.5), 0.035) * step(abs(sf.y - 0.8), 0.014) * 1.6;
                }
              }
              col += vTint * smoothstep(0.07, 0.02, abs(v - 3.85)) * 1.0; // fascia light strip
            }
            // Neon trims on corners and crown for some buildings.
            float trim = step(0.6, hash11(seed * 311.0));
            col += vTint * smoothstep(0.16, 0.05, min(u, W - u)) * trim * 1.0;
            col += vTint * smoothstep(0.3, 0.1, H - v) * step(0.45, hash11(seed * 173.0)) * 1.0;
          }
        }
        col += vec3(0.25, 1.0, 0.9) * pulseRing(vWorld) * (0.25 + 0.75 * step(0.9, fract(vWorld.y * 0.5)));
        gl_FragColor = vec4(applyFog(headlit(col, vWorld), vWorld), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- wet ground (used by Reflector)
export const groundShader = {
  name: 'WetGround',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, ...U },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv; varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: COMMON + /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec4 vUv; varying vec3 vWorld;
    const float HALF = 350.0;
    void main() {
      vec2 p = vWorld.xz;
      float land = step(max(abs(p.x), abs(p.y)), HALF);
      vec2 l = mod(p + 38.0, 76.0) - 38.0;
      vec2 a = abs(l);
      float m = max(a.x, a.y);
      vec3 tint = uTints[districtAt(p)];
      vec3 alb = mix(vec3(0.016), vec3(0.034), fbm(p * 0.6));
      vec3 emis = vec3(0.0);
      float puddle = smoothstep(0.46, 0.6, fbm(p * 0.075 + 3.0));
      float rough = 1.0;
      if (land < 0.5) {
        alb = vec3(0.003, 0.006, 0.010); puddle = 1.0;
        // Sea wall light line at the island edge.
        emis += vec3(1.0, 0.25, 0.2) * smoothstep(0.5, 0.1, abs(max(abs(p.x), abs(p.y)) - HALF - 0.6)) * 1.5
              * step(0.5, fract((p.x + p.y) / 4.0));
      } else if (m < 30.0) {
        vec2 t = abs(fract(p / 1.5) - 0.5);
        alb = mix(vec3(0.05, 0.05, 0.058), vec3(0.014), smoothstep(0.45, 0.5, max(t.x, t.y)));
        alb *= (0.6 + 0.5 * hash21(floor(p / 1.5))) * (0.6 + 0.8 * fbm(p * 1.7)); // worn, stained slabs
        puddle *= 0.45;
      } else {
        bool alongZ = a.x > 30.0 && a.y <= 30.0;
        bool alongX = a.y > 30.0 && a.x <= 30.0;
        vec2 r = alongZ ? vec2(a.x, l.y) : vec2(a.y, l.x); // (distance from block centre, along road)
        float acr = alongZ ? l.x : l.y;
        float paint = 0.0;
        if (alongZ || alongX) {
          paint = smoothstep(0.2, 0.1, abs(r.x - 38.0)) * step(0.5, fract(r.y / 6.0)) * step(abs(r.y), 22.0);
          paint = max(paint, step(24.0, abs(r.y)) * step(abs(r.y), 28.5) * step(0.5, fract(acr / 1.6)) * step(31.0, r.x));
          emis += tint * smoothstep(0.11, 0.03, abs(r.x - 30.2)) * 0.9; // LED kerb
        }
        alb = mix(alb, vec3(0.30, 0.29, 0.25), paint * (0.5 + 0.5 * vnoise(p * 3.0)));
      }
      // Street lamps sit on a regular lattice, so their pools can be computed analytically.
      float d1 = length(a - vec2(15.0, 29.4)), d2 = length(a - vec2(29.4, 15.0));
      vec2 bc = abs(p - l); // centre of the lattice cell: only the 9x9 real blocks carry lamps
      float pool = (exp(-d1 * d1 / 34.0) + exp(-d2 * d2 / 34.0)) * land * step(max(bc.x, bc.y), 305.0);
      vec3 col = alb * (vec3(1.0, 0.72, 0.45) * pool * 2.2 + tint * 0.3 + vec3(0.08, 0.1, 0.2)) + emis;

      // Reflection: fresnel-weighted mirror, blurred by wet-asphalt grain, rippled in puddles.
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = 0.03 + 0.97 * pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
      vec2 rip = vec2(vnoise(p * 2.1 + uTime * vec2(0.7, 0.4)), vnoise(p * 2.1 - uTime * vec2(0.5, 0.8) + 9.0)) - 0.5;
      float ring = sin(length(fract(p * 0.35 + rip * 0.2) - 0.5) * 50.0 - uTime * 9.0) * hash21(floor(p * 0.35 + rip * 0.2));
      vec2 grain = vec2(hash21(p * 37.0), hash21(p * 37.0 + 5.0)) - 0.5;
      float blur = mix(0.032, 0.006, puddle);
      vec2 off = rip * mix(0.012, 0.03, puddle) + vec2(0.0, ring * 0.004 * puddle);
      vec3 refl = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        vec2 j = (grain + vec2(0.0, float(i) - 1.5) * 0.7) * blur;
        refl += texture2DProj(tDiffuse, vec4(vUv.xy + (off + j) * vUv.w, vUv.zw)).rgb;
      }
      col += refl * 0.25 * fres * mix(0.5, 1.0, puddle);

      float pr = pulseRing(vWorld);
      vec2 gl = abs(fract(p / 4.0) - 0.5);
      col += vec3(0.25, 1.0, 0.9) * pr * (0.3 + 1.2 * smoothstep(0.44, 0.5, max(gl.x, gl.y)));
      gl_FragColor = vec4(applyFog(headlit(col, vWorld), vWorld), 1.0);
    }`,
};

// ---------------------------------------------------------------- sky dome
export function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared(), side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uFogColor, uFogHigh, smoothstep(0.0, 0.5, h));
        vec2 cp = d.xz / (abs(h) + 0.2);
        float c = fbm(cp * 1.4 + uTime * 0.012);
        vec3 glow = mix(vec3(0.55, 0.12, 0.42), vec3(0.08, 0.32, 0.5), vnoise(cp * 0.5 + 2.0));
        float up = smoothstep(-0.02, 0.25, h);
        col += glow * c * c * 0.3 * up * (1.0 - 0.6 * h);
        col += vec3(0.5, 0.56, 0.9) * uFlash * c * up;
        // Aurora curtains, only after the signal is released.
        vec2 az = normalize(d.xz + 1e-5);
        float ang = atan(az.y, az.x);
        float band = sin(ang * 3.0 + fbm(az * 2.0 + uTime * 0.03) * 5.0 + uTime * 0.12);
        float curtain = smoothstep(0.1, 1.0, band) * smoothstep(0.06, 0.3, h) * smoothstep(0.95, 0.4, h);
        float rays = 0.5 + 0.5 * vnoise(vec2(ang * 46.0, uTime * 0.4));
        col += uAurora * curtain * rays * mix(vec3(0.1, 1.0, 0.6), vec3(0.75, 0.2, 1.0), smoothstep(0.15, 0.7, h)) * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- rain streaks around the camera
export function rainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared({ uBox: { value: new THREE.Vector3(44, 34, 44) } }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uBox;
      attribute vec3 aSeed; attribute float aEnd;
      varying float vAlpha;
      void main() {
        vec3 p = aSeed * uBox;
        p.y -= uTime * (24.0 + aSeed.x * 14.0);
        p.x += uTime * 2.5;
        p = mod(p - cameraPosition, uBox) - uBox * 0.5 + cameraPosition;
        p += aEnd * vec3(0.09, 0.9, 0.0) * (0.6 + aSeed.z);
        float d = distance(p.xz, cameraPosition.xz);
        vAlpha = smoothstep(uBox.x * 0.5, uBox.x * 0.2, d) * (0.4 + 0.6 * aSeed.y) * step(0.0, p.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() { gl_FragColor = vec4(vec3(0.5, 0.62, 0.9) * 0.3 * vAlpha, 1.0); }`,
  });
}

// ---------------------------------------------------------------- grav-lift column
export function liftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared(), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec2 vUv;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec3 vWorld; varying vec2 vUv;
      void main() {
        float chev = fract(vWorld.y * 0.3 - uTime * 1.6 + abs(fract(vUv.x * 6.0) - 0.5) * 0.8);
        float a = 0.05 + 0.5 * smoothstep(0.8, 1.0, chev);
        a *= smoothstep(1.0, 0.92, vUv.y) * (0.5 + 0.5 * smoothstep(0.0, 0.02, vUv.y));
        vec3 col = vec3(1.0, 0.62, 0.15) * a * 1.5;
        gl_FragColor = vec4(applyFog(col, vWorld) - applyFog(vec3(0.0), vWorld), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- holographic moth wing
export function wingMaterial(colA, colB, gain = 1) {
  return new THREE.ShaderMaterial({
    uniforms: shared({ uColA: { value: new THREE.Color(...colA) }, uColB: { value: new THREE.Color(...colB) }, uGain: { value: gain } }),
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColA; uniform vec3 uColB; uniform float uGain;
      varying vec2 vUv;
      void main() {
        vec2 q = vUv;
        float d1 = length((q - vec2(0.47, 0.66)) / vec2(0.52, 0.31));
        float d2 = length((q - vec2(0.30, 0.27)) / vec2(0.32, 0.26));
        float d = min(d1, d2);
        float shape = smoothstep(1.0, 0.94, d);
        float rim = smoothstep(0.72, 0.98, d);
        float veins = pow(abs(sin(atan(q.y - 0.5, q.x + 0.02) * 15.0)), 10.0);
        float eye = smoothstep(0.035, 0.0, abs(length(q - vec2(0.56, 0.68)) - 0.10)) + smoothstep(0.05, 0.0, length(q - vec2(0.56, 0.68)));
        float scan = 0.65 + 0.35 * sin(q.y * 140.0 + uTime * 5.0);
        float a = shape * (0.10 + rim * 0.9 + veins * 0.28 + eye * 0.9) * scan;
        gl_FragColor = vec4(mix(uColA, uColB, q.x) * a * uGain, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- little moths orbiting each shard
export function swarmMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared({ uScale: { value: 600 } }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uScale;
      attribute vec3 aCenter; attribute vec4 aSeed;
      varying float vA;
      void main() {
        float sp = 0.6 + aSeed.y * 1.4, r = 0.7 + aSeed.z * 2.2;
        float ph = aSeed.x * 6.283;
        vec3 p = aCenter + vec3(sin(uTime * sp + ph) * r, 1.3 + (aSeed.w - 0.5) * 2.6 + sin(uTime * 1.7 + ph * 3.0) * 0.4, cos(uTime * sp * 1.13 + ph) * r);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(uScale * 0.11 / -mv.z, 1.0, 14.0);
        vA = 0.5 + 0.5 * sin(uTime * 24.0 + ph * 9.0); // wingbeat flicker
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, length(c * vec2(1.0, 1.6 + vA)));
        gl_FragColor = vec4(vec3(0.7, 1.5, 1.6) * a * (0.5 + vA), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- final grade: aberration, vignette, grain
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.008;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - r2 * 0.85;
      col += (h(gl_FragCoord.xy + fract(uTime) * 311.0) - 0.5) * 0.012;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// ---------------------------------------------------------------- props: instanced boxes with faked street lighting
export function propMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared(),
    vertexShader: /* glsl */ `
      attribute vec4 aCol; // rgb, emissive flag
      varying vec3 vWorld; varying vec3 vN; varying vec4 vCol;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz; vN = normal; vCol = aCol;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying vec4 vCol;
      void main() {
        vec3 tint = uTints[districtAt(vWorld.xz)];
        vec3 street = (mix(tint, vec3(dot(tint, vec3(0.33))), 0.45) * 0.34 + vec3(1.0, 0.72, 0.45) * 0.4) * exp(-vWorld.y * 0.1);
        float facing = 0.55 + 0.45 * max(vN.y, 0.0) + 0.2 * abs(vN.x);
        vec3 lit = vCol.rgb * (vec3(0.07, 0.08, 0.16) + street) * facing * 1.6;
        vec3 col = mix(lit, vCol.rgb, vCol.a);
        col += vec3(0.25, 1.0, 0.9) * pulseRing(vWorld) * 0.3;
        gl_FragColor = vec4(applyFog(headlit(col, vWorld), vWorld), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- soft light cone under each street lamp
export function coneMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared(), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying float vH;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vH = uv.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying float vH;
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float body = pow(abs(dot(normalize(vN), V)), 1.6); // fade the silhouette so it reads as a volume
        float a = body * pow(clamp(vH, 0.0, 1.0), 1.7) * 0.16 * (0.85 + 0.15 * vnoise(vWorld.xz * 3.0 + vec2(0.0, uTime * 2.0)));
        vec3 col = vec3(1.0, 0.74, 0.45) * a;
        gl_FragColor = vec4(applyFog(col, vWorld) - applyFog(vec3(0.0), vWorld), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- pedestrians: legs swing in the vertex shader
export function pedMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared(), side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aPart;  // 0 body, 1 left leg, 2 right leg, 3 umbrella canopy, 4 umbrella shaft
      attribute vec4 aLook;   // umbrella rgb, has-umbrella flag
      attribute vec2 aWalk;   // stride frequency, phase
      attribute vec4 aColor;  // painted albedo from the Blender model
      varying vec3 vWorld; varying vec3 vN; varying float vPart; varying vec3 vBrolly; varying vec3 vCol;
      void main() {
        vec3 p = position;
        if (aPart > 0.5 && aPart < 2.5) {
          float ang = sin(uTime * aWalk.x + aWalk.y) * 0.6 * (aPart < 1.5 ? 1.0 : -1.0);
          p.y -= 0.82;
          p.yz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.yz;
          p.y += 0.82;
        }
        if (aPart > 2.5 && aLook.a < 0.5) p = vec3(0.0); // no umbrella: collapse it
        p.y += abs(sin(uTime * aWalk.x + aWalk.y)) * 0.04;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = wp.xyz; vN = normalize(mat3(instanceMatrix) * normal); vPart = aPart; vBrolly = aLook.rgb; vCol = aColor.rgb;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying float vPart; varying vec3 vBrolly; varying vec3 vCol;
      void main() {
        vec3 tint = uTints[districtAt(vWorld.xz)];
        vec3 street = (tint * 0.55 + vec3(1.0, 0.72, 0.45) * 0.45) * exp(-vWorld.y * 0.1);
        vec3 V = normalize(cameraPosition - vWorld);
        float rim = pow(clamp(1.0 - abs(dot(normalize(vN), V)), 0.0, 1.0), 2.5);
        float who = hash11(floor(vBrolly.r * 97.0) + floor(vBrolly.g * 31.0));
        vec3 coat = mix(mix(vec3(0.10, 0.11, 0.15), vec3(0.22, 0.13, 0.09), who), vec3(0.16, 0.05, 0.07), step(0.8, who));
        float key = step(abs(vCol.r - vCol.b), 0.03) * step(0.2, vCol.r);            // neutral grey = the coat
        vec3 alb = mix(vCol, coat * vCol.r * 2.4, key);
        vec3 col = alb * (vec3(0.10, 0.11, 0.20) + street * (0.6 + 0.4 * max(normalize(vN).y, 0.0))) * 1.5 + street * rim * 0.06;
        if (vPart > 2.5 && vPart < 3.5) col = vBrolly * vCol.r * (0.5 + 0.5 * rim) + street * 0.03; // translucent lit canopy
        gl_FragColor = vec4(applyFog(headlit(col, vWorld), vWorld), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- tail-light streak behind each flying car
export function trailMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared(), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      void main() { vUv = uv; vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        float a = pow(clamp(vUv.y, 0.0, 1.0), 2.2) * smoothstep(0.5, 0.15, abs(vUv.x - 0.5));
        vec3 col = vec3(1.6, 0.16, 0.1) * a;
        gl_FragColor = vec4(applyFog(col, vWorld) - applyFog(vec3(0.0), vWorld), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- steam rising from street vents
export function steamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared(), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld; varying float vSeed;
      void main() {
        vUv = uv; vSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld; varying float vSeed;
      void main() {
        vec2 q = vec2(vUv.x - 0.5, vUv.y);
        float spread = 0.08 + 0.42 * q.y;
        float n = fbm(vec2(q.x * 3.0 / spread * 0.25 + vSeed, q.y * 3.0 - uTime * 0.55 + vSeed));
        float a = smoothstep(spread, 0.0, abs(q.x + (n - 0.5) * 0.25 * q.y)) * smoothstep(1.0, 0.25, q.y) * smoothstep(0.0, 0.06, q.y);
        a *= smoothstep(0.25, 0.75, n) * 0.5;
        vec3 tint = uTints[districtAt(vWorld.xz)];
        vec3 col = (tint * 0.5 + vec3(0.55, 0.42, 0.32)) * a * 0.3;
        gl_FragColor = vec4(applyFog(col, vWorld) - applyFog(vec3(0.0), vWorld), 1.0);
      }`,
  });
}

// Runs before bloom: a single NaN or runaway pixel would otherwise be blurred into a large black or white block.
export const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      gl_FragColor = vec4(clamp(c, 0.0, 40.0), 1.0);
    }`,
};

// ---------------------------------------------------------------- Blender-built vehicles and gates
// Painted vertex colour (alpha = emission). Mid-grey is the "paint" key and takes a colour-shifting clear-coat;
// near-black is glass and trim. Reflections come from a cube map of the city rendered around the player's car.
// Works for single meshes and instanced traffic (instance colour = paint tint).
export const carEnv = { uEnv: { value: null }, uEnvOn: { value: 0 } };
export function carMaterial(extra = {}) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: shared({
      ...carEnv, uBrake: { value: 0 }, uPaint: { value: new THREE.Color(...(extra.paint ?? [1, 1, 1])) }, uPaintB: { value: new THREE.Color(...(extra.paintB ?? extra.paint ?? [1, 1, 1])) },
      uGloss: { value: extra.gloss ?? 1 }, uEmis: { value: extra.emis ?? 2.6 }, uFade: { value: 1 }, uLamp: { value: new THREE.Color(1, 1, 1) },
    }),
    vertexShader: /* glsl */ `
      attribute vec4 aColor;
      varying vec3 vWorld; varying vec3 vN; varying vec4 vCol; varying vec3 vPaint;
      uniform vec3 uPaint;
      void main() {
        mat4 m = modelMatrix;
        vec3 paint = uPaint;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        #ifdef USE_INSTANCING_COLOR
          paint *= instanceColor;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vWorld = wp.xyz; vN = normalize(mat3(m) * normal); vCol = aColor; vPaint = paint;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: COMMON + /* glsl */ `
      uniform float uBrake, uGloss, uEmis, uFade, uEnvOn; uniform vec3 uLamp, uPaint, uPaintB; uniform samplerCube uEnv;
      varying vec3 vWorld; varying vec3 vN; varying vec4 vCol; varying vec3 vPaint;
      void main() {
        vec3 N = normalize(vN + vec3(0.0, 1e-4, 0.0));
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        vec3 tint = uTints[districtAt(vWorld.xz)];
        vec3 street = (mix(tint, vec3(dot(tint, vec3(0.33))), 0.4) * 0.5 + vec3(1.0, 0.72, 0.45) * 0.45) * exp(-max(vWorld.y, 0.0) * 0.1);
        float lum = dot(vCol.rgb, vec3(0.3, 0.6, 0.1));
        float isPaint = smoothstep(0.12, 0.3, lum);                  // the grey key colour
        float glassy = 1.0 - smoothstep(0.0, 0.012, lum);            // near-black: glass
        // colour-shifting paint: one hue face-on, another at grazing angles (uPaintB = uPaint gives plain paint)
        vec3 shift = mix(vPaint, vPaint * uPaintB / max(uPaint, vec3(1e-3)), pow(1.0 - ndv, 1.4));
        vec3 base = vCol.rgb * mix(vec3(1.0), shift, isPaint);
        vec3 light = vec3(0.05, 0.06, 0.11) + street * (0.35 + 0.65 * max(N.y, 0.0));
        vec3 col = base * light * mix(1.15, 0.7, isPaint);
        // clear-coat: the city mirrored in the bodywork
        vec3 R = reflect(-V, N);
        vec3 env;
        if (uEnvOn > 0.5) {
          env = min(textureCube(uEnv, R, 0.8 - 0.8 * glassy).rgb, vec3(5.0));
          env = mix(env, street * 0.35, smoothstep(0.0, -0.6, R.y));   // the road itself is not in the cube map
        } else {
          float a = atan(R.z, R.x);
          env = mix(tint, vec3(1.0, 0.18, 0.55), vnoise(vec2(a * 1.3, vWorld.x * 0.05 + vWorld.z * 0.05)))
              * smoothstep(0.52, 0.9, vnoise(vec2(a * 2.4 + vWorld.x * 0.11, R.y * 5.0 + vWorld.z * 0.11))) * 1.2;
        }
        float fres = mix(0.05, 1.0, pow(1.0 - ndv, 4.0));
        float coat = mix(0.05 * (1.0 - isPaint) * (1.0 - glassy) + 0.13 * isPaint + 0.3 * glassy, 0.85, fres);
        col += env * coat * uGloss * mix(vec3(1.0), 0.6 + 0.4 * normalize(shift + 1e-3) * 1.7, isPaint * 0.5);
        // overhead lamps as a tight highlight along the upper surfaces
        col += vec3(1.0, 0.8, 0.6) * pow(max(R.y, 0.0), 40.0) * 0.5 * uGloss * (isPaint + glassy);
        // lamps: red ones flare under braking
        float red = step(vCol.g * 3.0, vCol.r);
        col = mix(col, vCol.rgb * uLamp * uEmis * (1.0 + red * uBrake * 2.2), vCol.a);
        col += vec3(0.25, 1.0, 0.9) * pulseRing(vWorld) * 0.3;
        gl_FragColor = vec4(applyFog(col, vWorld) * uFade, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- additive light: headlamp pools, underglow, tail trails, gate holograms
// uMode 0: soft pool on the road (uv from the car outward).  1: ribbon that fades along its length (uv.y = age).
// 2: gate hologram, chevrons scrolling toward the centre.
export function glowMaterial(mode, color, power = 1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: shared({ uColor: { value: new THREE.Color(...color) }, uPower: { value: power }, uMode: { value: mode } }),
    vertexShader: /* glsl */ `
      attribute float aAge;
      varying vec2 vUv; varying vec3 vWorld; varying float vAge;
      void main() {
        vUv = uv; vAge = aAge;
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: COMMON + /* glsl */ `
      uniform vec3 uColor; uniform float uPower; uniform int uMode;
      varying vec2 vUv; varying vec3 vWorld; varying float vAge;
      void main() {
        float a = 0.0;
        vec2 q = vUv - 0.5;
        if (uMode == 0) {
          float along = vUv.y;                                   // 0 at the car, 1 at the far end
          float w = abs(q.x) / (0.1 + 0.4 * along);
          a = smoothstep(1.0, 0.0, w) * smoothstep(0.0, 0.08, along) * (1.0 - along) * (1.0 - along);
          a *= 0.75 + 0.25 * vnoise(vWorld.xz * 1.7);
        } else if (uMode == 1) {
          a = (1.0 - vAge) * (1.0 - vAge) * smoothstep(0.5, 0.0, abs(q.x));
        } else if (uMode == 3) {
          a = smoothstep(1.0, 0.0, length(q) * 2.0); a *= a;      // soft round glow (underglow)
        } else {
          float side = abs(q.x) * 2.0;
          float chev = fract(side * 5.0 - uTime * 1.6 + abs(q.y) * 2.2);
          a = (smoothstep(0.0, 0.15, chev) * smoothstep(0.6, 0.3, chev) * 0.6 + 0.18) * smoothstep(1.0, 0.82, side) * smoothstep(0.5, 0.35, abs(q.y));
          a += 0.5 * smoothstep(0.02, 0.0, abs(abs(q.y) - 0.46));
          a *= 0.8 + 0.2 * sin(uTime * 5.0 + vWorld.y * 3.0);
        }
        float fog = exp(-uFogDensity * uFogDensity * dot(cameraPosition - vWorld, cameraPosition - vWorld));
        gl_FragColor = vec4(uColor * a * uPower * fog, 1.0);
      }`,
  });
}
