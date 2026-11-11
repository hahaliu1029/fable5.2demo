// Renders the film of the polished game. Headless Chrome steps the real game (autopilot run, fixed 1/30 s steps)
// while scripted cameras replace the chase camera; each frame is screenshotted with its captions and piped to
// ffmpeg, then a soundtrack synthesised offline is muxed in.
//   node tools/promo.mjs [--lang=zh] [--stills]      -> promo/qingyun-promo[-zh].mp4
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'promo');
const W = 1920;
const H = 1080;
const FPS = 30;
const stills = process.argv.includes('--stills');
const lang = process.argv.find((a) => a.startsWith('--lang='))?.slice(7) ?? 'en';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(resolve(outDir, 'stills'), { recursive: true });

const meta = JSON.parse(readFileSync(resolve(root, 'assets/meta.json'), 'utf8'));
const tideMeta = JSON.parse(readFileSync(resolve(root, '../tidebell/assets/meta.json'), 'utf8'));
const excerpt = (file, marker, n) => {
  const lines = readFileSync(resolve(root, file), 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(marker));
  return lines.slice(i, i + n).map((l) => (l.length > 96 ? `${l.slice(0, 95)}…` : l));
};
const models = Object.keys(meta).length;
const allModels = models + Object.keys(tideMeta).length;
const TEXT = {
  en: {
    serif: '"Iowan Old Style", Palatino, Georgia, serif', sans: '"Avenir Next", system-ui, sans-serif', italic: 'italic', tagSpacing: '.3em',
    brief: 'the second brief', briefNote: '',
    inkTag: `an existing game, polished the same way<br>${models} new models scripted in Blender`, inkCap: 'It begins as ink. Then the colour arrives.',
    lakeTag: 'a true mirror on the lake · wake rings<br>spirit streams into the rider', lakeCap: 'Twenty wisps of spirit, scattered at dawn.',
    gateTag: 'sword light, robes and hair<br>all moving in the vertex shader',
    peaksTag: 'a ray-marched sea of clouds<br>ninety-six stone peaks', peaksCap: 'Above the sea of clouds.',
    craneTag: 'cranes · one model, twenty-eight birds',
    unlockCap: 'Gather them all, and the mountain answers.',
    dragonTag: 'the dragon · one straight model<br>bent along its flight path on the GPU', dragonCap: 'And something older comes down to see.',
    endA: 'Two requests. Two worlds.', endB: 'Tidebell · built from one sentence　｜　青云宗 · an existing game, polished',
    endC: `${allModels} models scripted in Blender · both films rendered from the games themselves · no downloaded assets`,
    endD: 'designed · modelled · coded · scored · filmed by',
  },
  zh: {
    serif: '"Songti SC", "STSong", "Noto Serif CJK SC", serif', sans: '"PingFang SC", "Hiragino Sans GB", system-ui, sans-serif', italic: 'normal', tagSpacing: '.16em',
    brief: '第二句需求', briefNote: '「完成之后，用同样的方法，把原来文件夹里的仙侠游戏也打磨一遍。」',
    inkTag: `一款已有的游戏，用同样的方法打磨<br>${models} 个新模型，由 Blender 脚本生成`, inkCap: '先是水墨，而后着色。',
    lakeTag: '湖面是真实的镜像 · 掠水生涟漪<br>灵气汇入御剑之人', lakeCap: '二十道灵气，散落在晨光里。',
    gateTag: '剑光、衣袂与发丝<br>皆在顶点着色器中飘动',
    peaksTag: '逐帧步进的体积云海<br>九十六座石峰', peaksCap: '云海之上。',
    craneTag: '仙鹤 · 一个模型，二十八只',
    unlockCap: '灵气既满，山门应声而开。',
    dragonTag: '青龙 · 一条笔直的模型<br>在 GPU 上沿飞行轨迹弯曲', dragonCap: '更古老的存在，也循光而来。',
    endA: '两句话，两个世界。', endB: '潮钟 · 由一句话生成　｜　青云宗 · 既有游戏的重新打磨',
    endC: `${allModels} 个模型由 Blender 脚本生成 · 两段影片均由游戏本身渲染 · 零下载素材`,
    endD: '设计 · 建模 · 编程 · 配乐 · 摄制',
  },
};
if (!TEXT[lang]) throw new Error(`unknown --lang=${lang}`);
const facts = {
  text: TEXT[lang],
  code: [
    { file: 'tools/blender/build_assets.py', lines: excerpt('tools/blender/build_assets.py', 'def build_dragon', 15) },
    { file: 'src/main.js', lines: excerpt('src/main.js', 'if (uInk > 0.001)', 14) },
  ],
};

