// Renders the showcase film. Headless Chrome steps the real game frame by frame along scripted shots; each frame is
// screenshotted (canvas + overlays) and piped to ffmpeg, then a soundtrack synthesised offline is muxed in.
//   node tools/promo.mjs            -> promo/tidebell-promo.mp4
//   node tools/promo.mjs --stills   -> one still per shot in promo/stills (fast iteration)
// The model-parade shot uses frames rendered by Blender: run tools/blender/parade.py first.
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'promo');
const W = 1920;
const H = 1080;
const FPS = 30;
const stills = process.argv.includes('--stills');
const lang = process.argv.find((a) => a.startsWith('--lang='))?.slice(7) ?? 'en'; // en | zh
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7); // with --stills: sample just this shot, densely
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(resolve(outDir, 'stills'), { recursive: true });

// Facts shown on screen are measured from the project, not typed in by hand.
const meta = JSON.parse(readFileSync(resolve(root, 'assets/meta.json'), 'utf8'));
const countLines = (dir, ext) => readdirSync(resolve(root, dir)).filter((f) => f.endsWith(ext))
  .reduce((n, f) => n + readFileSync(resolve(root, dir, f), 'utf8').split('\n').length, 0);
const excerpt = (file, marker, n) => {
  const lines = readFileSync(resolve(root, file), 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(marker));
  return lines.slice(i, i + n).map((l) => (l.length > 96 ? `${l.slice(0, 95)}…` : l));
};
const paradeDir = resolve(outDir, 'parade');
if (!existsSync(resolve(paradeDir, 'shade/0000.jpg'))) throw new Error('promo/parade is missing: run tools/blender/parade.py first');
const n = (v) => v.toLocaleString('en-US');
const modelCount = Object.keys(meta).length;
const triCount = Object.values(meta).reduce((a, m) => a + m.tris, 0);
const lineCount = countLines('src', '.js') + countLines('tools/blender', '.py') + countLines('tools', '.mjs') + countLines('tests', '.js');
// Every piece of on-screen text, per language. The typed brief stays in the language it was actually written in.
const TEXT = {
  en: {
    serif: '"Iowan Old Style", Palatino, Georgia, serif', sans: '"Avenir Next", system-ui, sans-serif', italic: 'italic', tagSpacing: '.3em',
    brief: 'the entire brief', briefNote: '',
    blueprintTag: 'no downloaded models<br>no textures · no recordings', blueprintCap: 'Everything here was written.',
    paradeCap: 'Every creature, modelled by code.', paradeTag: `${modelCount} models · generated in Blender by Python<br>${n(triCount)} triangles`,
    reefCap: 'Seven bells sleep beneath the bay.', reefTag: 'about 18,000 corals, plants and rocks<br>placed by rule, not by hand',
    baitTag: '2,573 fish<br>each one animated on the GPU',
    kelpCap: 'Dive past the light.', kelpTag: 'light shafts<br>ray-marched every frame',
    wreckTag: 'water takes the red first<br>the lamps bring colour back',
    gorgeCap: 'Past where the sun gives up.', gorgeTag: '340 jellyfish<br>one draw call',
    bellCap: '',
    anglerCap: 'Some lights are not for you.', ventsCap: 'Something older is listening.',
    whaleCap: 'Wake them — and the sea will sing again.', whaleTag: 'the music is synthesised too<br>nothing here was recorded',
    depth: 'metres down', endSub: '',
    endA: 'One sentence in. A playable world out.', endB: 'designed · modelled · coded · scored · filmed by Claude Fable 5.2',
    endC: `${modelCount} models built in Blender by script · ${n(lineCount)} lines of code · no downloaded assets`,
  },
  zh: {
    serif: '"Songti SC", "STSong", "Noto Serif CJK SC", serif', sans: '"PingFang SC", "Hiragino Sans GB", system-ui, sans-serif', italic: 'normal', tagSpacing: '.16em',
    brief: '全部需求，只有这一句', briefNote: '「我想做一款水下探索游戏，而且要尽可能惊艳。」',
    blueprintTag: '没有下载的模型<br>没有贴图 · 没有录音', blueprintCap: '这里的一切，都是写出来的。',
    paradeCap: '每一个生灵，都由代码建模。', paradeTag: `${modelCount} 个模型 · 在 Blender 中由 Python 生成<br>${n(triCount)} 个三角面`,
    reefCap: '七口钟，沉睡在海湾之下。', reefTag: '约 18,000 株珊瑚、海草与礁石<br>按规则生成，而非手工摆放',
    baitTag: '2,573 条鱼<br>每一条都在 GPU 上游动',
    kelpCap: '潜过光能抵达的地方。', kelpTag: '光束<br>逐帧光线步进',
    wreckTag: '海水最先带走红色<br>探照灯把颜色带回来',
    gorgeCap: '直到阳光放弃的深处。', gorgeTag: '340 只水母<br>一次绘制调用',
    bellCap: '灯火应声而动。它们一直在等这一拍。',
    anglerCap: '有些光，不是为你而亮。', ventsCap: '更古老的东西，正在聆听。',
    whaleCap: '唤醒它们——大海将再次歌唱。', whaleTag: '配乐同样是合成的<br>这里没有任何录音',
    depth: '水下 · 米', endSub: '潮 钟',
    endA: '一句话进去，一个可玩的世界出来。', endB: '设计 · 建模 · 编程 · 配乐 · 摄制 —— Claude Fable 5.2',
    endC: `${modelCount} 个模型由 Blender 脚本生成 · ${n(lineCount)} 行代码 · 零下载素材`,
  },
};
if (!TEXT[lang]) throw new Error(`unknown --lang=${lang}`);
const facts = {
  text: TEXT[lang],
  paradeFrames: readdirSync(resolve(paradeDir, 'shade')).length,
  paradeUrl: pathToFileURL(paradeDir).href,
  code: [
    { file: 'tools/blender/creatures.py', lines: excerpt('tools/blender/creatures.py', 'def build_whale', 17) },
    { file: 'src/shaders.js', lines: excerpt('src/shaders.js', 'vec3 shadeUW(', 15) },
  ],
};

