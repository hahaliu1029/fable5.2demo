// Automated playthrough. Drives the real game in headless Chrome with fixed 1/30 s steps (no wall clock), using
// the in-page autopilot for input. It:
//   1. checks the level layout and the input / collision / ripple mechanics with real keyboard events,
//   2. plays the whole game once without rendering to learn how many frames a full run takes,
//   3. replays the identical run, taking the title / mid-game / completion screenshots and recording the final
//      15 seconds (last orbs -> plaque lights up -> flight through the gate -> completion screen) to gameplay.mp4,
//   4. renders the matching soundtrack offline with the game's own Web Audio code and muxes it in,
//   5. clicks the restart button and checks the game resets.
//   node tools/playthrough.mjs [--no-video]
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1080, H = 1920, FPS = 30, DT = 1 / FPS, CLIP_S = 15, TITLE_FRAMES = 45, TAIL_FRAMES = 60, MAX_FRAMES = FPS * 600;
const noVideo = process.argv.includes('--no-video');
const shots = path.join(ROOT, 'screenshots');
mkdirSync(shots, { recursive: true });
const URL_BASE = pathToFileURL(path.join(ROOT, 'index.html')).href;
const assert = (cond, msg) => { if (!cond) throw new Error(`CHECK FAILED: ${msg}`); console.log(`  ok  ${msg}`); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', `--window-size=${W},${H}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
let ff = null;
const TMP_V = path.join(ROOT, 'gameplay.video.mp4'), TMP_A = path.join(ROOT, 'gameplay.audio.wav'), TMP_O = path.join(ROOT, 'gameplay.partial.mp4');
try {
  let pageError = null;
  const noErr = (where) => { if (pageError) throw new Error(`page error during ${where}: ${pageError}`); };
  // the rendered canvas must be a real picture: not black, not blown out, not flat
  const pixelCheck = async (page, what) => {
    const { mean, sd } = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 54; c.height = 96;
      const g = c.getContext('2d'); g.drawImage(document.getElementById('c'), 0, 0, 54, 96);
      const d = g.getImageData(0, 0, 54, 96).data; let s = 0, s2 = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { const l = 0.3 * d[i] + 0.6 * d[i + 1] + 0.1 * d[i + 2]; s += l; s2 += l * l; }
      return { mean: s / n, sd: Math.sqrt(s2 / n - (s / n) ** 2) };
    });
    assert(mean > 25 && mean < 235 && sd > 12, `${what} frame is a real image (mean ${mean.toFixed(0)}, contrast ${sd.toFixed(0)})`);
  };
  async function open(query, hasTouch = false) {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, hasTouch });
    page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /context lost|GL_INVALID|framebuffer|WebGL:/i.test(t)) pageError = t; if (m.type() !== 'log') console.log(`[page ${m.type()}]`, t); });
    page.on('pageerror', (e) => { pageError = e.message; console.error('[page error]', e.message); });
    await page.goto(`${URL_BASE}?${query}`);
    await page.waitForFunction('window.__ready === true', { timeout: 120000 });
    if (pageError) throw new Error(`page error: ${pageError}`);
    return page;
  }
  const state = (page) => page.evaluate(() => window.__game.state());
  const stepN = (page, n, render = false) => page.evaluate((n, dt, render) => { for (let i = 0; i < n; i++) window.__game.step(dt, render && i === n - 1); return window.__game.state(); }, n, DT, render);
  // step one frame with rendering, wait for the compositor, return a PNG of the whole page (canvas + HUD)
  async function frame(page) {
    await page.evaluate((dt) => { window.__game.step(dt, true); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, DT);
    return page.screenshot({ type: 'png' });
  }

  // ---- 1. mechanics checks with real keyboard input (no autopilot)
  console.log('mechanics checks');
  {
    const page = await open('capture&ss=1');
    const info = await page.evaluate(() => window.__game.info());
    console.log('  info:', JSON.stringify(info));
    assert(!/swiftshader|llvmpipe|software/i.test(info.glRenderer), 'hardware GL renderer');
    const bad = await page.evaluate(() => window.__game.validate());
    assert(bad.length === 0, `level layout is valid (${bad.join('; ') || 'no orb inside a collider'})`);
    assert((await state(page)).mode === 'title', 'boots to the title screen');
    await page.click('#startBtn');
    let s = await state(page);
    assert(s.mode === 'play' && s.count === 0, 'start button begins a run');
    await page.keyboard.down('KeyW'); s = await stepN(page, 45);
    assert(s.fwd > 15 && s.pos[2] < 55, `W accelerates forward (speed ${s.fwd.toFixed(1)})`);
    assert(s.ripples > 0, `skimming the lake leaves ripples (${s.ripples} active)`);
    for (let i = 0; i < 120 && s.pos[2] > -3; i++) s = await stepN(page, 1);
    assert(s.pos[2] < 0 && s.mode === 'play' && !s.unlocked, 'flying through the gate before it is unlocked does not end the run');
    await page.keyboard.up('KeyW');
    const y0 = s.pos[1]; await page.keyboard.down('Space'); s = await stepN(page, 30); await page.keyboard.up('Space');
    assert(s.pos[1] > y0 + 4, `Space rises (${y0.toFixed(1)} -> ${s.pos[1].toFixed(1)})`);
    const y1 = s.pos[1]; await page.keyboard.down('ShiftLeft'); s = await stepN(page, 20); await page.keyboard.up('ShiftLeft');
    assert(s.pos[1] < y1 - 1.5, `Shift dives (${y1.toFixed(1)} -> ${s.pos[1].toFixed(1)})`);
    const yaw0 = await page.evaluate(() => window.__game.G.yaw); await page.keyboard.down('ArrowLeft'); await stepN(page, 15); await page.keyboard.up('ArrowLeft');
    assert((await page.evaluate(() => window.__game.G.yaw)) > yaw0 + 0.5, 'arrow keys steer');
    // place the player in front of a floating rock (test set-up only), then fly into it with W
    await page.evaluate(() => { const g = window.__game, r = g.rocks[1].g.position; g.G.pos.set(r.x, r.y, r.z + 14); g.G.yaw = 0; g.G.fwd = 0; g.G.vy = 0; });
    await page.keyboard.down('KeyW');
    let hit = null;
    for (let i = 0; i < 90 && !hit; i++) { s = await stepN(page, 1); if (s.hits > 0) hit = s; }
    await page.keyboard.up('KeyW');
    assert(!!hit, 'flying into a floating rock registers a hit');
    assert(hit.shake > 0.3, `the hit starts a screen shake (${hit.shake.toFixed(2)} s)`);
    const zHit = hit.pos[2]; s = await stepN(page, 12);
    assert(s.pos[2] > zHit + 2, `the hit knocks the player back (${(s.pos[2] - zHit).toFixed(1)} m)`);
    assert(await page.evaluate(() => window.__game.audio.log.some((e) => e.name === 'hit')), 'the hit plays a sound');
    assert((await state(page)).audio === 'running', 'the Web Audio context is running after the start click');
    noErr('keyboard checks'); await page.close();
    // touch: virtual stick and the rise button, driven by real touch events
    const tp = await open('capture&ss=1', true);
    assert(await tp.evaluate(() => !document.getElementById('touch').classList.contains('hidden')), 'touch controls are shown on a touch device');
    await tp.tap('#startBtn');
    const jb = await (await tp.$('#joy')).boundingBox(), ub = await (await tp.$('#btnUp')).boundingBox();
    await tp.touchscreen.touchStart(jb.x + jb.width / 2, jb.y + 8);
    s = await stepN(tp, 30);
    assert(s.mode === 'play' && s.fwd > 10, `pushing the touch stick forward accelerates (speed ${s.fwd.toFixed(1)})`);
    await tp.touchscreen.touchEnd();
    const ty = (await state(tp)).pos[1];
    await tp.touchscreen.touchStart(ub.x + ub.width / 2, ub.y + ub.height / 2); s = await stepN(tp, 30); await tp.touchscreen.touchEnd();
    assert(s.pos[1] > ty + 4, `holding the rise button climbs (${ty.toFixed(1)} -> ${s.pos[1].toFixed(1)})`);
    noErr('touch checks'); await tp.close();
  }

  // ---- 2. dry run: how long does a full autopilot playthrough take?
  console.log('dry run (logic only)');
  let page = await open('capture&bot&ss=2');
  await stepN(page, TITLE_FRAMES);
  await page.click('#startBtn');
  let total = 0, midFrame = -1, st;
  while (total < MAX_FRAMES) {
    st = await stepN(page, 30); total += 30;
    if (midFrame < 0 && st.count >= 10) midFrame = total;
    if (st.mode === 'done') break;
  }
  assert(st.mode === 'done', `autopilot finishes the game (${st.time.toFixed(1)} s game time, ${st.hits} rock hits, ${st.bumps} gate bumps)`);
  assert(st.count === 20 && st.unlocked && st.glow > 0.99, 'all 20 orbs collected and the plaque is lit');
  // exact frame on which the run ended
  await page.close(); page = await open('capture&bot&ss=2');
  await stepN(page, TITLE_FRAMES); await page.click('#startBtn');
  await stepN(page, total - 30);
  let doneFrame = total - 30;
  while ((await state(page)).mode !== 'done') { await stepN(page, 1); doneFrame++; }
  const finalTime = (await state(page)).time;
  noErr('dry run'); await page.close();
  const endFrame = doneFrame + TAIL_FRAMES, clipStart = endFrame - CLIP_S * FPS;
  console.log(`  run ends on frame ${doneFrame}; recording frames ${clipStart}..${endFrame - 1}`);
  assert(clipStart > 0 && midFrame > 0 && midFrame < clipStart, 'run is longer than the clip');

  // ---- 3. replay with rendering
  console.log('replay with capture');
  page = await open('capture&bot&ss=2');
  for (let i = 0; i < TITLE_FRAMES - 1; i++) await stepN(page, 1);
  writeFileSync(path.join(shots, 'title.png'), await frame(page)); await pixelCheck(page, 'title');
  await page.click('#startBtn');
  await stepN(page, midFrame - 1);
  writeFileSync(path.join(shots, 'midgame.png'), await frame(page)); await pixelCheck(page, 'mid-game');
  await stepN(page, clipStart - midFrame);
  if (!noVideo) {
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-vf', `scale=${W}:${H}:in_range=full:out_range=limited:out_color_matrix=bt709,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-r', String(FPS),
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-f', 'mp4', TMP_V], { stdio: ['pipe', 'inherit', 'inherit'] });
    ff.stdin.on('error', () => {});
  }
  const ffExit = ff ? once(ff, 'close') : null;
  const t0 = Date.now(); // progress display only
  const clipT0 = (await state(page)).t;
  let last = null;
  for (let f = clipStart; f < endFrame; f++) {
    last = await frame(page);
    if (pageError) throw new Error(`page error at frame ${f}: ${pageError}`);
    if (ff) { if (ff.exitCode !== null) throw new Error('ffmpeg exited early'); if (!ff.stdin.write(last)) await once(ff.stdin, 'drain'); }
    if ((f - clipStart + 1) % 90 === 0) console.log(`  frame ${f - clipStart + 1}/${CLIP_S * FPS} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  writeFileSync(path.join(shots, 'complete.png'), last); await pixelCheck(page, 'completion');
  st = await state(page);
  assert(st.mode === 'done' && Math.abs(st.time - finalTime) < 1e-9, `replay is deterministic (same finish time ${st.time.toFixed(3)} s)`);
  assert(await page.evaluate(() => !document.getElementById('done').classList.contains('hidden') && /\d\d:\d\d\.\d/.test(document.getElementById('doneTime').textContent)), 'completion screen shows the time');

  if (ff) {
    ff.stdin.end();
    const [code] = await ffExit;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    // ---- 4. soundtrack for the same 15 s window, rendered by the game's own audio code
    const wav = await page.evaluate((t0, dur) => window.__game.renderOffline(window.__game.audio.log, t0, dur), clipT0, CLIP_S);
    writeFileSync(TMP_A, Buffer.from(wav, 'base64'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', TMP_V, '-i', TMP_A, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', '-f', 'mp4', TMP_O]);
    const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
      'stream=codec_name,width,height,avg_frame_rate,nb_read_frames,pix_fmt', '-of', 'csv=p=0', TMP_O]).toString().trim();
    const want = `h264,${W},${H},yuv420p,${FPS}/1,${CLIP_S * FPS}`;
    assert(probe === want, `gameplay.mp4 is ${want} (got ${probe})`);
    renameSync(TMP_O, path.join(ROOT, 'gameplay.mp4'));
  }

  // ---- 5. restart
  await page.click('#restartBtn');
  st = await stepN(page, 2);
  assert(st.mode === 'play' && st.count === 0 && !st.unlocked && st.time < 0.2, 'restart button resets the run');
  assert(await page.evaluate(() => document.getElementById('done').classList.contains('hidden')), 'completion screen is dismissed on restart');
  noErr('restart');
  console.log(JSON.stringify({ result: 'PASS', gameTime: finalTime, frames: doneFrame, midFrame, clipStart }));
} catch (e) {
  if (ff && ff.exitCode === null) ff.kill('SIGKILL');
  throw e;
} finally {
  for (const f of [TMP_V, TMP_A, TMP_O]) rmSync(f, { force: true });
  await browser.close();
}
