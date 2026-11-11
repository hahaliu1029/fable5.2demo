// GLSL for every surface in the game. All materials share one underwater shading model:
// sunlight absorbed per-channel with depth, animated caustics, headlamps, local glow lights and distance fog.

export const NUM_GLOW = 6;

const UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uLampPos[2];
uniform vec3 uLampDir;
uniform float uLampOn;
uniform vec4 uGlowPos[${NUM_GLOW}];
uniform vec3 uGlowCol[${NUM_GLOW}];
uniform vec4 uSonar;
uniform vec3 uSubPos;
uniform float uGlobalGlow;
uniform vec4 uReveal;   // promo "blueprint" effect: origin + radius of the painted-in region; w < 0 disables it
uniform sampler2D uNoise;
`;

export const COMMON = /* glsl */ `
${UNIFORMS}
const vec3 K_ABS = vec3(0.066, 0.027, 0.019);
const vec3 K_FOG = vec3(0.052, 0.027, 0.021);
const vec3 SUN_COL = vec3(1.0, 0.95, 0.86) * 3.4;
const vec3 SCATTER = vec3(0.018, 0.19, 0.36);
const vec3 FLOOR_GLOW = vec3(0.0016, 0.0034, 0.0075);

vec3 sunAtDepth(float d) { return SUN_COL * exp(-K_ABS * max(d, 0.0) * 1.1); }

// Light scattered toward the eye along a view ray: the colour of open water.
vec3 inscatter(vec3 dir, float camY, float dist) {
  float reach = min(dist, 70.0) * 0.5;
  float d = max(-(camY + dir.y * reach), 0.0);
  vec3 c = SCATTER * exp(-K_ABS * d) * 1.7;
  float up = dir.y * 0.5 + 0.5;
  c *= mix(0.3, 1.6, up * up);
  float sd = max(dot(dir, uSunDir), 0.0);
  c += SUN_COL * (0.035 * pow(sd, 4.0) + 0.12 * pow(sd, 32.0)) * exp(-K_ABS * d * 1.6);
  return c + FLOOR_GLOW;
}

float causticTex(vec2 p) {
  vec2 w = texture2D(uNoise, p * 0.011 + uTime * 0.006).ra - 0.5;
  vec2 q = p * 0.036 + w * 0.2;
  float a = texture2D(uNoise, q + vec2(uTime * 0.013, uTime * 0.007)).b;
  float b = texture2D(uNoise, q * 1.31 + vec2(-uTime * 0.009, uTime * 0.012) + 0.31).b;
  return (pow(a, 5.0) + pow(b, 5.0)) * 0.75 + pow(a * b, 2.0) * 2.6;
}

float caustic(vec3 wp) {
  return causticTex(wp.xz + uSunDir.xz * (wp.y / uSunDir.y));
}

vec3 lampLight(vec3 wp, vec3 N) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec3 L = uLampPos[i] - wp;
    float d = length(L);
    L /= d;
    float cone = smoothstep(0.74, 0.96, dot(-L, uLampDir));
    float att = exp(-d * 0.03) / (1.0 + 0.007 * d * d);
    sum += vec3(1.0, 0.94, 0.82) * cone * att * (0.25 + 0.75 * max(dot(N, L), 0.0));
  }
  return sum * 9.0 * uLampOn;
}

vec3 glowLight(vec3 wp, vec3 N) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${NUM_GLOW}; i++) {
    vec3 L = uGlowPos[i].xyz - wp;
    float r = uGlowPos[i].w;
    float a = max(0.0, 1.0 - dot(L, L) / (r * r));
    sum += uGlowCol[i] * a * a * (0.4 + 0.6 * max(dot(N, normalize(L)), 0.0));
  }
  return sum;
}

