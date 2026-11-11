// Deterministic frame-by-frame capture: headless Chrome renders frame i at t = i / fps, the canvas is read
// back as PNG and piped into ffmpeg. Nothing depends on wall-clock time, so no frame can be dropped.
//   node capture.mjs                 -> scene.mp4 + stills/
//   node capture.mjs --stills-only   -> only the stills (fast iteration; QS / STILLS_DIR env allowed)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 30, DURATION = 10, FRAMES = FPS * DURATION, W = 1080, H = 1920;
const STILLS = { 30: 'still_t1s.png', 150: 'still_t5s.png', 270: 'still_t9s.png' }; // frame index -> file
const stillsOnly = process.argv.includes('--stills-only');
// Debug query strings (?dbg=, ?scale=) are only honoured for stills, never for the delivered video.
const QS = stillsOnly ? process.env.QS || '' : '';
const stillsDir = (stillsOnly && process.env.STILLS_DIR) || path.join(ROOT, 'stills');
mkdirSync(stillsDir, { recursive: true });
const OUT = path.join(ROOT, 'scene.mp4'), TMP = path.join(ROOT, 'scene.partial.mp4');

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', `--window-size=${W},${H}`, '--hide-scrollbars'],
});
let ff = null, ffExit = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  let pageError = null;
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' || /context lost/i.test(text)) pageError = text;
    console.log(`[page ${m.type()}]`, text);
  });
  page.on('pageerror', (e) => { pageError = e.message; console.error('[page error]', e.message); });
  await page.goto(pathToFileURL(path.join(ROOT, 'scene.html')).href + QS + '#capture');
  await page.waitForFunction('window.sceneReady === true', { timeout: 180000 });
  const info = await page.evaluate('window.__info');
  console.log('scene info:', JSON.stringify(info));
  if (pageError) throw new Error(`page reported an error: ${pageError}`);
  if (/swiftshader|llvmpipe|software/i.test(info.glRenderer)) throw new Error(`software GL renderer: ${info.glRenderer}`);
  if (!stillsOnly && (info.W !== W || info.H !== H || info.DBG !== 0)) throw new Error('scene is not in delivery configuration');

  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const grab = async (i) => {
    const png = Buffer.from(await page.evaluate((t) => {
      window.renderFrame(t);
      return window.__canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
    }, i / FPS), 'base64');
    if (pageError) throw new Error(`page reported an error at frame ${i}: ${pageError}`);
    // IHDR width/height live at byte offsets 16 and 20
    if (png.length < 10000 || !png.subarray(0, 4).equals(PNG_SIG) || png.readUInt32BE(16) !== info.W || png.readUInt32BE(20) !== info.H) {
      throw new Error(`frame ${i}: canvas readback is not a ${info.W}x${info.H} PNG`);
    }
    return png;
  };

  if (!stillsOnly) {
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-vf', 'scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-r', String(FPS),
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart', '-f', 'mp4', TMP], { stdio: ['pipe', 'inherit', 'inherit'] });
    ffExit = once(ff, 'close'); // attached immediately so an early ffmpeg exit is never missed
    ff.stdin.on('error', () => {}); // surfaced through the exit code instead
  }
  const t0 = Date.now(); // progress display only
  let written = 0;
  const frames = stillsOnly ? Object.keys(STILLS).map(Number) : [...Array(FRAMES).keys()];
  for (const i of frames) {
    const png = await grab(i);
    if (STILLS[i]) writeFileSync(path.join(stillsDir, STILLS[i]), png);
    if (ff) {
      if (ff.exitCode !== null) throw new Error(`ffmpeg exited early with ${ff.exitCode}`);
      if (!ff.stdin.write(png)) await once(ff.stdin, 'drain');
    }
    written++;
    if (written % 30 === 0 || stillsOnly) console.log(`frame ${i} (${written}/${frames.length}) ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  if (ff) {
    ff.stdin.end();
    const [code] = await ffExit;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    // Verify the encoded file itself, not just the number of writes, before replacing scene.mp4.
    const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
      'stream=codec_name,width,height,avg_frame_rate,nb_read_frames,pix_fmt', '-of', 'csv=p=0', TMP]).toString().trim();
    const want = `h264,${W},${H},yuv420p,${FPS}/1,${FRAMES}`;
    if (probe !== want) throw new Error(`encoded file check failed: got "${probe}", want "${want}"`);
    renameSync(TMP, OUT);
    console.log(`scene.mp4 verified: ${probe}`);
  }
} catch (e) {
  if (ff && ff.exitCode === null) ff.kill('SIGKILL');
  rmSync(TMP, { force: true });
  throw e;
} finally {
  await browser.close();
}
