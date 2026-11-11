// Renders the driving film from the real game: headless Chrome steps it frame by frame under scripted cameras,
// each frame is screenshotted with its captions and piped to ffmpeg, then a synthesised score is muxed in.
//   node tools/promo.mjs [--lang=zh]   -> promo/mothlight-promo[-zh].mp4   (its end card closes the combined promo)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'promo');
const FPS = 30;
const lang = process.argv.find((a) => a.startsWith('--lang='))?.slice(7) ?? 'en';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(outDir, { recursive: true });
const count = (p) => Object.keys(JSON.parse(readFileSync(resolve(root, p), 'utf8'))).length;
const mine = count('assets/meta.json');
const all = mine + count('../tidebell/assets/meta.json') + count('../game/assets/meta.json');
const TEXT = {
  en: {
    serif: '"Iowan Old Style", Palatino, Georgia, serif', sans: '"Avenir Next", system-ui, sans-serif', italic: 'italic', sp: '.3em', brief: 'the third brief', note: '',
    tags: [`a walking game, rebuilt as a driving game<br>${mine} new models scripted in Blender`, 'the city is re-rendered around the car<br>so the paint carries real reflections',
      'handbrake slides refill the boost', 'headlamps light the road, the walls, the people', ''],
    caps: ['', 'Twelve gates. One night.', '', 'Drive the rain.', 'Carry the light home.'],
    endA: 'Three requests. Three worlds.', endB: 'Tidebell · built from one sentence　｜　青云宗 · polished　｜　Mothlight · rebuilt as a driving game',
    endC: `${all} models scripted in Blender · every film rendered from the games themselves · no downloaded assets`, endD: 'designed · modelled · coded · scored · filmed by',
  },
  zh: {
    serif: '"Songti SC", "STSong", serif', sans: '"PingFang SC", system-ui, sans-serif', italic: 'normal', sp: '.16em', brief: '第三句需求', note: '「把赛博朋克那个也打磨一下，我想把它做成一款赛博城市里的驾驶游戏。」',
    tags: [`一款步行游戏，重做为驾驶游戏<br>${mine} 个新模型，由 Blender 脚本生成`, '整座城市围绕车身实时重绘<br>车漆上是真实的倒影',
      '手刹漂移，为氮气充能', '车灯照亮路面、墙面与行人', ''],
    caps: ['', '十二道光门，一个夜晚。', '', '驶入雨夜。', '把光带回家。'],
    endA: '三句话，三个世界。', endB: '潮钟 · 由一句话生成　｜　青云宗 · 重新打磨　｜　蛾光 · 重做为驾驶游戏',
    endC: `${all} 个模型由 Blender 脚本生成 · 每段影片均由游戏本身渲染 · 零下载素材`, endD: '设计 · 建模 · 编程 · 配乐 · 摄制',
  },
};
if (!TEXT[lang]) throw new Error(`unknown --lang=${lang}`);