vec3 shadeUW(vec3 albedo, vec3 N, vec3 wp, vec3 V, float gloss, float trans) {
  float depth = max(-wp.y, 0.0);
  vec3 sun = sunAtDepth(depth);
  float ndl = dot(N, uSunDir);
  float wrap = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
  float cmask = smoothstep(-0.15, 0.5, ndl) * exp(-depth * 0.028);
  float ca = caustic(wp) * cmask;
  vec3 direct = sun * (wrap * 0.40 + ca * 0.62 + trans * max(-ndl, 0.0) * 0.6);
  direct += sun * vec3(0.95, 0.8, 0.55) * 0.13 * (0.5 - 0.5 * N.y);
  vec3 amb = SCATTER * exp(-K_ABS * depth) * 1.5 * (0.4 + 0.6 * (N.y * 0.5 + 0.5)) + FLOOR_GLOW * 2.0;
  vec3 col = albedo * (direct + amb + lampLight(wp, N) + glowLight(wp, N));
  vec3 H = normalize(uSunDir + V);
  col += sun * pow(max(dot(N, H), 0.0), mix(12.0, 90.0, gloss)) * gloss * (0.25 + ca);
  vec3 Hl = normalize(V - uLampDir);
  col += lampLight(wp, N) * pow(max(dot(N, Hl), 0.0), 40.0) * gloss * 0.25;
  return col;
}

vec3 fogUW(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  vec3 T = exp(-K_FOG * dist);
  return col * T + inscatter(d / dist, cameraPosition.y, dist) * (1.0 - T);
}

// Outside the reveal radius the world is drawn as a glowing construction grid; a bright front sweeps it into full shading.
float revealMask(float d) {
  return uReveal.w < 0.0 ? 0.0 : smoothstep(uReveal.w - 6.0, uReveal.w, d);
}
vec3 revealFx(vec3 col, vec3 wp) {
  if (uReveal.w < 0.0) return col;
  float d = distance(wp, uReveal.xyz);
  float m = revealMask(d);
  vec3 q = wp * 0.5;
  vec3 g = abs(fract(q) - 0.5) / max(fwidth(q), vec3(1e-4));
  float line = 1.0 - smoothstep(0.0, 1.4, min(g.x, min(g.y, g.z)));
  float fade = exp(-distance(wp, cameraPosition) * 0.011);
  float lum = dot(col, vec3(0.3, 0.5, 0.2));
  vec3 bp = vec3(0.003, 0.010, 0.017) + vec3(0.10, 0.75, 0.95) * line * 0.55 * fade + vec3(0.02, 0.10, 0.14) * lum;
  float front = smoothstep(7.0, 0.0, abs(d - uReveal.w)) * step(0.5, uReveal.w);
  return mix(col, bp, m) + vec3(0.35, 1.0, 0.9) * front * 1.6 * fade;
}

