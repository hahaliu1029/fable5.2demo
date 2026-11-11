// Procedural audio: no samples. Everything is synthesised with the Web Audio API.

const PENTA = [220.0, 261.63, 293.66, 349.23, 392.0, 440.0, 523.25];

export function createAudio() {
  let ctx = null;
  let master = null;
  let wet = null;
  let drone = null;
  let engine = null;
  let muted = false;

  function impulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.42 * t);
        d[i] = lp * (1 - t) ** 2.6;
      }
    }
    return buf;
  }

  function noiseBuffer() {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = b * 3.5;
    }
    return buf;
  }

  function start() {
    if (ctx) {
      ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(5.5);
    wet = ctx.createGain();
    wet.gain.value = 0.55;
    wet.connect(conv).connect(master);

    // Water bed: brown noise through a slow-moving low-pass.
    const nb = noiseBuffer();
    const src = ctx.createBufferSource();
    src.buffer = nb;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const bed = ctx.createGain();
    bed.gain.value = 0.5;
    src.connect(lp).connect(bed).connect(master);
    src.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 120;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();

    // Depth drone: two detuned voices that sink in pitch as the player descends.
    const dg = ctx.createGain();
    dg.gain.value = 0.0;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 500;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const o3 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'sawtooth';
    o3.type = 'sine';
    for (const o of [o1, o2, o3]) {
      o.connect(dlp);
      o.start();
    }
    dlp.connect(dg);
    dg.connect(master);
    dg.connect(wet);
    drone = { o1, o2, o3, gain: dg, lp: dlp };

    // Thruster hum.
    const es = ctx.createBufferSource();
    es.buffer = nb;
    es.loop = true;
    const ebp = ctx.createBiquadFilter();
    ebp.type = 'bandpass';
    ebp.frequency.value = 140;
    ebp.Q.value = 1.2;
    const eg = ctx.createGain();
    eg.gain.value = 0;
    es.connect(ebp).connect(eg).connect(master);
    es.start();
    engine = { gain: eg, bp: ebp };
  }

  function tone(freq, { type = 'sine', attack = 0.01, decay = 2, gain = 0.2, when = 0, slide = 0, vibrato = 0, dry = 0.4 } = {}) {
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + decay);
    if (vibrato) {
      const v = ctx.createOscillator();
      v.frequency.value = 4.5;
      const vg = ctx.createGain();
      vg.gain.value = freq * vibrato;
      v.connect(vg).connect(o.frequency);
      v.start(t0);
      v.stop(t0 + decay + 0.1);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    o.connect(g);
    const d = ctx.createGain();
    d.gain.value = dry;
    g.connect(d).connect(master);
    g.connect(wet);
    o.start(t0);
    o.stop(t0 + decay + 0.1);
  }

  return {
    start,
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
      return muted;
    },
    // Called every frame with the player's situation.
    update({ depth, thrust, boost, pressure }) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const k = Math.min(1, depth / 200);
      const base = 82 - 38 * k;
      drone.o1.frequency.setTargetAtTime(base, t, 0.8);
      drone.o2.frequency.setTargetAtTime(base * 1.503, t, 0.8);
      drone.o3.frequency.setTargetAtTime(base * 0.5, t, 0.8);
      drone.gain.gain.setTargetAtTime(0.02 + 0.07 * k + pressure * 0.1, t, 0.6);
      drone.lp.frequency.setTargetAtTime(520 - 300 * k + pressure * 600, t, 0.6);
      engine.gain.gain.setTargetAtTime(thrust ? (boost ? 0.5 : 0.28) : 0.03, t, 0.15);
      engine.bp.frequency.setTargetAtTime(boost ? 230 : 140, t, 0.2);
    },
    bell(index, count) {
      // A struck bell: inharmonic partials over a pentatonic fundamental, then the chord so far.
      const f = PENTA[index % PENTA.length];
      [[1, 0.3, 7], [2.01, 0.16, 5], [2.76, 0.12, 4], [5.4, 0.06, 2.5], [0.5, 0.2, 8]].forEach(([m, g, d]) => tone(f * m, { gain: g, decay: d, attack: 0.005 }));
      for (let i = 0; i < count; i++) tone(PENTA[i] * 0.5, { gain: 0.07, decay: 6, attack: 1.2, when: 1.2 + i * 0.18, type: 'triangle' });
    },
    sonar() {
      tone(1180, { gain: 0.16, decay: 1.4, attack: 0.004, slide: 0.96 });
      tone(1180, { gain: 0.05, decay: 1.6, attack: 0.004, when: 0.5, slide: 0.94, dry: 0.1 });
    },
    log() {
      tone(660, { gain: 0.06, decay: 0.5, type: 'triangle' });
      tone(990, { gain: 0.05, decay: 0.7, when: 0.09, type: 'triangle' });
    },
    creak() {
      tone(58, { type: 'sawtooth', gain: 0.12, decay: 0.9, slide: 0.7, attack: 0.05 });
      tone(173, { type: 'square', gain: 0.02, decay: 0.3, slide: 1.3, when: 0.1 });
    },
    lamp() {
      tone(240, { type: 'square', gain: 0.03, decay: 0.08, dry: 1 });
    },
    whaleSong() {
      // Long gliding calls with vibrato, answering one another.
      const calls = [[196, 1.5, 0], [147, 0.75, 4.5], [262, 1.33, 9], [131, 1.5, 14], [220, 0.67, 20], [175, 1.26, 26], [98, 2.0, 32]];
      for (const [f, slide, when] of calls) {
        tone(f, { gain: 0.16, decay: 4.2, attack: 0.9, slide, vibrato: 0.012, when, dry: 0.15 });
        tone(f * 2.01, { gain: 0.03, decay: 3.6, attack: 1.2, slide, vibrato: 0.015, when, dry: 0.05 });
      }
    },
  };
}
