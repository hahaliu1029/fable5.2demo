// Cuts the two game films into one complete promo, in English and Chinese.
//   node fable-promo/make.mjs          (run from the fabletest folder; needs Chrome, ffmpeg and the four source films)
// Structure: opening card -> Tidebell and 青云宗 films, each cut before its own end card -> the Mothlight film, whose end card closes the piece.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const root = resolve(here, '..');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TIDE_CUT = 95.0; // the Tidebell film's own end card starts fading in here
const QING_CUT = 50.1; // likewise for the 青云宗 film
const CARD = 4.0;
const TEXT = {
  en: { top: 'a showcase', sub: 'Three requests, shown exactly as they were typed. Everything after them was made by the model.',
    serif: '"Iowan Old Style", Palatino, Georgia, serif', sans: '"Avenir Next", system-ui, sans-serif', italic: 'italic', sp: '.34em' },
  zh: { top: '能力展示', sub: '三句需求，原样呈现。其后的一切，皆由模型完成。',
    serif: '"Songti SC", "STSong", serif', sans: '"PingFang SC", system-ui, sans-serif', italic: 'normal', sp: '.5em' },
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--window-size=1920,1080', '--hide-scrollbars'] });
try {
  for (const lang of ['en', 'zh']) {
    const T = TEXT[lang];
    const tide = resolve(root, 'tidebell/promo', lang === 'en' ? 'tidebell-promo.mp4' : 'tidebell-promo-zh.mp4');
    const qing = resolve(root, 'game/promo', lang === 'en' ? 'qingyun-promo.mp4' : 'qingyun-promo-zh.mp4');
    const moth = resolve(root, 'mothlight/promo', lang === 'en' ? 'mothlight-promo.mp4' : 'mothlight-promo-zh.mp4');
    for (const f of [tide, qing, moth]) if (!existsSync(f)) throw new Error(`missing source film: ${f}`);
    // Opening card, drawn by the browser so it shares the films' typography.
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setContent(`<body style="margin:0;height:100vh;background:#01060a;color:#f6efe0;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <div style="font-family:${T.sans};letter-spacing:${T.sp};text-transform:uppercase;font-size:20px;color:#f2c25a">${T.top}</div>
      <h1 style="font-family:'Iowan Old Style',Palatino,Georgia,serif;font-weight:400;font-size:150px;letter-spacing:.14em;margin:26px 0 0 .14em;text-shadow:0 0 60px rgba(242,194,90,.4)">CLAUDE FABLE 5.2</h1>
      <div style="font-family:${T.serif};font-style:${T.italic};font-size:36px;margin-top:38px;color:#d9d2c2">${T.sub}</div></body>`);
    const png = resolve(here, `card-${lang}.png`);
    writeFileSync(png, await page.screenshot({ type: 'png' }));
    await page.close();

    const out = resolve(here, lang === 'en' ? 'fable-5.2-promo.mp4' : 'fable-5.2-promo-zh.mp4');
    const fc = [
      `[0:v]fps=30,format=yuv420p,fade=t=in:st=0:d=0.9,fade=t=out:st=${CARD - 0.7}:d=0.7[v0]`,
      `[1:a]atrim=0:${CARD},asetpts=PTS-STARTPTS[a0]`,
      `[2:v]trim=0:${TIDE_CUT},setpts=PTS-STARTPTS,fps=30,format=yuv420p,fade=t=out:st=${TIDE_CUT - 0.9}:d=0.9[v1]`,
      `[2:a]atrim=0:${TIDE_CUT},asetpts=PTS-STARTPTS,aresample=44100,afade=t=out:st=${TIDE_CUT - 2.2}:d=2.2[a1]`,
      `[3:v]trim=0:${QING_CUT},setpts=PTS-STARTPTS,fps=30,format=yuv420p,fade=t=out:st=${QING_CUT - 0.9}:d=0.9[v2]`,
      `[3:a]atrim=0:${QING_CUT},asetpts=PTS-STARTPTS,aresample=44100,afade=t=out:st=${QING_CUT - 2.2}:d=2.2[a2]`,
      `[4:v]setpts=PTS-STARTPTS,fps=30,format=yuv420p[v3]`,
      `[4:a]asetpts=PTS-STARTPTS,aresample=44100[a3]`,
      `[v0][a0][v1][a1][v2][a2][v3][a3]concat=n=4:v=1:a=1[v][a]`,
    ].join(';');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-t', String(CARD), '-i', png, '-f', 'lavfi', '-t', String(CARD), '-i', 'anullsrc=r=44100:cl=stereo',
      '-i', tide, '-i', qing, '-i', moth, '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'inherit' });
    rmSync(png);
    console.log(`wrote ${out}`);
  }
} finally {
  await browser.close();
}