vec3 sonarRing(vec3 wp) {
  if (uSonar.w <= 0.0) return vec3(0.0);
  float d = distance(wp, uSonar.xyz);
  float fade = clamp(1.0 - uSonar.w / 170.0, 0.0, 1.0);
  float ring = smoothstep(2.2, 0.0, abs(d - uSonar.w)) + 0.35 * smoothstep(14.0, 0.0, uSonar.w - d) * step(d, uSonar.w);
  float grid = 0.5 + 0.5 * step(0.92, fract(wp.y * 0.5));
  float distFade = exp(-distance(wp, cameraPosition) * 0.012);
  return vec3(0.25, 1.0, 0.85) * ring * grid * fade * fade * distFade * 1.6;
}
`;

// ---------------------------------------------------------------- terrain
export const terrainVert = /* glsl */ `
attribute float aMask;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vMask;
void main() {
  vWorld = position;
  vNormal = normal;
  vMask = aMask;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

export const terrainFrag = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vMask;
void main() {
  vec3 N = normalize(vNormal);
  float depth = -vWorld.y;
  vec4 n1 = texture2D(uNoise, vWorld.xz * 0.031);
  vec4 n2 = texture2D(uNoise, vWorld.xz * 0.17 + n1.ra * 0.1);
  vec4 n3 = texture2D(uNoise, vWorld.xz * 0.83);
  vec4 nv = texture2D(uNoise, vec2(vWorld.x + vWorld.z, vWorld.y * 1.7) * 0.11);
  float slope = 1.0 - N.y;
  float rock = smoothstep(0.16, 0.40, slope + (n2.r - 0.5) * 0.25 + vMask * 0.14);
  float dz = smoothstep(26.0, 90.0, depth);
  float da = smoothstep(120.0, 175.0, depth);
  float rippleP = vWorld.x * 0.9 + vWorld.z * 2.7 + n1.r * 10.0;
  float rip = sin(rippleP) * 0.5 + 0.5;
  vec3 sand = mix(mix(vec3(0.80, 0.69, 0.50), vec3(0.50, 0.49, 0.45), dz), vec3(0.17, 0.18, 0.21), da);
  sand *= (0.84 + 0.16 * rip) * (0.82 + 0.36 * n3.r);
  sand = mix(sand, sand * vec3(0.55, 0.75, 0.6), smoothstep(0.55, 0.8, n1.a) * (1.0 - dz) * 0.5);
  vec3 rockC = mix(vec3(0.33, 0.29, 0.25), vec3(0.12, 0.12, 0.14), n2.a) * (0.65 + 0.7 * nv.r);
  vec3 crust = mix(vec3(0.36, 0.44, 0.20), vec3(0.70, 0.36, 0.42), n2.g);
  rockC = mix(rockC, crust, (1.0 - dz) * smoothstep(0.35, 0.7, n1.g + vMask * 0.5) * 0.75);
  rockC = mix(rockC, vec3(0.10, 0.11, 0.14) * (0.6 + 0.8 * nv.a), da);
  vec3 albedo = mix(sand, rockC, rock);
  vec3 bump = vec3(n3.r - 0.5, 0.0, n3.a - 0.5) * (0.35 + rock * 0.9) + vec3(0.9, 0.0, 2.7) * cos(rippleP) * 0.035 * (1.0 - rock);
  bump += vec3(n2.g - 0.5, 0.0, n2.r - 0.5) * 0.6 * rock;
  N = normalize(N + bump);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 col = shadeUW(albedo, N, vWorld, V, 0.08 * (1.0 - rock), 0.0);
  col = revealFx(fogUW(col, vWorld) + sonarRing(vWorld), vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- props (flora, rocks, structures)
export const propVert = /* glsl */ `
${UNIFORMS}
attribute vec4 aColor;
uniform vec4 uSway;   // amplitude (m at full height), speed, flutter, reference height
uniform vec3 uTint;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vTint;
varying float vPhase;
void main() {
  mat4 m = modelMatrix;
  vec3 tint = uTint;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  #ifdef USE_INSTANCING_COLOR
    tint *= instanceColor;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vec3 origin = m[3].xyz;
  float ph = origin.x * 0.13 + origin.z * 0.17;
  float sc = length(m[1].xyz);
  float k = pow(clamp(position.y / uSway.w, 0.0, 1.3), 1.6);
  vec2 sway = vec2(sin(uTime * uSway.y + ph + position.y * 0.22), cos(uTime * uSway.y * 0.8 + ph * 1.3 + position.y * 0.17)) * uSway.x * k;
  sway.x += uSway.x * k * 0.8;
  float rad = length(position.xz);
  sway += vec2(sin(uTime * 2.3 + position.y * 3.1 + ph), cos(uTime * 1.9 + position.y * 2.7 + ph)) * uSway.z * rad;
  vec3 away = wp.xyz - uSubPos;
  float ad = length(away);
  sway += away.xz / max(ad, 0.01) * smoothstep(6.0, 1.5, ad) * (uSway.x * k + uSway.z * rad * 3.0) * 1.5;
  wp.xz += sway * sc;
  vWorld = wp.xyz;
  vNormal = normalize(mat3(m) * normal);
  vColor = aColor;
  vTint = tint;
  vPhase = ph;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const propFrag = /* glsl */ `
${COMMON}
uniform float uEmis;
uniform vec3 uEmisCol;
uniform float uGloss;
uniform float uTrans;
uniform float uBackDark;
uniform float uDetail;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vTint;
varying float vPhase;
void main() {
  vec3 N = normalize(vNormal + vec3(0.0, 1e-4, 0.0));
  float back = 1.0;
  if (!gl_FrontFacing) { N = -N; back = uBackDark; }
  vec3 albedo = vColor.rgb * vTint * back;
  float det = texture2D(uNoise, vWorld.xz * 0.47 + vWorld.y * 0.31).r * 0.6 + texture2D(uNoise, vWorld.zy * 1.9 + vWorld.x * 0.7).a * 0.4;
  albedo *= 1.0 - uDetail + uDetail * 2.0 * det;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 col = shadeUW(albedo, N, vWorld, V, uGloss, uTrans);
  float pulse = 0.75 + 0.25 * sin(uTime * 1.4 + vPhase * 7.0);
  col += vColor.rgb * vTint * uEmisCol * vColor.a * uEmis * pulse * uGlobalGlow;
  col = revealFx(fogUW(col, vWorld) + sonarRing(vWorld), vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- single creatures (shark, turtle, manta, whale...)
export const creatureVert = /* glsl */ `
${UNIFORMS}
attribute vec4 aColor;
uniform int uAnim;      // 0 rigid, 1 fish, 2 flap, 3 whale
uniform float uPhase;
uniform float uLen;
uniform float uAmp;
uniform float uBodyHalf;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vTint;
varying float vPhase;
void main() {
  vec3 p = position;
  float s = clamp(0.5 - p.x / uLen, 0.0, 1.5);
  if (uAnim == 1) {
    p.z += sin(uPhase - s * 4.6) * uAmp * (0.12 + s * s) * uLen;
  } else if (uAnim == 2) {
    float w = max(abs(p.z) - uBodyHalf, 0.0) / uLen;
    p.y += sin(uPhase - w * 3.2) * uAmp * (w * 1.6 + w * w * 3.0) * uLen;
    p.z *= 1.0 - 0.12 * w * (0.5 + 0.5 * cos(uPhase - w * 3.2));
  } else if (uAnim == 3) {
    p.y += sin(uPhase - s * 3.6) * uAmp * s * s * uLen;
    float w = max(abs(p.z) - uBodyHalf, 0.0) / uLen;
    p.y += sin(uPhase * 0.5 + 1.0 - w * 4.0) * w * 1.8 * uLen * uAmp * 3.0 * step(s, 0.6);
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColor = aColor;
  vTint = vec3(1.0);
  vPhase = s * 0.9 - uPhase * 0.08;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// ---------------------------------------------------------------- fish schools (fully GPU-animated)
export const SCHOOL_PATH = /* glsl */ `
uniform vec3 uHome;
uniform vec3 uRad;
uniform vec3 uFreq;
uniform vec3 uPh;
uniform float uMode;
vec3 schoolCenter(float t) {
  return uHome + vec3(sin(t * uFreq.x + uPh.x) * uRad.x, sin(t * uFreq.y + uPh.y) * uRad.y, cos(t * uFreq.z + uPh.z) * uRad.z);
}`;

export const schoolVert = /* glsl */ `
${UNIFORMS}
${SCHOOL_PATH}
attribute vec4 aColor;
attribute vec4 aOff;   // stream: offset xyz + phase.  vortex: radius, height, unused, angle
attribute vec4 aParm;  // speed multiplier, scale, lag, tint variation
uniform float uLen;
uniform float uWag;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vTint;
varying float vPhase;
vec3 fishPos(float t) {
  if (uMode < 0.5) {
    vec3 c = schoolCenter(t - aParm.z);
    vec3 o = aOff.xyz * (1.0 + 0.22 * sin(t * 0.6 + aOff.w));
    float a = 0.35 * sin(t * 0.21 + aOff.w);
    o.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * o.xz;
    return c + o + vec3(0.0, sin(t * 1.1 + aOff.w * 3.0) * 0.2, 0.0);
  }
  float ang = aOff.w + t * uFreq.x * aParm.x * (1.4 / (0.5 + aOff.x / uRad.x));
  float r = aOff.x * (1.0 + 0.12 * sin(t * 0.8 + aOff.w * 5.0));
  vec3 c = uHome + vec3(sin(t * 0.07 + uPh.x), 0.0, cos(t * 0.06 + uPh.z)) * uRad.z;
  return c + vec3(cos(ang) * r, aOff.y + sin(t * 0.5 + aOff.w * 2.0) * 0.7, sin(ang) * r);
}
void main() {
  float t = uTime;
  vec3 p0 = fishPos(t);
  vec3 p1 = fishPos(t + 0.1);
  vec3 f = normalize(p1 - p0 + vec3(1e-5, 0.0, 0.0));
  vec3 dd = p0 - uSubPos;
  float dl = length(dd);
  float push = smoothstep(8.0, 2.0, dl);
  p0 += dd / max(dl, 0.01) * push * 4.0;
  f = normalize(f + dd / max(dl, 0.01) * push * 1.6);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  vec3 u = cross(f, r);
  vec3 lp = position * aParm.y;
  float s = clamp(0.5 - position.x / uLen, 0.0, 1.5);
  lp.z += sin(t * uWag * aParm.x * (1.0 + push * 1.5) - s * 4.6 + aOff.w * 9.0) * uLen * aParm.y * 0.1 * (0.15 + s * s * 1.2);
  vec3 wp = p0 + f * lp.x + u * lp.y + r * lp.z;
  vWorld = wp;
  vNormal = normalize(f * normal.x + u * normal.y + r * normal.z);
  vColor = aColor;
  vTint = vec3(1.0) + (aParm.w - 0.5) * vec3(0.25, 0.1, -0.2);
  vPhase = aOff.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

// ---------------------------------------------------------------- jellyfish
export const jellyVert = /* glsl */ `
${UNIFORMS}
attribute vec4 aColor;
attribute vec4 aOff;   // home xyz, phase
attribute vec4 aParm;  // scale, hue, bob, unused
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying float vHue;
varying float vPulse;
void main() {
  float ph = aOff.w;
  float cyc = uTime * 0.9 + ph;
  float c = pow(max(sin(cyc), 0.0), 2.0);
  vec3 p = position;
  float bell = smoothstep(-0.35, 0.1, p.y);
  p.xz *= 1.0 - 0.2 * c * (1.0 - smoothstep(0.1, 0.5, p.y)) * bell;
  p.y += 0.06 * c * bell;
  float hang = max(-p.y - 0.15, 0.0);
  p.xz += vec2(sin(uTime * 0.8 + hang * 1.7 + ph), cos(uTime * 0.7 + hang * 1.4 + ph * 2.0)) * 0.11 * hang;
  p.xz *= 1.0 - 0.1 * hang * c;
  vec3 home = aOff.xyz;
  home.y += sin(uTime * 0.12 + ph) * aParm.z - cos(cyc) * 0.25;
  home.xz += vec2(sin(uTime * 0.05 + ph * 3.0), cos(uTime * 0.04 + ph * 2.0)) * 3.0;
  vec3 dd = home - uSubPos;
  float dl = length(dd);
  home += dd / max(dl, 0.01) * smoothstep(5.0, 1.0, dl) * 2.0;
  vec3 wp = home + p * aParm.x;
  vWorld = wp;
  vNormal = normal;
  vColor = aColor;
  vHue = aParm.y;
  vPulse = c;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

export const jellyFrag = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying float vHue;
varying float vPulse;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.0);
  vec3 hue = mix(vec3(0.35, 0.8, 1.0), vec3(1.0, 0.45, 0.85), vHue);
  hue = mix(hue, vec3(0.5, 1.0, 0.7), smoothstep(0.7, 1.0, vHue));
  float depth = max(-vWorld.y, 0.0);
  vec3 amb = SCATTER * exp(-K_ABS * depth) * 1.2 + lampLight(vWorld, N) * 0.12;
  vec3 col = vColor.rgb * amb * (0.25 + fres);
  col += hue * (0.10 + 0.9 * fres + vColor.a * (0.7 + 1.6 * vPulse)) * (0.55 + 0.45 * uGlobalGlow);
  float dist = distance(vWorld, cameraPosition);
  col *= exp(-K_FOG * dist * 0.8);
  gl_FragColor = vec4((col + sonarRing(vWorld) * 0.3) * (1.0 - revealMask(distance(vWorld, uReveal.xyz))), 1.0);
}`;

// ---------------------------------------------------------------- water surface seen from below, and the open-water dome
export const surfaceVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const surfaceFrag = /* glsl */ `
${COMMON}
uniform vec3 uSunAbove;
varying vec3 vWorld;
void main() {
  vec3 V = normalize(vWorld - cameraPosition);
  vec2 uv = vWorld.xz;
  vec2 g = texture2D(uNoise, uv * 0.013 + uTime * 0.008).ra + texture2D(uNoise, uv * 0.041 - uTime * 0.013).ar - 1.0;
  vec2 g2 = texture2D(uNoise, uv * 0.13 + uTime * 0.03).ra + texture2D(uNoise, uv * 0.31 - uTime * 0.05).ar - 1.0;
  vec3 n = normalize(vec3(g.x * 0.22 + g2.x * 0.10, -1.0, g.y * 0.22 + g2.y * 0.10));
  vec3 R = refract(V, n, 1.333);
  vec3 refl = inscatter(reflect(V, n), cameraPosition.y, 1000.0) * 0.85;
  // Snell's window: the sky is only visible inside a cone overhead; beyond it the surface mirrors the deep.
  float cosT = max(dot(V, -n), 0.0);
  float window = smoothstep(0.655, 0.70, cosT);
  vec3 Rs = normalize(mix(vec3(V.x, max(V.y, 0.05), V.z), R, step(0.001, dot(R, R))));
  vec3 sky = mix(vec3(0.50, 0.78, 0.98), vec3(0.16, 0.42, 0.88), clamp(Rs.y, 0.0, 1.0)) * 1.25;
  float sd = max(dot(Rs, uSunAbove), 0.0);
  sky += SUN_COL * (pow(sd, 900.0) * 30.0 + pow(sd, 60.0) * 0.8 + pow(sd, 8.0) * 0.12);
  float f = 0.02 + 0.98 * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  vec3 col = mix(refl, mix(sky, refl, f), window);
  col = fogUW(col, vWorld);
  col = mix(col, vec3(0.003, 0.010, 0.017), revealMask(min(distance(vWorld, uReveal.xyz), 150.0)));
  gl_FragColor = vec4(col, 1.0);
}`;

export const domeVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww;
}`;

export const domeFrag = /* glsl */ `
${COMMON}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(mix(inscatter(normalize(vDir), cameraPosition.y, 1000.0), vec3(0.003, 0.010, 0.017), revealMask(150.0)), 1.0);
}`;

// ---------------------------------------------------------------- particles
export const snowVert = /* glsl */ `
${UNIFORMS}
attribute vec4 aSeed;
uniform float uBox;
uniform float uPx;
varying float vAlpha;
varying vec3 vCol;
const vec3 K_ABS = vec3(0.066, 0.027, 0.019);
void main() {
  vec3 drift = vec3(sin(uTime * 0.11 + aSeed.w * 6.0) * 0.6, -uTime * (0.05 + aSeed.w * 0.08), cos(uTime * 0.09 + aSeed.w * 9.0) * 0.6);
  vec3 p = position * uBox + drift;
  vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = cameraPosition + rel;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = -mv.z;
  float depth = max(-wp.y, 0.0);
  vec3 amb = vec3(0.5, 0.75, 0.85) * exp(-K_ABS * depth) * 0.55;
  vec3 lamp = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec3 L = uLampPos[i] - wp;
    float d = length(L);
    float cone = smoothstep(0.80, 0.97, dot(-L / d, uLampDir));
    lamp += vec3(1.0, 0.94, 0.82) * cone * exp(-d * 0.04) / (1.0 + 0.012 * d * d);
  }
  vec3 col = amb + lamp * 5.0 * uLampOn;
  float spark = step(0.9, aSeed.x) * smoothstep(60.0, 130.0, depth);
  float tw = pow(0.5 + 0.5 * sin(uTime * (0.6 + aSeed.y * 1.5) + aSeed.z * 40.0), 6.0);
  vec3 sparkCol = mix(vec3(0.3, 0.9, 1.0), vec3(0.5, 1.0, 0.6), aSeed.y);
  float near = smoothstep(12.0, 2.0, distance(wp, uSubPos));
  col += sparkCol * spark * (tw * 1.3 + near * 2.5) * uGlobalGlow;
  vCol = col;
  float size = (0.018 + 0.03 * aSeed.z) * (1.0 + spark * 0.8);
  gl_PointSize = clamp(size * uPx / dist, 1.0, 14.0);
  vAlpha = smoothstep(uBox * 0.5, uBox * 0.3, dist) * smoothstep(0.4, 1.5, dist) * step(wp.y, -0.3);
  gl_Position = projectionMatrix * mv;
}`;

export const snowFrag = /* glsl */ `
varying float vAlpha;
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(q)) * vAlpha;
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

export const bubbleVert = /* glsl */ `
attribute vec2 aInfo;  // size, alpha
uniform float uPx;
varying float vAlpha;
varying float vDepth;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aInfo.x * uPx / -mv.z, 1.0, 40.0);
  vAlpha = aInfo.y;
  vDepth = -position.y;
  gl_Position = projectionMatrix * mv;
}`;

export const bubbleFrag = /* glsl */ `
varying float vAlpha;
varying float vDepth;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * 2.0;
  float r = length(q);
  if (r > 1.0) discard;
  float rim = smoothstep(0.55, 0.95, r) * smoothstep(1.0, 0.92, r);
  float spec = smoothstep(0.35, 0.0, length(q - vec2(-0.35, -0.35)));
  vec3 tint = mix(vec3(0.75, 0.95, 1.0), vec3(0.25, 0.5, 0.7), smoothstep(10.0, 120.0, vDepth));
  gl_FragColor = vec4(tint * (rim * 0.7 + spec * 0.9 + 0.05) * vAlpha, 1.0);
}`;

export const smokeVert = /* glsl */ `
uniform float uTime;
uniform float uPx;
attribute vec4 aSeed;  // phase, spread angle, speed, size
varying float vAge;
varying float vFade;
void main() {
  float age = fract(uTime * (0.07 + aSeed.z * 0.05) + aSeed.x);
  float h = age * (16.0 + aSeed.z * 14.0);
  float spread = 0.25 + age * age * 6.0;
  vec3 wp = position + vec3(cos(aSeed.y) * spread + sin(uTime * 0.5 + aSeed.x * 20.0 + h * 0.2) * age * 1.6, h,
                            sin(aSeed.y) * spread + cos(uTime * 0.4 + aSeed.x * 14.0 + h * 0.25) * age * 1.6);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_PointSize = clamp((0.7 + age * 5.0) * (0.6 + aSeed.w) * uPx / -mv.z, 1.0, 220.0);
  vAge = age;
  vFade = exp(length(mv.xyz) * -0.02);
  gl_Position = projectionMatrix * mv;
}`;

export const smokeFrag = /* glsl */ `
varying float vAge;
varying float vFade;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, r) * smoothstep(0.0, 0.05, vAge) * (1.0 - vAge) * 0.5 * vFade;
  vec3 ember = vec3(1.0, 0.35, 0.08) * smoothstep(0.22, 0.0, vAge) * 3.0;
  vec3 col = mix(vec3(0.012, 0.014, 0.018), vec3(0.03, 0.04, 0.05), vAge) + ember;
  gl_FragColor = vec4(col * a, a);
}`;

// ---------------------------------------------------------------- soft additive volumes (lamp cones, bell pillars)
export const beamVert = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uTime;
uniform sampler2D uNoise;
uniform float uFalloff;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float edge = pow(clamp(abs(dot(normalize(vNormal + vec3(0.0, 1e-4, 0.0)), V)), 0.0, 1.0), 2.2);
  float along = pow(clamp(1.0 - vUv.y, 0.0, 1.0), uFalloff) * smoothstep(0.0, 0.04, vUv.y);
  float dust = 0.7 + 0.6 * texture2D(uNoise, vWorld.xy * 0.05 + vWorld.z * 0.031 + uTime * 0.01).r;
  float dist = distance(cameraPosition, vWorld);
  float a = edge * along * dust * uPower * exp(-dist * 0.012) * smoothstep(0.5, 3.0, dist);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export const glassFrag = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  if (!gl_FrontFacing) N = -N;
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  float depth = max(-vWorld.y, 0.0);
  vec3 env = inscatter(reflect(-V, N), vWorld.y, 1000.0);
  vec3 H = normalize(uSunDir + V);
  vec3 col = env * (0.25 + fres * 1.6) + sunAtDepth(depth) * pow(max(dot(N, H), 0.0), 120.0) * 1.2;
  gl_FragColor = vec4(col, 0.10 + fres * 0.6);
}`;

// ---------------------------------------------------------------- post-processing
export const fsVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Volumetric sun shafts: march the view ray and accumulate light that made it down through the surface pattern.
export const shaftFrag = /* glsl */ `
${COMMON}
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
varying vec2 vUv;
float shaftPattern(vec2 p) {
  float a = texture2D(uNoise, p * 0.012 + vec2(uTime * 0.004, uTime * 0.003)).r;
  float b = texture2D(uNoise, p * 0.031 - vec2(uTime * 0.006, -uTime * 0.004)).a;
  return smoothstep(0.5, 0.72, a * 0.6 + b * 0.5);
}
void main() {
  float z = texture2D(tDepth, vUv).x;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  v /= v.w;
  float sceneDist = length(v.xyz);
  vec3 rd = normalize((uCamWorld * vec4(normalize(v.xyz), 0.0)).xyz);
  float maxD = min(sceneDist, 85.0);
  const int STEPS = 22;
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime * 3.0) * 43758.5453);
  float dt = maxD / float(STEPS);
  vec3 sum = vec3(0.0);
  float phase = 0.22 + 1.6 * pow(max(dot(rd, uSunDir), 0.0), 5.0);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + jitter) * dt;
    vec3 p = uCamPos + rd * t;
    float depth = -p.y;
    if (depth < 0.0) continue;
    vec2 q = p.xz + uSunDir.xz * (p.y / uSunDir.y);
    float pat = shaftPattern(q);
    vec3 sun = SUN_COL * exp(-K_ABS * depth * 1.25);
    sum += sun * pat * exp(-K_FOG * t) * dt;
  }
  gl_FragColor = vec4(sum * phase * 0.04 * vec3(0.55, 0.95, 1.0) * (1.0 - revealMask(110.0)), 1.0);
}`;

export const brightFrag = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tShafts;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb + texture2D(tShafts, vUv).rgb;
  if (any(isnan(c))) c = vec3(0.0);
  c = clamp(c, 0.0, 48.0);
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold * 2.2, l), 1.0);
}`;