// ---- runs inside the page -------------------------------------------------------------------------------
function installDirector(FPS, facts) {
  const tb = window.__tb;
  const H = tb.heightAt;
  const choir = { x: -10, z: -730 };
  const PROMPT = 'I want to make an underwater exploration game, and it should be as stunning as possible.';
  const T = facts.text;
  const serif = T.serif;
  const mono = '"SF Mono", Menlo, Consolas, monospace';
  const sans = T.sans;
  const style = document.createElement('style');
  style.textContent = `#title, #hud, #story, #zonecard, #prompt, #finale { transition: none !important; }
    .pl { position: fixed; pointer-events: none; color: #eaf7f6; opacity: 0; }
    #pCap { left: 0; right: 0; bottom: 10.5vh; text-align: center; font-family: ${serif}; font-style: ${T.italic}; font-size: 46px; text-shadow: 0 0 30px rgba(0,20,30,.95), 0 0 6px rgba(0,0,0,.8); }
    #pTag { left: 64px; top: 56px; font-family: ${sans}; font-size: 17px; letter-spacing: ${T.tagSpacing}; text-transform: uppercase; padding-left: 18px; border-left: 2px solid #7dffd8;
      line-height: 1.7; text-shadow: 0 0 14px rgba(0,10,20,.9); }
    #pDepth { right: 64px; bottom: 56px; text-align: right; font-family: ${serif}; font-size: 64px; line-height: 1; text-shadow: 0 2px 20px rgba(0,0,0,.7); font-variant-numeric: tabular-nums; }
    #pDepth small { font-family: ${sans}; font-size: 14px; letter-spacing: .32em; display: block; margin-top: 10px; opacity: .65; text-transform: uppercase; }
    #pFade { inset: 0; background: #01060a; }
    #pPrompt { inset: 0; background: #01060a; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    #pPrompt .line { font-family: ${mono}; font-size: 34px; max-width: 1500px; line-height: 1.6; text-align: left; color: #dff6f2; }
    #pPrompt .line b { color: #7dffd8; font-weight: 400; margin-right: 18px; }
    #pPrompt .caret { display: inline-block; width: 16px; height: 36px; background: #7dffd8; vertical-align: -6px; margin-left: 4px; }
    #pPrompt .sub { font-family: ${sans}; letter-spacing: ${T.tagSpacing}; text-transform: uppercase; font-size: 16px; margin-top: 54px; color: #7fa8a6; text-align: center; }
    #pPrompt .sub em { display: block; font-style: normal; font-family: ${serif}; font-size: 30px; letter-spacing: .06em; color: #dff6f2; margin-bottom: 22px; text-transform: none; }
    #pEnd .z { font-family: ${serif}; font-size: 44px; letter-spacing: .5em; margin: 18px 0 0 .5em; color: #7dffd8; }
    #pCode { left: 64px; top: 150px; width: 900px; font-family: ${mono}; font-size: 17px; line-height: 1.5; white-space: pre; color: #9fe9e0; text-shadow: 0 0 12px rgba(0,255,220,.25); }
    #pCode .f { color: #7dffd8; letter-spacing: .12em; margin-bottom: 10px; font-size: 14px; opacity: .8; }
    #pParade { inset: 0; background: #01060a; }
    #pParade img { position: absolute; inset: 0; width: 100%; height: 100%; }
    #pParade i { position: absolute; top: 0; bottom: 0; width: 3px; background: #b8fff0; box-shadow: 0 0 30px 6px rgba(125,255,216,.8); }
    #pEnd { inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(1,8,14,.45), rgba(1,8,14,.9)); }
    #pEnd h1 { font-family: ${serif}; font-weight: 400; font-size: 176px; letter-spacing: .22em; margin: 0 0 0 .22em; text-shadow: 0 0 60px rgba(125,255,216,.5); }
    #pEnd .a { font-family: ${serif}; font-style: ${T.italic}; font-size: 40px; margin-top: 26px; }
    #pEnd .b { font-family: ${sans}; letter-spacing: ${T.tagSpacing}; text-transform: uppercase; font-size: 19px; margin-top: 56px; color: #7dffd8; }
    #pEnd .c { font-family: ${sans}; letter-spacing: ${T.tagSpacing}; text-transform: uppercase; font-size: 14px; margin-top: 20px; opacity: .6; }`;
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
  const depthEl = mk('pDepth', `<span></span><small>${T.depth}</small>`);
  const codeEl = mk('pCode');
  const parade = mk('pParade', '<img id="pWire"><img id="pShade"><i></i>');
  const fadeEl = mk('pFade');
  const promptEl = mk('pPrompt', '<div class="line"><b>&gt;</b><span></span><span class="caret"></span></div><div class="sub"></div>');
  promptEl.querySelector('.sub').innerHTML = `${T.briefNote ? `<em>${T.briefNote}</em>` : ''}${T.brief}`;
  const endEl = mk('pEnd', `<h1>TIDEBELL</h1>${T.endSub ? `<div class="z">${T.endSub}</div>` : ''}<div class="a">${T.endA}</div>
    <div class="b">${T.endB}</div><div class="c">${T.endC}</div>`);
  const hud = document.getElementById('hud');
  document.getElementById('loading')?.remove();
  document.getElementById('title').style.display = 'none';

  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const yawTo = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
  const sub = () => tb.player.sub.pos;
  const fwd = () => {
    const l = tb.player.look;
    return [-Math.sin(l.yaw) * Math.cos(l.pitch), Math.sin(l.pitch), -Math.cos(l.yaw) * Math.cos(l.pitch)];
  };
  let frameNo = 0;
  // Hold W for a fraction of frames: a slow, steady cruise through the real physics.
  const cruise = (duty) => key('KeyW', (frameNo * 0.6180339) % 1 < duty);
  const floorCam = (p, clearance = 1.3) => [p[0], Math.max(p[1], H(p[0], p[2]) + clearance), p[2]];
  const hideHud = (v) => hud.classList.toggle('hidden', v);
  const place = (x, y, z, yaw, pitch = 0) => tb.teleport(x, y, z, yaw, pitch);
  const settle = (n) => {
    tb.cine = null;
    tb.step(n, 1 / FPS);
  };
  const find = (id, near) => {
    let best = null;
    for (const t of tb.life.targets([])) {
      if (t.id !== id) continue;
      const d = Math.hypot(t.pos.x - near[0], t.pos.z - near[1]);
      if (!best || d < best.d) best = { d, pos: t.pos };
    }
    return best.pos;
  };
  const typed = (lines, n) => {
    let out = '';
    for (const l of lines) {
      if (n <= 0) break;
      out += `${l.slice(0, n)}\n`;
      n -= l.length + 1;
    }
    return out;
  };

  const shots = [
    { // 0. The brief, typed on black.
      name: 'prompt', dur: 6.2, dom: true,
      init() {
        promptEl.style.opacity = 1;
      },
      tick(t) {
        const n = Math.floor(ss(0.7, 4.1, t) ** 0.9 * PROMPT.length + (t > 0.7 ? 0.5 : 0));
        promptEl.querySelector('span').textContent = PROMPT.slice(0, Math.max(0, n));
        promptEl.querySelector('.caret').style.opacity = n >= PROMPT.length ? ((t * 2.2) % 1 < 0.55 ? 1 : 0) : 1;
        promptEl.querySelector('.sub').style.opacity = ss(4.5, 5.2, t);
        promptEl.style.opacity = ss(6.2, 5.6, t);
      },
    },
    { // 1. The world as a construction grid, then painted in by a wave of light.
      name: 'blueprint', dur: 11, tag: T.blueprintTag,
      init() {
        promptEl.style.opacity = 0;
        document.getElementById('title').click();
        document.exitPointerLock?.();
        hideHud(true);
        place(8, H(8, -70) + 4.2, -70, -0.5, 0);
        settle(25);
      },
      tick(t, u) {
        const s = sub();
        const grow = ss(6.0, 10.2, t);
        tb.U.uReveal.value.set(s[0], s[1], s[2], t < 6.0 ? 0.01 : grow >= 1 ? -1 : 2 + 190 * grow * grow);
        const a = 2.2 + t * 0.085;
        const r = 15 + 9 * u;
        tb.cine = { pos: floorCam([s[0] + Math.cos(a) * r, s[1] + 3.5 + 3 * u, s[2] + Math.sin(a) * r], 2), look: [s[0], s[1] + 0.5, s[2]] };
        const which = t < 3.4 ? 0 : 1;
        const local = which === 0 ? t - 0.4 : t - 3.5;
        const c = facts.code[which];
        codeEl.innerHTML = '';
        const f = document.createElement('div');
        f.className = 'f';
        f.textContent = c.file;
        codeEl.append(f, document.createTextNode(typed(c.lines, Math.floor(Math.max(0, local) * 330))));
        codeEl.style.opacity = ss(0.2, 0.6, t) * ss(6.6, 5.8, t) * 0.92;
        cap.textContent = t > 6 ? T.blueprintCap : '';
        cap.style.opacity = ss(7.4, 8.4, t) * ss(11, 10.3, t);
      },
      exit() {
        tb.U.uReveal.value.w = -1;
        codeEl.style.opacity = 0;
      },
    },
    { // 2. Blender renders of the generated models: wireframe wiped into shaded.
      name: 'parade', dur: facts.paradeFrames / FPS, dom: true, caption: T.paradeCap, tag: T.paradeTag,
      init() {
        parade.style.opacity = 1;
      },
      async tick(t) {
        const n = String(Math.min(facts.paradeFrames - 1, Math.round(t * FPS))).padStart(4, '0');
        const a = parade.querySelector('#pWire');
        const b = parade.querySelector('#pShade');
        a.src = `${facts.paradeUrl}/wire/${n}.jpg`;
        b.src = `${facts.paradeUrl}/shade/${n}.jpg`;
        await Promise.all([a.decode(), b.decode()]);
        const x = -4 + 108 * ss(1.3, 4.6, t);
        b.style.clipPath = `inset(0 ${Math.max(0, 100 - x)}% 0 0)`;
        const bar = parade.querySelector('i');
        bar.style.left = `${x}%`;
        bar.style.opacity = x > 0 && x < 100 ? 1 : 0;
      },
      exit() {
        parade.style.opacity = 0;
      },
    },
    { // 3. Reef glide.
      name: 'reef', dur: 6.5, caption: T.reefCap, tag: T.reefTag,
      init() {
        const from = [-18, 0, -42];
        place(from[0], H(from[0], from[2]) + 3.4, from[2], yawTo(from, [26, 0, -96]), -0.02);
        settle(20);
      },
      tick(t, u) {
        cruise(0.42);
        const s = sub();
        const f = fwd();
        const r = [-f[2], 0, f[0]];
        const side = 8.5 - 2 * u;
        tb.cine = { pos: floorCam([s[0] + r[0] * side + f[0] * (7 - 5 * u), s[1] + 0.6 + u * 1.2, s[2] + r[2] * side + f[2] * (7 - 5 * u)]), look: [s[0] + f[0] * 2, s[1] + 0.3, s[2] + f[2] * 2] };
      },
    },
    { // 4. A turtle crossing the reef.
      name: 'turtle', dur: 4.5,
      init() {
        key('KeyW', false);
        this.turtle = find('turtle', [-20, -90]);
      },
      tick(t, u) {
        const p = this.turtle;
        const a = 0.9 + u * 0.5;
        tb.cine = { pos: floorCam([p.x + Math.cos(a) * 6.5, p.y - 0.4 + u * 0.8, p.z + Math.sin(a) * 6.5], 0.9), look: [p.x, p.y + 0.2, p.z] };
      },
    },
    { // 5. Straight through a bait ball.
      name: 'baitball', dur: 6.5, tag: T.baitTag,
      init() {
        tb.wake(0);
        tb.wake(1);
        this.ball = find('darter', [40, -380]);
        const b = this.ball;
        place(b.x + 34, b.y - 1, b.z + 6, yawTo([b.x + 34, 0, b.z + 6], [b.x, 0, b.z]), 0.02);
        settle(170);
      },
      tick(t, u) {
        const b = this.ball;
        const s = sub();
        tb.player.look.yaw = yawTo(s, [b.x - 20, 0, b.z - 4]);
        if (t > 0.6) cruise(0.75);
        const a = 1.25 - u * 0.5;
        tb.cine = { pos: [b.x + Math.cos(a) * 13.5, b.y - 4 + 5 * u, b.z + Math.sin(a) * 13.5], look: [b.x * 0.8 + s[0] * 0.2, b.y + 0.5, b.z * 0.8 + s[2] * 0.2] };
      },
    },
    { // 6. Kelp cathedral, looking up into the light.
      name: 'kelp', dur: 6, caption: T.kelpCap, tag: T.kelpTag,
      init() {
        key('KeyW', false);
        const from = [-52, 0, -246];
        place(from[0], H(from[0], from[2]) + 13, from[2], yawTo(from, [-95, 0, -288]), 0.0);
        this.cam = [-90.5, H(-90.5, -281.5) + 1.7, -281.5];
        settle(20);
      },
      tick(t, u) {
        cruise(0.4);
        const s = sub();
        tb.cine = { pos: [this.cam[0], this.cam[1] + u * 1.5, this.cam[2]], look: [s[0], s[1] + 1 + 4 * (1 - u), s[2]] };
      },
    },
    { // 7. A ray passing overhead, seen from below against the surface light.
      name: 'manta', dur: 4.5,
      init() {
        key('KeyW', false);
        this.manta = find('manta', [-112, -402]);
        place(-60, -40, -350, 2, 0);
        settle(4);
      },
      tick(t, u) {
        const m = this.manta;
        const a = 0.8 + u * 0.6;
        tb.cine = { pos: [m.x + Math.cos(a) * 8, m.y - 6.5 + u, m.z + Math.sin(a) * 8], look: [m.x, m.y + 0.5, m.z] };
      },
    },
    { // 8. The wreck by lamplight.
      name: 'wreck', dur: 5.5, tag: T.wreckTag,
      init() {
        const from = [-80, 0, -372];
        place(from[0], -53, from[2], yawTo(from, [-106, 0, -402]), -0.16);
        tb.player.setLamp(true);
        settle(40);
      },
      tick(t, u) {
        cruise(0.14);
        const c = [-112, H(-112, -402), -402];
        const s = sub();
        const f = fwd();
        const r = [-f[2], 0, f[0]];
        tb.cine = { pos: [s[0] - f[0] * (12 - 3 * u) + r[0] * 5.5, s[1] + 4 - u, s[2] - f[2] * (12 - 3 * u) + r[2] * 5.5], look: [c[0] + 6, c[1] + 6, c[2]] };
      },
    },
    { // 9. Lantern Gorge.
      name: 'gorge', dur: 7, caption: T.gorgeCap, tag: T.gorgeTag,
      init() {
        key('KeyW', false);
        tb.wake(2);
        tb.wake(3);
        place(36, -84, -448, 0.05, -0.5);
        settle(170);
      },
      tick(t, u) {
        cruise(0.25);
        const s = sub();
        tb.cine = { pos: [s[0] + 7 - 3 * u, s[1] - 6.5, s[2] - 10 + 2 * u], look: [s[0], s[1] + 1.5, s[2]] };
      },
    },
    { // 10. Waking a bell, with the real HUD and the real chase camera.
      name: 'bell', dur: 8, hudShot: true, tag: '', caption: T.bellCap, capFrom: 3.6,
      init() {
        key('KeyW', false);
        tb.cine = null;
        tb.gotoBell(4);
        tb.player.look.pitch = 0.08;
        settle(40);
        hideHud(false);
      },
      tick(t) {
        key('KeyE', t > 1.2 && t < 3.2);
        if (t > 4.2) tb.player.look.yaw += 0.0035;
      },
    },
    { // 11. An anglerfish and its one light.
      name: 'angler', dur: 5, caption: T.anglerCap,
      init() {
        hideHud(true);
        this.fish = find('angler', [-90, -660]);
        place(-30, -150, -600, 0, 0);
        tb.player.setLamp(false);
        settle(60);
      },
      tick(t, u) {
        const p = this.fish;
        const a = 0.4 + u * 0.7;
        tb.cine = { pos: floorCam([p.x + Math.cos(a) * (6.5 - 1.5 * u), p.y + 0.6, p.z + Math.sin(a) * (6.5 - 1.5 * u)], 1), look: [p.x, p.y + 0.3, p.z] };
      },
    },
    { // 12. The vent field.
      name: 'vents', dur: 4.8, caption: T.ventsCap,
      init() {
        tb.wake(5);
        place(126, -184, -628, -0.85, 0.05);
        tb.player.setLamp(true);
        settle(170);
      },
      tick(t, u) {
        cruise(0.2);
        const y = H(155, -650);
        const a = 2.5 + u * 0.35;
        tb.cine = { pos: floorCam([155 + Math.cos(a) * 46, y + 7, -650 + Math.sin(a) * 46], 2), look: [150, y + 10, -646] };
      },
    },
    { // 13. Through the moon gate to the Drowned Choir.
      name: 'gate', dur: 6,
      init() {
        key('KeyW', false);
        tb.world.bells[6].awake = true;
        tb.life.startFinale();
        settle(30 * FPS);
        place(choir.x, H(choir.x, choir.z + 70) + 7, choir.z + 74, 0, -0.03);
        settle(10);
      },
      tick(t, u) {
        tb.U.uGlobalGlow.value = 2.2;
        cruise(0.42);
        const s = sub();
        tb.cine = { pos: [s[0] + 2.5 - 2.5 * u, s[1] + 2.4 + u, s[2] + 11], look: [choir.x, H(choir.x, choir.z) + 6 + 10 * u, choir.z] };
      },
    },
    { // 14. The Singer, then the end card over it.
      name: 'whale', dur: 14.5, caption: T.whaleCap, tag: T.whaleTag,
      init() {
        key('KeyW', false);
        const w = tb.life.whale.pos;
        place(w.x + 16, w.y - 9, w.z + 20, yawTo([w.x + 16, 0, w.z + 20], [w.x, 0, w.z]), 0.25);
        tb.player.setLamp(false);
        settle(4);
      },
      tick(t, u) {
        tb.U.uGlobalGlow.value = 2.2;
        const w = tb.life.whale.pos;
        const s = sub();
        tb.player.look.yaw = yawTo(s, [w.x, 0, w.z]);
        const dx = s[0] - w.x;
        const dz = s[2] - w.z;
        const l = Math.hypot(dx, dz) || 1;
        tb.cine = { pos: [s[0] + (dx / l) * 9 + 3, s[1] - 2.5 - u * 2, s[2] + (dz / l) * 9], look: [w.x, w.y - 1, w.z] };
      },
    },
  ];
  const END = 7.5; // end card, laid over the last shot
  const starts = [];
  let total = 0;
  for (const s of shots) {
    starts.push(total);
    total += s.dur;
  }
  let current = -1;

  window.__promo = {
    total, starts, names: shots.map((s) => s.name), promptLen: PROMPT.length,
    async frame(i) {
      frameNo = i;
      const T = i / FPS;
      let k = shots.length - 1;
      while (k > 0 && T < starts[k]) k--;
      const shot = shots[k];
      if (k !== current) {
        if (current >= 0) shots[current].exit?.();
        current = k;
        shot.init();
        cap.textContent = shot.caption ?? '';
        tag.innerHTML = shot.tag ?? '';
      }
      const t = T - starts[k];
      const last = k === shots.length - 1;
      const capEnd = last ? shot.dur - END : shot.dur;
      if (shot.caption) cap.style.opacity = ss(shot.capFrom ?? 0.8, (shot.capFrom ?? 0.8) + 0.9, t) * ss(capEnd - 0.3, capEnd - 1.1, t);
      else if (shot.name !== 'blueprint') cap.style.opacity = 0;
      tag.style.opacity = shot.tag ? ss(0.5, 1.2, t) * ss(capEnd - 0.3, capEnd - 0.9, t) * 0.92 : 0;
      await shot.tick(t, t / shot.dur);
      if (!shot.dom) tb.step(1, 1 / FPS);
      // Depth read-out during the dive.
      const showDepth = !shot.dom && !shot.hudShot && k >= 3;
      depthEl.style.opacity = showDepth ? ss(0.3, 1.0, t) * ss(capEnd - 0.2, capEnd - 0.8, t) * 0.9 : 0;
      if (showDepth) depthEl.firstElementChild.textContent = Math.max(0, Math.round(-tb.gfx.camera.position.y));
      // Dip to black around cuts.
      const edge = 0.24;
      const fin = k > 0 ? ss(edge, 0, t) : 0;
      const fout = !last ? ss(shot.dur - edge, shot.dur, t) : ss(total - 0.8, total, T);
      fadeEl.style.opacity = Math.max(fin, k === 0 ? 0 : fout);
      endEl.style.opacity = ss(total - END, total - END + 1.8, T);
    },
  };
  return { total, starts, names: window.__promo.names, promptLen: PROMPT.length };
}