// ---- runs inside the page -------------------------------------------------------------------------------
function installDirector(FPS, facts) {
  const g = window.__game;
  const G = g.G;
  const T = facts.text;
  const PROMPT = "Once that's done, use the same approach to polish the xianxia-style game in the original game folder.";
  const mono = '"SF Mono", Menlo, Consolas, monospace';
  const style = document.createElement('style');
  style.textContent = `body.film #hud, body.film #marker, body.film #toast, body.film #title, body.film #done, body.film #touch, body.film .opts, body.film #fps { display: none !important; }
    #title, #done { display: none !important; }
    .pl { position: fixed; pointer-events: none; color: #f6efe0; opacity: 0; z-index: 50; }
    #pCap { left: 0; right: 0; bottom: 10.5vh; text-align: center; font-family: ${T.serif}; font-style: ${T.italic}; font-size: 46px; text-shadow: 0 0 30px rgba(20,10,0,.95), 0 0 6px rgba(0,0,0,.85); }
    #pTag { left: 64px; top: 56px; font-family: ${T.sans}; font-size: 17px; letter-spacing: ${T.tagSpacing}; text-transform: uppercase; padding-left: 18px; border-left: 2px solid #f2c25a;
      line-height: 1.7; text-shadow: 0 0 10px rgba(0,0,0,.9), 0 1px 2px rgba(0,0,0,.9); background: linear-gradient(90deg, rgba(8,10,14,.55), rgba(8,10,14,0)); padding: 10px 60px 10px 18px; }
    #pFade { inset: 0; background: #01060a; }
    #pPrompt { inset: 0; background: #01060a; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    #pPrompt .line { font-family: ${mono}; font-size: 34px; max-width: 1500px; line-height: 1.6; text-align: left; color: #f3ead6; }
    #pPrompt .line b { color: #f2c25a; font-weight: 400; margin-right: 18px; }
    #pPrompt .caret { display: inline-block; width: 16px; height: 36px; background: #f2c25a; vertical-align: -6px; margin-left: 4px; }
    #pPrompt .sub { font-family: ${T.sans}; letter-spacing: ${T.tagSpacing}; text-transform: uppercase; font-size: 16px; margin-top: 54px; color: #a89a7c; text-align: center; }
    #pPrompt .sub em { display: block; font-style: normal; font-family: ${T.serif}; font-size: 30px; letter-spacing: .06em; color: #f3ead6; margin-bottom: 22px; text-transform: none; }
    #pCode { left: 64px; top: 150px; width: 900px; font-family: ${mono}; font-size: 17px; line-height: 1.5; white-space: pre; color: #f6efe0; text-shadow: 0 0 8px rgba(0,0,0,.95), 0 1px 2px rgba(0,0,0,.95); background: rgba(8,10,14,.42); padding: 16px 22px; border-radius: 6px; }
    #pCode .f { color: #f2c25a; letter-spacing: .12em; margin-bottom: 10px; font-size: 14px; }
    #pEnd { inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(4,8,14,.5), rgba(2,5,10,.93)); }
    #pEnd .d { font-family: ${T.sans}; letter-spacing: ${T.tagSpacing}; text-transform: uppercase; font-size: 19px; color: #f2c25a; }
    #pEnd h1 { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-weight: 400; font-size: 150px; letter-spacing: .14em; margin: 22px 0 0 .14em;
      text-shadow: 0 0 60px rgba(242,194,90,.45); }
    #pEnd .a { font-family: ${T.serif}; font-style: ${T.italic}; font-size: 42px; margin-top: 30px; }
    #pEnd .b { font-family: ${T.sans}; letter-spacing: .12em; font-size: 20px; margin-top: 54px; color: #9fe9d8; }
    #pEnd .c { font-family: ${T.sans}; letter-spacing: ${T.tagSpacing}; text-transform: uppercase; font-size: 14px; margin-top: 20px; opacity: .6; }`;
  document.head.appendChild(style);
  const mk = (id, html = '') => {
    const d = document.createElement('div');
    d.id = id;
    d.className = 'pl';
    d.innerHTML = html;
    document.body.appendChild(d);
    return d;
  };
  const cap = mk('pCap');
  const tag = mk('pTag');
  const codeEl = mk('pCode');
  const fadeEl = mk('pFade');
  const promptEl = mk('pPrompt', '<div class="line"><b>&gt;</b><span></span><span class="caret"></span></div><div class="sub"></div>');
  promptEl.querySelector('.sub').innerHTML = `${T.briefNote ? `<em>${T.briefNote}</em>` : ''}${T.brief}`;
  const endEl = mk('pEnd', `<div class="d">${T.endD}</div><h1>CLAUDE FABLE 5.2</h1><div class="a">${T.endA}</div><div class="b">${T.endB}</div><div class="c">${T.endC}</div>`);
  document.body.classList.add('film');

  const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const DT = 1 / FPS;
  let startT = 0; // G.t when the run began
  const tau = () => G.t - startT;
  const skipTo = (target) => {
    g.cine = null;
    while (tau() < target - 1e-6) g.step(DT, false);
  };
  const fwd = () => [-Math.sin(G.yaw), 0, -Math.cos(G.yaw)];
  const floorCam = (p, clear = 1.2) => [p[0], Math.max(p[1], g.groundH(p[0], p[2]) + clear), p[2]];
  const typed = (lines, n) => {
    let out = '';
    for (const l of lines) {
      if (n <= 0) break;
      out += `${l.slice(0, n)}\n`;
      n -= l.length + 1;
    }
    return out;
  };
  // A smoothed copy of the rider's position and heading, so tracking cameras glide.
  const sm = { p: [0, 0, 0], f: [0, 0, -1], ok: false };
  const track = () => {
    const f = fwd();
    if (!sm.ok) {
      sm.p = [G.pos.x, G.pos.y, G.pos.z];
      sm.f = f;
      sm.ok = true;
    }
    const k = 0.12;
    sm.p = [sm.p[0] + (G.pos.x - sm.p[0]) * 0.35, sm.p[1] + (G.pos.y - sm.p[1]) * 0.35, sm.p[2] + (G.pos.z - sm.p[2]) * 0.35];
    const fx = sm.f[0] + (f[0] - sm.f[0]) * k;
    const fz = sm.f[2] + (f[2] - sm.f[2]) * k;
    const l = Math.hypot(fx, fz) || 1;
    sm.f = [fx / l, 0, fz / l];
    return { p: sm.p, f: sm.f, r: [-sm.f[2], 0, sm.f[0]] };
  };

  const shots = [
    { // 0. The second brief, typed on black.
      name: 'prompt', dur: 6.4, dom: true,
      init() {
        promptEl.style.opacity = 1;
      },
      tick(t) {
        const n = Math.floor(ss(0.7, 4.3, t) ** 0.9 * PROMPT.length + (t > 0.7 ? 0.5 : 0));
        promptEl.querySelector('span').textContent = PROMPT.slice(0, Math.max(0, n));
        promptEl.querySelector('.caret').style.opacity = n >= PROMPT.length ? ((t * 2.2) % 1 < 0.55 ? 1 : 0) : 1;
        promptEl.querySelector('.sub').style.opacity = ss(4.7, 5.4, t);
        promptEl.style.opacity = ss(6.4, 5.8, t);
      },
    },
    { // 1. The world as an ink painting; then the flight begins and colour floods out from the centre.
      name: 'ink', dur: 8.6, tag: T.inkTag,
      init() {
        promptEl.style.opacity = 0;
      },
      tick(t) {
        if (t >= 4.8 && !this.started) {
          this.started = true;
          g.startGame();
          document.exitPointerLock?.();
          startT = G.t;
        }
        const which = t < 2.5 ? 0 : 1;
        const c = facts.code[which];
        codeEl.innerHTML = '';
        const f = document.createElement('div');
        f.className = 'f';
        f.textContent = c.file;
        codeEl.append(f, document.createTextNode(typed(c.lines, Math.floor(Math.max(0, which ? t - 2.6 : t - 0.3) * 380))));
        codeEl.style.opacity = ss(0.2, 0.6, t) * ss(5.2, 4.6, t);
        cap.textContent = t > 5 ? T.inkCap : '';
        cap.style.opacity = ss(6.0, 6.9, t) * ss(8.6, 8.0, t);
      },
      exit() {
        codeEl.style.opacity = 0;
      },
    },
    { // 2. Skimming the lake, seen from the side.
      name: 'lake', dur: 5, tag: T.lakeTag, caption: T.lakeCap,
      init() {
        skipTo(3.4);
        sm.ok = false;
      },
      tick(t, u) {
        const k = track();
        const side = 8 - 2.5 * u;
        g.cine = { pos: floorCam([k.p[0] + k.r[0] * side + k.f[0] * (5 - 3 * u), k.p[1] + 0.2 + u, k.p[2] + k.r[2] * side + k.f[2] * (5 - 3 * u)], 0.5), look: [k.p[0] + k.f[0] * 1.5, k.p[1] + 1.1, k.p[2] + k.f[2] * 1.5] };
      },
    },
    { // 3. Over the gate, close on the rider from behind and to one side (clear of the orbs ahead).
      name: 'gate', dur: 4.2, tag: T.gateTag,
      init() {
        skipTo(13.0);
        sm.ok = false;
      },
      tick(t, u) {
        const k = track();
        g.cine = { pos: floorCam([k.p[0] - k.f[0] * (5.5 - 1.5 * u) + k.r[0] * (5.5 - u), k.p[1] + 0.9 + 0.5 * u, k.p[2] - k.f[2] * (5.5 - 1.5 * u) + k.r[2] * (5.5 - u)]), look: [k.p[0] + k.f[0] * 2.5, k.p[1] + 1.2, k.p[2] + k.f[2] * 2.5] };
      },
    },
    { // 4. Out among the peaks, above the cloud sea.
      name: 'peaks', dur: 6, tag: T.peaksTag, caption: T.peaksCap,
      init() {
        skipTo(24.4);
        sm.ok = false;
      },
      tick(t, u) {
        const k = track();
        const back = 11 - 3 * u;
        g.cine = { pos: [k.p[0] - k.f[0] * back + k.r[0] * (6 - 3 * u), k.p[1] + 3.6 - 1.2 * u, k.p[2] - k.f[2] * back + k.r[2] * (9 - 4 * u)], look: [k.p[0] + k.f[0] * 6, k.p[1] + 1, k.p[2] + k.f[2] * 6] };
      },
    },
    { // 5. Cranes in formation over the lake.
      name: 'cranes', dur: 4.2, tag: T.craneTag,
      init() {
        skipTo(32.6);
      },
      tick(t, u) {
        const a = G.t * 0.125;
        const lead = [12 + Math.cos(a) * 92, 36 + Math.sin(G.t * 0.7) * 0.6, 32 + Math.sin(a) * 92];
        const tang = [-Math.sin(a), 0, Math.cos(a)];
        const rad = [Math.cos(a), 0, Math.sin(a)];
        g.cine = { pos: [lead[0] + tang[0] * (12 - 3 * u) - rad[0] * 6, lead[1] + 2.0 - u, lead[2] + tang[2] * (12 - 3 * u) - rad[2] * 6], look: [lead[0] - tang[0] * 5, lead[1] + 0.6, lead[2] - tang[2] * 5] };
      },
    },
    { // 6. The last orb: the plaque lights, a pillar of light rises and a golden wave crosses the land.
      name: 'unlock', dur: 5.2, caption: T.unlockCap,
      init() {
        skipTo(46.9);
      },
      tick(t, u) {
        g.cine = { pos: [-16 + 6 * u, 7.5 + 4 * u, 86 + 6 * u], look: [0, 15 + 10 * u, 0] };
      },
    },
    { // 7. Home through the gate.
      name: 'through', dur: 3.5,
      init() {
        skipTo(53.0);
        sm.ok = false;
      },
      tick(t, u) {
        const k = track();
        g.cine = { pos: floorCam([k.p[0] - k.f[0] * 8.5 + k.r[0] * 1.2, k.p[1] + 2.0, k.p[2] - k.f[2] * 8.5 + k.r[2] * 1.2]), look: [k.p[0] + k.f[0] * 6, k.p[1] + 1.6, k.p[2] + k.f[2] * 6] };
      },
    },
    { // 8. The dragon comes down to coil over the lit gate; the end card rises over it.
      name: 'dragon', dur: 15.5, tag: T.dragonTag, caption: T.dragonCap,
      init() {},
      tick(t, u) {
        const h = g.dragonHead();
        const a = 0.5 + t * 0.045;
        const pos = [Math.sin(a) * 22, 13 + 4 * Math.sin(t * 0.2), 60 + Math.cos(a) * 24];
        const w = 0.8;
        g.cine = { pos: floorCam(pos, 1.5), look: [h[0] * w, 16 * (1 - w) + h[1] * w, h[2] * w] };
      },
    },
  ];
  const END = 8.5; // end card, laid over the last shot
  const starts = [];
  let total = 0;
  for (const s of shots) {
    starts.push(total);
    total += s.dur;
  }
  let current = -1;

  window.__promo = {
    total, starts, names: shots.map((s) => s.name), promptLen: PROMPT.length,
    frame(i) {
      const Tm = i / FPS;
      let k = shots.length - 1;
      while (k > 0 && Tm < starts[k]) k--;
      const shot = shots[k];
      if (k !== current) {
        if (current >= 0) shots[current].exit?.();
        current = k;
        shot.init();
        cap.textContent = shot.caption ?? '';
        tag.innerHTML = shot.tag ?? '';
      }
      const t = Tm - starts[k];
      const last = k === shots.length - 1;
      const capEnd = last ? shot.dur - END : shot.dur;
      if (shot.caption) cap.style.opacity = ss(0.8, 1.7, t) * ss(capEnd - 0.3, capEnd - 1.1, t);
      else if (shot.name !== 'ink') cap.style.opacity = 0;
      tag.style.opacity = shot.tag ? ss(0.5, 1.2, t) * ss(capEnd - 0.3, capEnd - 0.9, t) * 0.95 : 0;
      shot.tick(t, t / shot.dur);
      if (!shot.dom) g.step(DT);
      const edge = 0.24;
      const fin = k > 0 ? ss(edge, 0, t) : 0;
      const fout = !last ? ss(shot.dur - edge, shot.dur, t) : ss(total - 0.9, total, Tm);
      fadeEl.style.opacity = Math.max(fin, k === 0 ? 0 : fout);
      endEl.style.opacity = ss(total - END, total - END + 1.8, Tm);
    },
  };
  return { total, starts, names: window.__promo.names, promptLen: PROMPT.length };
}

