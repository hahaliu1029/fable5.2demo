// Procedural audio: every sound is synthesised with the Web Audio API. The same graph builders run on a live
// AudioContext (in the game) and on an OfflineAudioContext (to render a soundtrack for the automated capture).
const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];

function tone(ctx, out, t, freq, dur, peak, type = 'sine', attack = 0.005) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  return o;
}
function noiseBurst(ctx, out, noise, t, dur, peak, f0, f1) {
  const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise; src.loop = true;
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(f0, t); lp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(out); src.start(t, (t * 0.37) % 1.5); src.stop(t + dur + 0.05);
}
export function makeNoise(ctx, rnd) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
  return buf;
}
export const SFX = {
  // rising pentatonic chime: the pitch climbs with the number of orbs collected
  orb(ctx, out, noise, t, n) {
    const f = 523.25 * PENTA[(n - 1) % 5] * Math.pow(2, Math.floor((n - 1) / 5) / 2);
    tone(ctx, out, t, f, 0.9, 0.16); tone(ctx, out, t, f * 2.005, 0.6, 0.07); tone(ctx, out, t + 0.07, f * 1.5, 0.7, 0.07);
  },
  hit(ctx, out, noise, t) { // stone impact: filtered noise crack plus a falling thump
    noiseBurst(ctx, out, noise, t, 0.4, 0.5, 1800, 90);
    const o = tone(ctx, out, t, 130, 0.45, 0.5); o.frequency.exponentialRampToValueAtTime(36, t + 0.4);
  },
  bump(ctx, out, noise, t) {
    noiseBurst(ctx, out, noise, t, 0.2, 0.22, 900, 120);
    const o = tone(ctx, out, t, 90, 0.25, 0.25); o.frequency.exponentialRampToValueAtTime(50, t + 0.2);
  },
  unlock(ctx, out, noise, t) { // temple gong (inharmonic partials) and a rising shimmer
    for (const [m, a, d] of [[1, 0.22, 3.6], [2.01, 0.12, 3.0], [2.76, 0.08, 2.4], [3.9, 0.05, 1.8], [5.4, 0.03, 1.2]]) tone(ctx, out, t, 110 * m, d, a, 'sine', 0.01);
    PENTA.forEach((r, i) => tone(ctx, out, t + 0.5 + i * 0.11, 880 * r, 1.2, 0.05));
  },
  win(ctx, out, noise, t) {
    [0, 2, 4, 3, 4].forEach((k, i) => tone(ctx, out, t + i * 0.16, 587.33 * PENTA[k], 1.4, 0.11, 'triangle'));
    for (const r of [1, 5 / 4, 3 / 2, 2]) tone(ctx, out, t + 0.85, 293.66 * r, 3.2, 0.07, 'sine', 0.2);
  },
  click(ctx, out, noise, t) { tone(ctx, out, t, 660, 0.12, 0.08, 'triangle'); },
};
// Soft ambient drone (open fifth on D with slow beating and a breathing filter) plus wind that follows flight speed.
export function buildAmbient(ctx, out, noise, t = 0) {
  const lp = ctx.createBiquadFilter(), bus = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
  bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(1, t + 2.5);
  const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
  lfo.frequency.value = 0.07; lfoG.gain.value = 180; lfo.connect(lfoG).connect(lp.frequency); lfo.start(t);
  for (const [f, a, type] of [[73.42, 0.085, 'sine'], [73.9, 0.06, 'sine'], [110.0, 0.05, 'sine'], [146.6, 0.03, 'triangle'], [147.3, 0.03, 'triangle'], [220.4, 0.014, 'sine']]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = a; o.connect(g).connect(lp); o.start(t);
  }
  lp.connect(bus).connect(out);
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), wind = ctx.createGain();
  src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6; wind.gain.value = 0.012;
  src.connect(bp).connect(wind).connect(out); src.start(t);
  return { wind, bp };
}

export class GameAudio {
  constructor(rnd) { this.rnd = rnd; this.ctx = null; this.muted = false; this.log = []; }
  start() {
    if (this.ctx) { this.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(this.ctx.destination);
      this.noise = makeNoise(this.ctx, this.rnd);
      this.amb = buildAmbient(this.ctx, this.master, this.noise, this.ctx.currentTime);
      this.resume(); // Firefox and Safari create the context suspended even inside a user gesture
    } catch (e) { this.ctx = null; console.warn('audio unavailable', e.message); }
  }
  // gameT is recorded so the capture script can re-render the same events offline
  // delay applies both live and in the offline render
  play(name, arg, gameT, delay = 0) {
    this.log.push({ name, arg, t: gameT + delay });
    if (!this.ctx) return;
    this.resume();
    if (this.ctx.state === 'running') SFX[name](this.ctx, this.master, this.noise, this.ctx.currentTime + 0.01 + delay, arg);
  }
  resume() { if (this.ctx && this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {}); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  setWind(v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.amb.wind.gain.setTargetAtTime(0.012 + 0.07 * v * v, t, 0.25); this.amb.bp.frequency.setTargetAtTime(380 + 700 * v, t, 0.25);
  }
  toggleMute() { this.muted = !this.muted; if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05); return this.muted; }
}

// Renders ambient + logged sound events for the window [t0, t0 + dur] of game time; returns a base64 16-bit WAV.
export async function renderOffline(log, t0, dur, seed = 555) {
  const sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  let a = seed; const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  const noise = makeNoise(ctx, rnd), amb = buildAmbient(ctx, master, noise, 0);
  amb.wind.gain.value = 0.045;
  for (const e of log) { const t = e.t - t0; if (t >= 0 && t < dur) SFX[e.name](ctx, master, noise, t, e.arg); }
  const buf = await ctx.startRendering();
  const n = buf.length, out = new DataView(new ArrayBuffer(44 + n * 4)), L = buf.getChannelData(0), R = buf.getChannelData(1);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  let bin = ''; const u8 = new Uint8Array(out.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