// Offline soundtrack: keystrokes, a rising sweep as the world is painted in, a pentatonic line that gathers a voice
// in every zone and thins out in the abyss, bells on the cuts, whale song at the end.
async function renderScore(total, starts, names, promptLen) {
  const at = (name) => starts[names.indexOf(name)];
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.9, 0);
  master.gain.setValueAtTime(0.9, total - 2.2);
  master.gain.exponentialRampToValueAtTime(0.0001, total);
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  const len = sr * 5;
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.42 * t);
      d[i] = lp * (1 - t) ** 2.6;
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.6;
  wet.connect(conv).connect(master);

  const nb = ctx.createBuffer(1, sr * 4, sr);
  const nd = nb.getChannelData(0);
  let b = 0;
  for (let i = 0; i < nd.length; i++) {
    b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    nd[i] = b * 3.5;
  }
  const white = ctx.createBuffer(1, sr, sr);
  const wd = white.getChannelData(0);
  for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;

  const world = at('blueprint') + 6.0; // the moment the reveal wave starts
  // Water bed, silent under the prompt, swelling in with the reveal.
  const bed = ctx.createBufferSource();
  bed.buffer = nb;
  bed.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(420, 0);
  lp.frequency.linearRampToValueAtTime(150, total);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.03, 0);
  bg.gain.setValueAtTime(0.06, world);
  bg.gain.linearRampToValueAtTime(0.5, world + 3.5);
  bed.connect(lp).connect(bg).connect(master);
  bed.start();

  const tone = (freq, when, { type = 'sine', attack = 0.01, decay = 2, gain = 0.2, slide = 0, vibrato = 0, dry = 0.4, pan = 0 } = {}) => {
    if (when >= total || when < 0) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), when + decay);
    if (vibrato) {
      const v = ctx.createOscillator();
      v.frequency.value = 4.5;
      const vg = ctx.createGain();
      vg.gain.value = freq * vibrato;
      v.connect(vg).connect(o.frequency);
      v.start(when);
      v.stop(when + decay + 0.1);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p);
    const d = ctx.createGain();
    d.gain.value = dry;
    p.connect(d).connect(master);
    p.connect(wet);
    o.start(when);
    o.stop(when + decay + 0.1);
  };
  const noiseHit = (when, dur, f0, f1, gain, q = 1.5) => {
    const s = ctx.createBufferSource();
    s.buffer = white;
    s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, when);
    bp.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(bp).connect(g);
    g.connect(master);
    g.connect(wet);
    s.start(when);
    s.stop(when + dur + 0.05);
  };
  const PENTA = [220.0, 261.63, 293.66, 349.23, 392.0, 440.0, 523.25];
  const bell = (i, when, loud = 1) => {
    const f = PENTA[i % PENTA.length];
    for (const [m, g, d] of [[1, 0.26, 7], [2.01, 0.13, 5], [2.76, 0.09, 4], [5.4, 0.045, 2.5], [0.5, 0.18, 8]]) tone(f * m, when, { gain: g * loud, decay: d, attack: 0.005 });
  };

  // Keystrokes for the typed brief (same easing as the on-screen typing).
  const ss = (a, c, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (c - a)));
    return t * t * (3 - 2 * t);
  };
  let lastN = 0;
  for (let t = 0; t < 4.3; t += 1 / 120) {
    const n = Math.floor(ss(0.7, 4.1, t) ** 0.9 * promptLen);
    if (n > lastN) {
      lastN = n;
      noiseHit(t, 0.035, 2600 + Math.random() * 1400, 1400, 0.05, 3);
    }
  }
  tone(55, 0.2, { type: 'sine', gain: 0.1, decay: at('blueprint') + 6, attack: 3, dry: 0.6 });
  // Blueprint: a quiet data shimmer, then the sweep and the first great bell.
  for (let t = at('blueprint') + 0.4; t < world - 0.3; t += 0.125) tone(1760 * 2 ** (Math.floor(Math.random() * 5) / 5), t, { gain: 0.012, decay: 0.12, type: 'square', dry: 0.5, pan: Math.random() * 2 - 1 });
  noiseHit(world - 0.2, 4.4, 180, 5200, 0.22, 0.8);
  bell(0, world, 1.6);
  tone(55, world, { gain: 0.3, decay: 6, attack: 0.02, slide: 0.5 });

  // The pad sinks as the film descends.
  for (let t = world; t < total; t += 6) {
    const k = t / total;
    const base = 110 - 45 * k;
    for (const m of [1, 1.5, 2, 3]) tone(base * m, t, { type: 'triangle', gain: 0.035 / m ** 0.5, decay: 8.5, attack: 3, dry: 0.3 });
  }
  // The line: eighth notes at 80 bpm over a slowly turning pentatonic pattern.
  const step = 60 / 80 / 2;
  const pattern = [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 4, 6, 5, 4, 2, 4];
  const dark = [at('angler'), at('gate')]; // the line drops out in the abyss
  let n = 0;
  for (let t = at('parade'); t < at('whale') + 6; t += step, n++) {
    if (t > dark[0] - 0.5 && t < dark[1]) continue;
    const depthK = Math.min(1, (t - at('parade')) / (at('angler') - at('parade')));
    const f = PENTA[pattern[n % pattern.length]] * (t < at('reef') ? 2 : 1);
    const g = 0.05 * (1 - 0.45 * depthK) * (n % 4 === 0 ? 1.3 : 1);
    tone(f, t, { gain: g, decay: 0.9, type: 'triangle', dry: 0.35, pan: Math.sin(n * 0.7) * 0.5 });
    if (t > at('baitball') && n % 2 === 0) tone(f * 2, t + step / 2, { gain: g * 0.4, decay: 0.6, dry: 0.2, pan: -Math.sin(n * 0.7) * 0.6 });
    if (t > at('kelp') && n % 8 === 0) tone(f / 2, t, { gain: 0.07, decay: 2.4, type: 'sine', dry: 0.5 });
  }
  // A bell voice on every cut of the dive.
  names.forEach((name, i) => {
    if (i >= 3) bell(Math.min(i - 3, 6), starts[i] + 0.12, name === 'angler' ? 0.35 : 0.7);
  });
  // Bait ball rush, sonar-like ping in the gorge, the bell woken on screen and its chord.
  noiseHit(at('baitball') + 2.2, 2.2, 400, 2400, 0.1, 0.7);
  tone(1180, at('gorge') + 2.5, { gain: 0.09, decay: 1.4, attack: 0.004, slide: 0.96 });
  const wake = at('bell') + 2.75;
  bell(4, wake, 1.6);
  for (let i = 0; i < 5; i++) tone(PENTA[i] * 0.5, wake + 1.2 + i * 0.18, { gain: 0.07, decay: 6, attack: 1.2, type: 'triangle' });
  tone(48, at('angler') + 0.3, { type: 'sawtooth', gain: 0.05, decay: 5, attack: 1.5, dry: 0.5 });
  tone(62, at('vents') + 0.2, { type: 'sawtooth', gain: 0.05, decay: 5, attack: 1.2, dry: 0.5 });
  // Whale song from the gate onward, then all seven bells under the end card.
  const w0 = at('gate') + 1.5;
  for (const [f, slide, when] of [[196, 1.5, 0], [147, 0.75, 4.2], [262, 1.33, 7.6], [131, 1.5, 11], [220, 0.67, 14.2], [175, 1.26, 17]]) {
    tone(f, w0 + when, { gain: 0.2, decay: 4.2, attack: 0.9, slide, vibrato: 0.012, dry: 0.15 });
    tone(f * 2.01, w0 + when, { gain: 0.04, decay: 3.6, attack: 1.2, slide, vibrato: 0.015, dry: 0.05 });
  }
  for (let i = 0; i < 7; i++) bell(i, total - 7.3 + i * 0.28, 0.6);
  for (const m of [0.5, 1, 1.5, 2]) tone(220 * m, total - 5.2, { type: 'triangle', gain: 0.07, decay: 5, attack: 1.2 });

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
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', `--window-size=${W},${H}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    '--allow-file-access-from-files'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(pathToFileURL(resolve(root, 'index.html')).href);
  await page.waitForFunction('window.__tb && document.getElementById("title").classList.contains("on")', { timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    window.__tb.paused = true;
  });
  const { total, starts, names, promptLen } = await page.evaluate(installDirector, FPS, facts);
  const frames = Math.round(total * FPS);
  console.log(`promo: ${total.toFixed(1)} s, ${frames} frames`);
  console.log(names.map((n, i) => `${n}@${starts[i].toFixed(1)}`).join('  '));

  if (stills) {
    // Still mode runs every shot's setup but only a sample of frames from each.
    for (let k = 0; k < starts.length; k++) {
      const first = Math.round(starts[k] * FPS);
      const end = Math.round((k + 1 < starts.length ? starts[k + 1] : total) * FPS) - 1;
      let picks = names[k] === 'blueprint' ? [0.3, 0.72] : names[k] === 'whale' ? [0.25, 0.85] : [0.55];
      if (only) picks = names[k] === only ? [0.15, 0.35, 0.6, 0.7, 0.8, 0.95] : [];
      let i = first;
      if (!picks.length) await page.evaluate((n) => window.__promo.frame(n), first); // still run the shot's setup
      for (const [j, p] of picks.entries()) {
        const target = Math.min(end, first + Math.round((end - first) * p));
        for (; i <= target; i += 2) await page.evaluate((n) => window.__promo.frame(n), i);
        writeFileSync(resolve(outDir, 'stills', `${lang === 'en' ? '' : `${lang}-`}${String(k).padStart(2, '0')}-${names[k]}${j ? `-${j}` : ''}.jpg`), await page.screenshot({ type: 'jpeg', quality: 90 }));
      }
      console.log(`still ${names[k]}`);
    }
  } else {
    const silent = resolve(outDir, `video-only-${lang}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
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
    const out = resolve(outDir, lang === 'en' ? 'tidebell-promo.mp4' : `tidebell-promo-${lang}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wavPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
    rmSync(silent);
    console.log(`wrote ${out}`);
  }
} finally {
  await browser.close();
}