function installDirector(FPS, T) {
  const g = window.__game, car = g.car;
  const PROMPT = 'Polish the cyberpunk one too. I want to turn it into a driving game set in a cyber city.';
  const mono = '"SF Mono", Menlo, monospace';
  const st = document.createElement('style');
  st.textContent = `.pl { position: fixed; pointer-events: none; color: #eef6ff; opacity: 0; z-index: 50; }
    #pCap { left: 0; right: 0; bottom: 10.5vh; text-align: center; font-family: ${T.serif}; font-style: ${T.italic}; font-size: 46px; text-shadow: 0 0 30px #000, 0 0 6px #000; }
    #pTag { left: 64px; top: 56px; font-family: ${T.sans}; font-size: 17px; letter-spacing: ${T.sp}; text-transform: uppercase; border-left: 2px solid #ff2d95; line-height: 1.7;
      text-shadow: 0 0 10px #000, 0 1px 2px #000; background: linear-gradient(90deg, rgba(4,6,12,.6), rgba(4,6,12,0)); padding: 10px 60px 10px 18px; }
    #pFade, #pPrompt, #pEnd { inset: 0; } #pFade, #pPrompt { background: #01060a; }
    #pPrompt, #pEnd { display: flex; flex-direction: column; align-items: center; justify-content: center; }
    #pPrompt .line { font-family: ${mono}; font-size: 34px; max-width: 1500px; line-height: 1.6; } #pPrompt .line b { color: #ff2d95; font-weight: 400; margin-right: 18px; }
    #pPrompt .caret { display: inline-block; width: 16px; height: 36px; background: #ff2d95; vertical-align: -6px; margin-left: 4px; }
    #pPrompt .sub { font-family: ${T.sans}; letter-spacing: ${T.sp}; text-transform: uppercase; font-size: 16px; margin-top: 54px; color: #8d9ab0; text-align: center; }
    #pPrompt .sub em { display: block; font-style: normal; font-family: ${T.serif}; font-size: 30px; letter-spacing: .06em; color: #eef6ff; margin-bottom: 22px; text-transform: none; }
    #pEnd { background: radial-gradient(ellipse at center, rgba(4,6,14,.5), rgba(2,3,8,.94)); }
    #pEnd .d { font-family: ${T.sans}; letter-spacing: ${T.sp}; text-transform: uppercase; font-size: 19px; color: #5ff2ff; }
    #pEnd h1 { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-weight: 400; font-size: 150px; letter-spacing: .14em; margin: 22px 0 0 .14em; text-shadow: 0 0 60px rgba(255,45,149,.5); }
    #pEnd .a { font-family: ${T.serif}; font-style: ${T.italic}; font-size: 42px; margin-top: 30px; }
    #pEnd .b { font-family: ${T.sans}; letter-spacing: .1em; font-size: 19px; margin-top: 54px; color: #ffb3d6; }
    #pEnd .c { font-family: ${T.sans}; letter-spacing: ${T.sp}; text-transform: uppercase; font-size: 14px; margin-top: 20px; opacity: .6; }`;
  document.head.appendChild(st);
  const mk = (id, html = '') => { const d = document.createElement('div'); d.id = id; d.className = 'pl'; d.innerHTML = html; document.body.appendChild(d); return d; };
  const cap = mk('pCap'), tag = mk('pTag'), fadeEl = mk('pFade');
  const pr = mk('pPrompt', `<div class="line"><b>&gt;</b><span></span><span class="caret"></span></div><div class="sub">${T.note ? `<em>${T.note}</em>` : ''}${T.brief}</div>`);
  const endEl = mk('pEnd', `<div class="d">${T.endD}</div><h1>CLAUDE FABLE 5.2</h1><div class="a">${T.endA}</div><div class="b">${T.endB}</div><div class="c">${T.endC}</div>`);
  const hud = document.getElementById('hud');
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const keys = (on, ...codes) => codes.forEach((c) => g.hold(c, on));
  const all = ['KeyW', 'KeyA', 'KeyD', 'Space', 'ShiftLeft'];
  const f = () => [-Math.sin(car.yaw), -Math.cos(car.yaw)];
  const shots = [
    { dur: 5.6, dom: true, init() { pr.style.opacity = 1; }, tick(t) {
      const n = Math.floor(ss(0.6, 3.9, t) ** 0.9 * PROMPT.length + (t > 0.6 ? 0.5 : 0));
      pr.querySelector('span').textContent = PROMPT.slice(0, Math.max(0, n));
      pr.querySelector('.sub').style.opacity = ss(4.1, 4.7, t); pr.style.opacity = ss(5.6, 5.1, t);
    } },
    { dur: 5.2, init() { pr.style.opacity = 0; g.start(false); hud.style.opacity = 0; }, tick(t, u) { // the car, close
      const a = 0.9 + u * 1.5; g.cine = { pos: [car.x + Math.cos(a) * 6.2, 1.15 + 0.5 * u, car.z + Math.sin(a) * 6.2], look: [car.x, 0.62, car.z], fov: 42 };
    } },
    { dur: 6.2, init() { g.cine = null; hud.style.opacity = ''; }, tick(t) { keys(t > 0.4, 'KeyW'); } },                 // launch through the first gate, real HUD
    { dur: 5.6, init() { keys(false, ...all); hud.style.opacity = 0; g.place(128, 38, -Math.PI / 2); }, tick(t, u) {  // a handbrake turn at a junction
      keys(true, 'KeyW'); keys(t > 1.25 && t < 2.5, 'KeyD', 'Space');
      g.cine = { pos: [car.x + 9 - 3 * u, 1.3 + u, car.z - 8 + 2 * u], look: [car.x, 0.7, car.z], fov: 50 };
    } },
    { dur: 6.4, init() { keys(false, ...all); g.place(-320, -41.3, -Math.PI / 2); }, tick(t, u) {                      // flat out down a long street
      keys(true, 'KeyW'); keys(t > 1.2, 'ShiftLeft');
      const [fx, fz] = f(); g.cine = { pos: [car.x - fx * (5.2 - u) + 1.6, 0.95 + 0.5 * u, car.z - fz * (5.2 - u) + 1.4], look: [car.x + fx * 9, 1.0, car.z + fz * 9], fov: 72 };
    } },
    { dur: 10.5, init() { keys(false, ...all); g.place(0, 30, 0); }, tick(t, u) {                                       // rising over the Spire; end card
      const a = 1.2 + t * 0.07, r = 16 + 150 * u * u; g.cine = { pos: [Math.cos(a) * r, 2 + 150 * u * u, 30 + Math.sin(a) * r], look: [0, 3 + 110 * u, 10], fov: 60 };
    } },
  ];
  const END = 7.0, starts = []; let total = 0, cur = -1;
  for (const s of shots) { starts.push(total); total += s.dur; }
  window.__promo = (i) => {
    const Tm = i / FPS; let k = shots.length - 1; while (k > 0 && Tm < starts[k]) k--;
    const s = shots[k], t = Tm - starts[k], last = k === shots.length - 1, capEnd = last ? s.dur - END : s.dur;
    if (k !== cur) { cur = k; s.init(); cap.textContent = T.caps[k - 1] ?? ''; tag.innerHTML = T.tags[k - 1] ?? ''; }
    s.tick(t, t / s.dur);
    if (!s.dom) g.step(1, 1 / FPS);
    const vis = ss(0.5, 1.3, t) * ss(capEnd - 0.3, capEnd - 1.0, t);
    cap.style.opacity = cap.textContent ? vis : 0; tag.style.opacity = tag.innerHTML ? vis * 0.95 : 0;
    fadeEl.style.opacity = Math.max(k > 0 ? ss(0.24, 0, t) : 0, k === 0 ? 0 : last ? ss(total - 0.9, total, Tm) : ss(s.dur - 0.24, s.dur, t));
    endEl.style.opacity = ss(total - END, total - END + 1.8, Tm);
  };
  return { total, starts, promptLen: PROMPT.length };
}

