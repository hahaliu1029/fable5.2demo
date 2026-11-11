// Tiny local server: serves this folder and accepts POST /__shot?name=x to save a canvas capture
// into screenshots/. Only used during development and for the capture pass.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.env.PORT || 5179);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    // Local tool only: refuse other hosts (DNS rebinding) and cross-origin writes.
    const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
    if (!local.test(req.headers.host || '')) { res.writeHead(403).end(); return; }
    if (req.method === 'POST' && url.pathname === '/__shot') {
      const origin = req.headers.origin;
      if (origin && !local.test(origin.replace(/^https?:\/\//, ''))) { res.writeHead(403).end(); return; }
      const chunks = [];
      let size = 0;
      for await (const c of req) { size += c.length; if (size > 40e6) { res.writeHead(413).end(); return; } chunks.push(c); }
      const name = basename(url.searchParams.get('name') || 'shot').replace(/[^\w-]/g, '_');
      await mkdir(join(root, 'screenshots'), { recursive: true });
      await writeFile(join(root, 'screenshots', `${name}.png`), Buffer.concat(chunks));
      res.writeHead(200).end('ok');
      return;
    }
    const path = normalize(join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
