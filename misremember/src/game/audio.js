// All sound is synthesised: room tone, a drone, things that hum and tick in the rooms, footsteps and doors.
// Closing your eyes turns the room down and the things in it up, so they can be walked towards.
export function createAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = 0.0;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = (loop = true) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = loop; return s; };

  // room tone + drone
  const tone = ctx.createGain(); tone.gain.value = 0.05;
  const toneLp = ctx.createBiquadFilter(); toneLp.type = 'lowpass'; toneLp.frequency.value = 260;
  const n0 = noise(); n0.connect(toneLp).connect(tone).connect(master); n0.start();
  const drone = ctx.createGain(); drone.gain.value = 0.016; drone.connect(master);
  for (const [f, d] of [[55, 0], [82.4, 3], [110.3, -4], [164.2, 5]]) {
    const o = ctx.createOscillator(); o.frequency.value = f; o.detune.value = d;
    const g = ctx.createGain(); g.gain.value = 0.5;
    const l = ctx.createOscillator(); l.frequency.value = 0.03 + Math.random() * 0.05;
    const lg = ctx.createGain(); lg.gain.value = 0.45;
    l.connect(lg).connect(g.gain); o.connect(g).connect(drone); o.start(); l.start();
  }

  // positional emitters
  const emitters = {};
  const addEmitter = (id, room, pos, level, build) => {
    const out = ctx.createGain(); out.gain.value = 0;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 0.8; pan.rolloffFactor = 1.5;
    out.connect(pan).connect(master);
    emitters[id] = { id, room, pos, level, out, pan, next: 0, on: true };
    if (build) build(out);
    return emitters[id];
  };
  const tick = (em, t, freq, dur = 0.012, gain = 1) => {
    const s = noise(false);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur * 4);
    s.connect(bp).connect(g).connect(em.out); s.start(t, Math.random(), dur * 5);
  };

  const oneShot = (build, level = 1) => { const g = ctx.createGain(); g.gain.value = level; g.connect(master); build(g, ctx.currentTime); };
  const bell = (freqs, level, attack, decay) => oneShot((out, t) => {
    for (const f of freqs) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1 / freqs.length, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      o.connect(g).connect(out); o.start(t); o.stop(t + attack + decay + 0.1);
    }
  }, level);

  const STEP = { oak: [900, 0.9, 0.05], lino: [1700, 0.7, 0.03], carpet: [320, 0.5, 0.07], unbuilt: [2600, 0.35, 0.02] };

  return {
    ctx, emitters, addEmitter, tick,
    start() { ctx.resume(); master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 3); },
    fade(to, secs) { master.gain.linearRampToValueAtTime(to, ctx.currentTime + secs); },
    step(floor) {
      const [f, level, dur] = STEP[floor] ?? STEP.oak;
      oneShot((out, t) => {
        const s = noise(false);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f * (0.85 + Math.random() * 0.3);
        const g = ctx.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur * 3);
        s.connect(lp).connect(g).connect(out); s.start(t, Math.random(), dur * 4);
        const o = ctx.createOscillator(); o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
        const og = ctx.createGain(); og.gain.setValueAtTime(level * 0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        o.connect(og).connect(out); o.start(t); o.stop(t + 0.12);
      }, 0.16);
    },
    creak() {
      oneShot((out, t) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(180, t); o.frequency.linearRampToValueAtTime(260, t + 0.35); o.frequency.linearRampToValueAtTime(150, t + 0.8);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 9;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 0.85);
        const trem = ctx.createOscillator(); trem.frequency.value = 23; const tg = ctx.createGain(); tg.gain.value = 0.4; trem.connect(tg).connect(g.gain);
        o.connect(bp).connect(g).connect(out); o.start(t); o.stop(t + 0.9); trem.start(t); trem.stop(t + 0.9);
      }, 0.12);
      this.latch(0.5);
    },
    latch(level = 0.6) {
      oneShot((out, t) => {
        for (const [dt, f] of [[0, 1900], [0.045, 1200]]) {
          const s = noise(false); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 4;
          const g = ctx.createGain(); g.gain.setValueAtTime(1, t + dt); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.05);
          s.connect(bp).connect(g).connect(out); s.start(t + dt, Math.random(), 0.08);
        }
      }, 0.25 * level);
    },
    rattle() { this.latch(1); setTimeout(() => this.latch(0.8), 130); setTimeout(() => this.latch(0.9), 250); },
    // something changed somewhere you were not looking
    cue() { bell([1244.5, 1661.2, 2217.5], 0.035, 0.9, 0.5); },
    settle() { bell([261.6, 329.6, 392.0, 523.3], 0.12, 0.05, 3.5); },
    pickup() { bell([880, 1318.5], 0.07, 0.01, 1.2); },
    // listener: { pos: [x,y,z] three coords, fwd, up }; place(em) -> three position or null when out of earshot
    update(listener, place, eyesClosed) {
      const t = ctx.currentTime;
      const L = ctx.listener;
      if (L.positionX) {
        L.positionX.value = listener.pos[0]; L.positionY.value = listener.pos[1]; L.positionZ.value = listener.pos[2];
        L.forwardX.value = listener.fwd[0]; L.forwardY.value = listener.fwd[1]; L.forwardZ.value = listener.fwd[2];
        L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
      } else { L.setPosition(...listener.pos); L.setOrientation(...listener.fwd, 0, 1, 0); }
      tone.gain.setTargetAtTime(eyesClosed ? 0.02 : 0.05, t, 0.15);
      drone.gain.setTargetAtTime(eyesClosed ? 0.006 : 0.016, t, 0.3);
      for (const em of Object.values(emitters)) {
        const p = em.on ? place(em) : null;
        const g = p ? em.level * p.gain * (eyesClosed ? 2.6 : 1) : 0;
        em.out.gain.setTargetAtTime(g, t, 0.12);
        if (p) { if (em.pan.positionX) { em.pan.positionX.value = p.pos.x; em.pan.positionY.value = p.pos.y; em.pan.positionZ.value = p.pos.z; } else em.pan.setPosition(p.pos.x, p.pos.y, p.pos.z); }
        if (em.rate) {
          if (em.next < t) em.next = t;
          while (em.next < t + 0.25) { tick(em, em.next, em.freq * (em.beat++ % 2 ? 1 : 0.86), em.dur, 1); em.next += em.rate; }
        }
      }
    },
    hum(out) {
      for (const [f, a] of [[50, 0.5], [100, 0.35], [150, 0.1], [201, 0.06]]) { const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = a; o.connect(g).connect(out); o.start(); }
      const n = noise(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.2; const g = ctx.createGain(); g.gain.value = 0.12; n.connect(bp).connect(g).connect(out); n.start();
    },
  };
}