// Score: keystrokes, then a pulsing synth bass, an arpeggio and a pad, with a hit on every cut.
async function renderScore(total, starts, promptLen) {
  const sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr), master = ctx.createGain();
  master.gain.setValueAtTime(0.85, 0); master.gain.setValueAtTime(0.85, total - 2.4); master.gain.exponentialRampToValueAtTime(0.0001, total);
  master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
  const delay = ctx.createDelay(1), fb = ctx.createGain(); delay.delayTime.value = 0.33; fb.gain.value = 0.4; delay.connect(fb).connect(delay); delay.connect(master);
  const nb = ctx.createBuffer(1, sr, sr), nd = nb.getChannelData(0); for (let i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;
  const tone = (f, when, dur, gain, type = 'sawtooth', cut = 1200, echo = false) => {
    if (when < 0 || when >= total) return;
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), gn = ctx.createGain();
    o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.setValueAtTime(cut, when); lp.frequency.exponentialRampToValueAtTime(Math.max(80, cut * 0.25), when + dur);
    gn.gain.setValueAtTime(0.0001, when); gn.gain.exponentialRampToValueAtTime(gain, when + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(lp).connect(gn).connect(master); if (echo) gn.connect(delay); o.start(when); o.stop(when + dur + 0.05);
  };
  const hit = (when, dur, f, gain) => {
    const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), gn = ctx.createGain(); s.buffer = nb; s.loop = true; bp.type = 'bandpass'; bp.frequency.value = f;
    gn.gain.setValueAtTime(gain, when); gn.gain.exponentialRampToValueAtTime(0.0001, when + dur); s.connect(bp).connect(gn).connect(master); s.start(when); s.stop(when + dur + 0.05);
  };
  const ss = (a, c, x) => { const t = Math.min(1, Math.max(0, (x - a) / (c - a))); return t * t * (3 - 2 * t); };
  let ln = 0;
  for (let t = 0; t < 4.1; t += 1 / 120) { const n = Math.floor(ss(0.6, 3.9, t) ** 0.9 * promptLen); if (n > ln) { ln = n; hit(t, 0.03, 3000, 0.05); } }
  const t0 = starts[1], step = 60 / 112 / 4, bass = [55, 55, 65.41, 49], arp = [220, 261.63, 329.63, 392, 440, 392, 329.63, 261.63];
  for (let t = t0, n = 0; t < total - 5; t += step, n++) {
    const bar = Math.floor(n / 16) % 4, drive = t > starts[2];
    if (n % 2 === 0) tone(bass[bar] * (n % 8 === 6 ? 2 : 1), t, step * 1.8, drive ? 0.2 : 0.11, 'sawtooth', drive ? 900 : 400);
    if (drive) tone(arp[n % 8] * (bass[bar] / 55) * (n % 32 > 23 ? 2 : 1), t, step * 1.5, 0.045, 'square', 2600, true);
    if (drive && n % 4 === 0) { tone(110, t, 0.16, 0.3, 'sine', 300); hit(t, 0.05, 150, 0.2); }
    if (drive && n % 8 === 4) hit(t, 0.12, 2200, 0.1);
    if (n % 16 === 0) for (const m of [1, 1.5, 2]) tone(bass[bar] * 2 * m, t, step * 16, 0.035, 'triangle', 1500, true);
  }
  for (let i = 2; i < starts.length; i++) hit(starts[i], 0.9, 600, 0.22);
  for (const [k, m] of [[0, 1], [1, 1.5], [2, 2], [3, 3]]) tone(110 * m, total - 6.6 + k * 0.12, 6, 0.07, 'triangle', 2000, true);
  const buf = await ctx.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), pcm = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { pcm[i * 2] = Math.max(-1, Math.min(1, L[i])) * 32767; pcm[i * 2 + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
  const bytes = new Uint8Array(pcm.buffer); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function wav(pcm, sr = 44100) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--window-size=1920,1080', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(pathToFileURL(resolve(root, 'index.html')).href);
  await page.waitForFunction('window.__game', { timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); window.__game.paused = true; });
  const { total, starts, promptLen } = await page.evaluate(installDirector, FPS, TEXT[lang]);
  const frames = Math.round(total * FPS), silent = resolve(outDir, `video-only-${lang}.mp4`);
  console.log(`film: ${total.toFixed(1)} s, ${frames} frames`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = once(ff, 'close');
  for (let i = 0; i < frames; i++) {
    await page.evaluate((n) => window.__promo(n), i);
    const img = await page.screenshot({ type: 'jpeg', quality: 95, optimizeForSpeed: true });
    if (ff.exitCode !== null) throw new Error(`ffmpeg exited early with ${ff.exitCode}`);
    if (!ff.stdin.write(img)) await once(ff.stdin, 'drain');
  }
  ff.stdin.end();
  if ((await done)[0] !== 0) throw new Error('ffmpeg failed');
  const wavPath = resolve(outDir, 'score.wav');
  writeFileSync(wavPath, wav(Buffer.from(await page.evaluate(renderScore, total, starts, promptLen), 'base64')));
  const out = resolve(outDir, `mothlight-promo${lang === 'en' ? '' : `-${lang}`}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wavPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
  rmSync(silent);
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