export const blurFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
  c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.316216;
  c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;

export const finalFrag = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tShafts;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform sampler2D tBloom3;
uniform float uTime;
uniform float uExposure;
uniform float uPressure;   // 0..1 hull strain: darkens and reddens the frame edge
uniform float uFlash;      // bell awakening flash
uniform vec3 uFlashCol;
uniform float uFade;       // 0 = black
varying vec2 vUv;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 sampleScene(vec2 uv) {
  vec3 c = texture2D(tScene, uv).rgb;
  if (any(isnan(c))) c = vec3(0.0);
  return c + texture2D(tShafts, uv).rgb;
}
void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  uv += vec2(sin(uv.y * 26.0 + uTime * 1.1), cos(uv.x * 22.0 + uTime * 0.9)) * 0.0007 * (1.0 + uPressure * 4.0);
  vec2 ca = c * r2 * (0.012 + uPressure * 0.03);
  vec3 col = vec3(sampleScene(uv + ca).r, sampleScene(uv).g, sampleScene(uv - ca).b);
  vec3 bloom = texture2D(tBloom0, uv).rgb * 0.5 + texture2D(tBloom1, uv).rgb * 0.5 + texture2D(tBloom2, uv).rgb * 0.45 + texture2D(tBloom3, uv).rgb * 0.4;
  col += bloom * 0.55;
  col += uFlashCol * uFlash * (0.25 + 0.75 * smoothstep(0.7, 0.0, sqrt(r2)));
  col *= uExposure;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, 1.12), 0.0);
  col = mix(col, col * vec3(0.92, 1.0, 1.06), 0.5);
  float vig = smoothstep(0.85, 0.2, sqrt(r2) * (1.0 + uPressure * 0.5));
  col *= mix(0.55 - uPressure * 0.35, 1.0, vig);
  col = mix(col, col * vec3(1.3, 0.55, 0.5), uPressure * (1.0 - vig) * 0.8);
  col = pow(col, vec3(1.0 / 2.2));
  float grain = fract(sin(dot(gl_FragCoord.xy + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col += grain * 0.018;
  gl_FragColor = vec4(col * uFade, 1.0);
}`;
