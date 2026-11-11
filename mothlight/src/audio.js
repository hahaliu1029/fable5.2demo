// Fully synthesized soundscape (Web Audio): rain, a slow pad, sparse bell notes and interface sounds.
const CHORDS = [
  [110.0, 164.81, 196.0, 246.94],  // Am9-ish
  [87.31, 130.81, 174.61, 220.0],  // Fmaj7
  [130.81, 164.81, 196.0, 293.66], // Cadd9
  [98.0, 146.83, 174.61, 233.08],  // Gm7
];
const BELLS = [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];

export class Audio {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();
    const master = this.master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    // Feedback delay shared by the musical voices.
    const delay = ctx.createDelay(1.5), fb = ctx.createGain(), wet = this.wet = ctx.createGain();
    delay.delayTime.value = 0.46; fb.gain.value = 0.45; wet.gain.value = 0.5;
    wet.connect(delay); delay.connect(fb).connect(delay); delay.connect(master);

    // Rain: looped white noise through two bands (hiss and low wash).
    const len = ctx.sampleRate * 4;
    const buf = this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const band = (type, freq, gain) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(master); src.start();
    };
    band('highpass', 2500, 0.05);
    band('lowpass', 350, 0.16);

    // Pad: four voices of two detuned saws each, under a slowly breathing low-pass.
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.7;
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06; lfoGain.gain.value = 240; lfo.connect(lfoGain).connect(lp.frequency); lfo.start();
    const padGain = ctx.createGain(); padGain.gain.value = 0.05;
    lp.connect(padGain); padGain.connect(master); padGain.connect(wet);
    this.voices = CHORDS[0].map((f) => [-7, 7].map((cents) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents;
      o.connect(lp); o.start(); return o;
    }));
    let step = 0;
    this.timer = setInterval(() => {
      step = (step + 1) % CHORDS.length;
      CHORDS[step].forEach((f, i) => this.voices[i].forEach((o) => o.frequency.setTargetAtTime(f, ctx.currentTime, 0.9)));
    }, 9000);
    const bell = () => {
      this.tone(BELLS[Math.floor(Math.random() * BELLS.length)], 2.2, 0.035, 'sine', true);
      this.bellTimer = setTimeout(bell, 2500 + Math.random() * 5000);
    };
    bell();
  }

  tone(freq, dur, gain, type = 'sine', echo = false, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); if (echo) g.connect(this.wet);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  burst(dur, gain, freq, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * Math.max(0, this.noise.duration - dur - 0.1)); src.stop(t + dur + 0.05); // never run off the buffer
  }

  step() { this.burst(0.09, 0.07, 700 + Math.random() * 500); }
  land() { this.burst(0.2, 0.16, 300); }
  jump() { this.tone(180, 0.18, 0.05, 'triangle')?.frequency.exponentialRampToValueAtTime(420, this.ctx.currentTime + 0.15); }
  blip() { this.tone(880, 0.12, 0.05, 'square'); this.tone(1320, 0.14, 0.04, 'square', false, 0.07); }
  deny() { this.tone(160, 0.25, 0.07, 'sawtooth'); }
  scan() { this.tone(240, 1.3, 0.08, 'sine', true)?.frequency.exponentialRampToValueAtTime(2200, this.ctx.currentTime + 1.2); this.burst(1.0, 0.04, 3000, 'bandpass'); }
  pickup() { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 1.4, 0.07, 'sine', true, i * 0.08)); }
  thunder() { this.burst(3.5, 0.5, 120); }
  finale() { [130.81, 196, 261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) => this.tone(f, 9, 0.06, 'triangle', true, i * 0.35)); }

  // Driving: a two-oscillator engine whose pitch follows speed, tyre noise that follows slip, a boost whine.
  engine(speed01, throttle, slip01, boosting) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.eng) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; g.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(g).connect(this.master);
      const tyre = ctx.createBufferSource(), tf = ctx.createBiquadFilter(), tg = ctx.createGain();
      tyre.buffer = this.noise; tyre.loop = true; tf.type = 'bandpass'; tf.Q.value = 2.5; tg.gain.value = 0;
      tyre.connect(tf).connect(tg).connect(this.master);
      const wh = ctx.createOscillator(), wg = ctx.createGain(); wh.type = 'sine'; wg.gain.value = 0; wh.connect(wg).connect(this.wet); wg.connect(this.master);
      for (const n of [o1, o2, tyre, wh]) n.start();
      this.eng = { o1, o2, lp, g, tf, tg, wh, wg };
    }
    const e = this.eng, gear = (speed01 * 4) % 1, f = 46 + 70 * speed01 + 38 * gear;
    e.o1.frequency.setTargetAtTime(f, t, 0.06); e.o2.frequency.setTargetAtTime(f * 0.502, t, 0.06);
    e.lp.frequency.setTargetAtTime(260 + 1500 * speed01 + 500 * Math.max(throttle, 0), t, 0.08);
    e.g.gain.setTargetAtTime(0.035 + 0.05 * Math.max(throttle, 0) + 0.03 * speed01, t, 0.1);
    e.tf.frequency.setTargetAtTime(900 + 900 * slip01, t, 0.05);
    e.tg.gain.setTargetAtTime(Math.min(0.22, slip01 * 0.3), t, 0.06);
    e.wh.frequency.setTargetAtTime(520 + 900 * speed01, t, 0.1);
    e.wg.gain.setTargetAtTime(boosting ? 0.035 : 0, t, 0.12);
  }
  crash(v01) { this.burst(0.35, 0.12 + 0.3 * v01, 500); this.tone(70, 0.3, 0.1 + 0.2 * v01, 'triangle'); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}