// Offline soundtrack: plucked strings on a D pentatonic, a breathy flute line, drums on the cuts, a gong for the gate.
async function renderScore(total, starts, names, promptLen) {
  const at = (name) => starts[names.indexOf(name)];
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.9, 0);
  master.gain.setValueAtTime(0.9, total - 2.4);
  master.gain.exponentialRampToValueAtTime(0.0001, total);
  master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
  const len = sr * 4;
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.6 - 0.45 * t);
      d[i] = lp * (1 - t) ** 3;
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  wet.connect(conv).connect(master);
  const white = ctx.createBuffer(1, sr * 2, sr);
  const wd = white.getChannelData(0);
  for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
  const out = (node, pan = 0, dry = 0.5) => {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    const d = ctx.createGain();
    d.gain.value = dry;
    p.connect(d).connect(master);
    p.connect(wet);
  };
  const noise = (when, dur, f0, f1, gain, q = 1.2) => {
    const s = ctx.createBufferSource();
    s.buffer = white;
    s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, when);
    bp.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, when);
    gn.gain.exponentialRampToValueAtTime(gain, when + dur * 0.6);
    gn.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(bp).connect(gn);
    out(gn, 0, 0.7);
    s.start(when);
    s.stop(when + dur + 0.05);
  };
  // Plucked string (guzheng-like): bright attack through a closing low-pass, with a small downward bend.
  const pluck = (f, when, gain = 0.2, pan = 0) => {
    if (when < 0 || when >= total) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 1.012, when);
    o.frequency.exponentialRampToValueAtTime(f, when + 0.09);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2.003;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(9000, f * 9), when);
    lp.frequency.exponentialRampToValueAtTime(f * 1.3, when + 0.9);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, when);
    gn.gain.exponentialRampToValueAtTime(gain, when + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, when + 2.2);
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(gn);
    out(gn, pan, 0.6);
    for (const x of [o, o2]) {
      x.start(when);
      x.stop(when + 2.3);
    }
  };
  // Bamboo flute: a sine with breath noise and delayed vibrato.
  const flute = (f, when, dur, gain = 0.1) => {
    if (when >= total) return;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 0.97, when);
    o.frequency.exponentialRampToValueAtTime(f, when + 0.12);
    const v = ctx.createOscillator();
    v.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, when);
    vg.gain.linearRampToValueAtTime(f * 0.012, when + Math.min(dur, 0.8));
    v.connect(vg).connect(o.frequency);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, when);
    gn.gain.exponentialRampToValueAtTime(gain, when + 0.09);
    gn.gain.setValueAtTime(gain, when + dur * 0.7);
    gn.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(gn);
    const o3 = ctx.createOscillator();
    o3.frequency.value = f * 3;
    const g3 = ctx.createGain();
    g3.gain.value = 0.12;
    o3.connect(g3).connect(gn);
    out(gn, 0.15, 0.45);
    for (const x of [o, v, o3]) {
      x.start(when);
      x.stop(when + dur + 0.05);
    }
    noise(when, Math.min(dur, 0.5), f * 2, f * 2.2, gain * 0.25, 6);
  };
  const drum = (when, gain = 0.5) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.25);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(gain, when);
    gn.gain.exponentialRampToValueAtTime(0.0001, when + 1.2);
    o.connect(gn);
    out(gn, 0, 0.9);
    o.start(when);
    o.stop(when + 1.3);
    noise(when, 0.18, 900, 200, gain * 0.25, 0.8);
  };
  const gong = (when, gain = 0.3) => {
    for (const [m, gk, d] of [[1, 1, 9], [1.48, 0.6, 7], [2.09, 0.45, 6], [2.67, 0.3, 4.5], [3.92, 0.18, 3], [0.5, 0.7, 10]]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(98 * m * 1.01, when);
      o.frequency.exponentialRampToValueAtTime(98 * m, when + 1.5);
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, when);
      gn.gain.exponentialRampToValueAtTime(gain * gk, when + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.0001, when + d);
      o.connect(gn);
      out(gn, 0, 0.5);
      o.start(when);
      o.stop(when + d + 0.1);
    }
  };
  const D = [146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 369.99, 440.0, 493.88, 587.33];

  // Keystrokes for the typed brief.
  const ss = (a, c, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (c - a)));
    return t * t * (3 - 2 * t);
  };
  let lastN = 0;
  for (let t = 0; t < 4.5; t += 1 / 120) {
    const n = Math.floor(ss(0.7, 4.3, t) ** 0.9 * promptLen);
    if (n > lastN) {
      lastN = n;
      noise(t, 0.035, 2600 + Math.random() * 1400, 1400, 0.05, 3);
    }
  }
  // Ink: sparse single plucks and a low drone, like a brush being loaded.
  const ink = at('ink');
  const bloom = ink + 4.8;
  for (const [dt, k] of [[0.4, 5], [1.7, 3], [2.8, 6], [3.9, 4]]) pluck(D[k], ink + dt, 0.16, (k % 3 - 1) * 0.4);
  const dr = ctx.createOscillator();
  dr.type = 'triangle';
  dr.frequency.value = 73.42;
  const dg = ctx.createGain();
  dg.gain.setValueAtTime(0.0001, ink);
  dg.gain.exponentialRampToValueAtTime(0.09, ink + 3);
  dg.gain.setValueAtTime(0.09, total - 6);
  dg.gain.exponentialRampToValueAtTime(0.0001, total);
  dr.connect(dg);
  out(dg, 0, 0.8);
  dr.start(ink);
  // The colour arrives: a sweep, a drum, a rising run across the strings.
  noise(bloom - 0.3, 3.2, 200, 4200, 0.16, 0.8);
  drum(bloom, 0.6);
  for (let k = 0; k < 11; k++) pluck(D[k], bloom + k * 0.07, 0.16, -0.6 + k * 0.12);
  // Flight: a running string figure at 132 bpm, with the flute over it; drums on the cuts.
  const step = 60 / 132 / 2;
  const fig = [5, 7, 8, 7, 5, 4, 5, 7, 8, 10, 8, 7, 5, 7, 4, 3];
  const flight0 = bloom + 1.1;
  const flight1 = at('unlock') + 1.2;
  let n = 0;
  for (let t = flight0; t < flight1; t += step, n++) {
    if (t > at('cranes') - 0.3 && t < at('cranes') + 3.6 && n % 2) continue; // thin out under the cranes
    pluck(D[fig[n % fig.length]], t, n % 4 === 0 ? 0.17 : 0.11, Math.sin(n * 0.9) * 0.5);
    if (n % 8 === 0) pluck(D[fig[n % fig.length] - 5 < 0 ? 0 : fig[n % fig.length] - 5], t, 0.16, 0);
  }
  const mel = [[0, 8, 1.6], [1.8, 7, 0.8], [2.7, 5, 1.8], [4.9, 8, 0.9], [5.9, 10, 2.2], [8.6, 9, 0.8], [9.5, 8, 0.8], [10.4, 7, 2.4],
    [13.4, 5, 1.4], [14.9, 7, 1.4], [16.4, 8, 2.6], [19.6, 10, 1.0], [20.7, 9, 1.0], [21.8, 8, 2.8]];
  for (const [dt, k, d] of mel) if (at('lake') + dt < flight1) flute(D[k] * 2, at('lake') + dt, d, 0.085);
  names.forEach((name, i) => {
    if (i >= 2) drum(starts[i] + 0.05, name === 'cranes' ? 0.25 : 0.5);
  });
  // The gate: gong, a swell, then a slow, wide theme while the dragon comes down.
  const unlock = at('unlock') + 1.35;
  gong(unlock, 0.34);
  noise(unlock, 4.5, 150, 3200, 0.14, 0.7);
  const dragon = at('dragon');
  for (const [dt, k, d] of [[0.3, 5, 2.6], [3.0, 7, 1.2], [4.3, 8, 3.0], [7.6, 10, 3.6]]) flute(D[k], dragon + dt, d, 0.12);
  for (let t = dragon; t < total - 6; t += step * 4) {
    drum(t, 0.3);
    for (const k of [0, 3, 5]) pluck(D[k], t + 0.02 * k, 0.12, (k - 3) * 0.2);
  }
  gong(total - 8.3, 0.22);
  for (const k of [0, 3, 5, 8]) pluck(D[k], total - 6.4 + k * 0.05, 0.14, (k - 4) * 0.15);

  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const pcm = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    pcm[i * 2] = Math.max(-1, Math.min(1, L[i])) * 32767;
    pcm[i * 2 + 1] = Math.max(-1, Math.min(1, R[i])) * 32767;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function wav(pcm, sr = 44100) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ---- node side ------------------------------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', `--window-size=${W},${H}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${pathToFileURL(resolve(root, 'index.html')).href}?capture&bot&ss=1&q=high`);
  await page.waitForFunction('window.__ready', { timeout: 60000 });
  await page.evaluate((dt) => {
    for (let i = 0; i < 120; i++) window.__game.step(dt, false); // let the title scene settle
  }, 1 / FPS);
  const { total, starts, names, promptLen } = await page.evaluate(installDirector, FPS, facts);
  const frames = Math.round(total * FPS);
  console.log(`film: ${total.toFixed(1)} s, ${frames} frames`);
  console.log(names.map((n, i) => `${n}@${starts[i].toFixed(1)}`).join('  '));
  const tagName = lang === 'en' ? '' : `${lang}-`;

  if (stills) {
    for (let k = 0; k < starts.length; k++) {
      const first = Math.round(starts[k] * FPS);
      const end = Math.round((k + 1 < starts.length ? starts[k + 1] : total) * FPS) - 1;
      const picks = names[k] === 'ink' ? [0.35, 0.72] : names[k] === 'dragon' ? [0.2, 0.42, 0.9] : names[k] === 'unlock' ? [0.5, 0.85] : [0.6];
      let i = first;
      for (const [j, p] of picks.entries()) {
        const target = Math.min(end, first + Math.round((end - first) * p));
        for (; i <= target; i++) await page.evaluate((n) => window.__promo.frame(n), i); // every frame: the run must stay in step
        writeFileSync(resolve(outDir, 'stills', `${tagName}${String(k).padStart(2, '0')}-${names[k]}${j ? `-${j}` : ''}.jpg`), await page.screenshot({ type: 'jpeg', quality: 90 }));
      }
      for (; i <= end; i++) await page.evaluate((n) => window.__promo.frame(n), i);
      console.log(`still ${names[k]}`);
    }
  } else {
    const silent = resolve(outDir, `video-only-${lang}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
    const ffExit = once(ff, 'close');
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      await page.evaluate((n) => window.__promo.frame(n), i);
      const img = await page.screenshot({ type: 'jpeg', quality: 96, optimizeForSpeed: true });
      if (ff.exitCode !== null) throw new Error(`ffmpeg exited early with ${ff.exitCode}`);
      if (!ff.stdin.write(img)) await once(ff.stdin, 'drain');
      if (i % 300 === 0) console.log(`frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    const [code] = await ffExit;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    const b64 = await page.evaluate(renderScore, total, starts, names, promptLen);
    const wavPath = resolve(outDir, 'score.wav');
    writeFileSync(wavPath, wav(Buffer.from(b64, 'base64')));
    const out = resolve(outDir, `qingyun-promo${lang === 'en' ? '' : `-${lang}`}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wavPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
    rmSync(silent);
    console.log(`wrote ${out}`);
  }
} finally {
  await browser.close();
}
