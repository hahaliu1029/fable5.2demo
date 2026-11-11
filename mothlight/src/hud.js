// DOM heads-up display: counters, compass, minimap, prompts and typewriter messages.
import { DISTRICTS, N, HALF, blockCenter, districtOfBlock } from './city.js';

const $ = (id) => document.getElementById(id);
const css = (c, k = 1) => `rgb(${c.map((v) => Math.round(Math.min(1, v * k) * 255)).join(',')})`;

export class Hud {
  constructor(city) {
    this.city = city;
    this.map = $('map'); this.compass = $('compass');
    this.queue = []; this.typing = null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.map, this.compass]) { c.width = c.clientWidth * dpr || c.width; c.height = c.clientHeight * dpr || c.height; }
  }

  show(on) { $('hud').classList.toggle('on', on); }

  counters(state) {
    $('c-echo').textContent = `${state.collected.size}/12`;
    $('c-dist').textContent = `${state.districts.size}/5`;
  }

  district(d) {
    $('district').textContent = DISTRICTS[d].name;
    $('district-tag').textContent = DISTRICTS[d].tag;
    $('district').style.color = css(DISTRICTS[d].color, 1.15);
  }

  banner(title, sub) {
    const el = $('banner');
    $('banner-title').textContent = title; $('banner-sub').textContent = sub;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  prompt(text) { const el = $('prompt'); el.textContent = text || ''; el.classList.toggle('on', !!text); }

  status(kmh, mode, boost) {
    $('alt').textContent = `${String(Math.round(kmh)).padStart(3, '0')} KM/H`;
    $('mode').textContent = mode;
    $('scan').textContent = boost > 0.25 ? 'BOOST READY [SHIFT]' : 'BOOST CHARGING';
    $('scan').classList.toggle('dim', boost <= 0.25);
    $('kmh').textContent = Math.round(kmh);
    $('boostbar').firstElementChild.style.width = `${Math.round(boost * 100)}%`;
  }
  time(text) { $('c-logs').textContent = text; }

  // Queue a typewriter message; lines appear one after another.
  say(title, lines, hold = 3200) {
    for (const text of [].concat(lines)) this.queue.push({ title, text, hold });
  }

  clear() { this.queue.length = 0; this.typing = null; $('msg').classList.remove('on'); }

  update(dt) {
    if (!this.typing && this.queue.length) {
      this.typing = { ...this.queue.shift(), n: 0, t: 0 };
      $('msg-title').textContent = this.typing.title;
      $('msg').classList.add('on');
    }
    const m = this.typing;
    if (!m) return;
    m.t += dt;
    const n = Math.min(m.text.length, Math.floor(m.t * 55));
    if (n !== m.n) { m.n = n; $('msg-text').textContent = m.text.slice(0, n); }
    if (m.t > m.text.length / 55 + m.hold / 1000) {
      this.typing = null;
      if (!this.queue.length) $('msg').classList.remove('on');
    }
  }

  drawCompass(yaw, target) {
    const c = this.compass, g = c.getContext('2d'), w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    const heading = -yaw; // radians clockwise from north
    const span = Math.PI * 0.9;
    const xOf = (bearing) => {
      let d = bearing - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return Math.abs(d) < span / 2 ? w / 2 + (d / (span / 2)) * (w / 2) : null;
    };
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 0; k < 24; k++) {
      const x = xOf((k * Math.PI) / 12);
      if (x === null) continue;
      const edge = 1 - Math.abs(x - w / 2) / (w / 2);
      g.globalAlpha = Math.min(1, edge * 2.5);
      if (k % 6 === 0) {
        g.fillStyle = k === 0 ? '#ff4d9d' : '#bff6ff';
        g.font = `600 ${h * 0.5}px ui-monospace, Menlo, monospace`;
        g.fillText('NESW'[k / 6], x, h * 0.42);
      } else {
        g.fillStyle = 'rgba(160,230,255,0.55)';
        g.fillRect(x - 1, h * (k % 3 === 0 ? 0.25 : 0.38), 2, h * (k % 3 === 0 ? 0.4 : 0.16));
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(160,230,255,0.8)';
    g.fillRect(w / 2 - 1, h * 0.82, 2, h * 0.18);
    if (target) {
      const bearing = Math.atan2(target.dx, -target.dz);
      let d = bearing - heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      const x = w / 2 + Math.max(-1, Math.min(1, d / (span / 2))) * (w / 2 - 8);
      g.fillStyle = target.color; g.shadowColor = target.color; g.shadowBlur = 10;
      g.beginPath(); g.moveTo(x, h * 0.62); g.lineTo(x + 7, h * 0.8); g.lineTo(x, h * 0.98); g.lineTo(x - 7, h * 0.8); g.closePath(); g.fill();
      g.shadowBlur = 0;
    }
  }

  drawMap(player, state, t) {
    const c = this.map, g = c.getContext('2d'), w = c.width;
    const k = w / (2 * HALF + 40), o = w / 2;
    const X = (x) => o + x * k;
    g.clearRect(0, 0, w, w);
    g.fillStyle = 'rgba(4,8,16,0.72)'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const d = districtOfBlock(i, j), known = state.districts.has(d);
      g.fillStyle = known ? css(DISTRICTS[d].color, 0.5) : 'rgba(120,140,170,0.16)';
      g.globalAlpha = known ? 0.75 : 1;
      g.fillRect(X(blockCenter(i) - 30), X(blockCenter(j) - 30), 60 * k, 60 * k);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#e8fbff'; g.fillRect(X(-9), X(-9), 18 * k, 18 * k);
    this.city.shards.forEach((s, i) => {
      if (state.collected.has(i) || !state.revealed.has(i)) return;
      const r = (5 + 2 * Math.sin(t * 4 + i)) * k;
      g.fillStyle = '#5ff2ff'; g.shadowColor = '#5ff2ff'; g.shadowBlur = 8;
      g.beginPath(); g.arc(X(s.x), X(s.z), r, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    });
    // The run: remaining gates joined in order, then home to the Spire.
    const route = this.city.route;
    if (route) {
      const n = state.collected.size, pts = route.gates.slice(n);
      g.strokeStyle = 'rgba(95,242,255,0.55)'; g.lineWidth = 1.2; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(X(player.x), X(player.z));
      for (const p of pts) g.lineTo(X(p.x), X(p.z));
      if (!state.finale) g.lineTo(X(route.finish.x), X(route.finish.z));
      g.stroke(); g.setLineDash([]);
      pts.forEach((p, i) => { if (i === 0) return; g.fillStyle = 'rgba(255,77,157,0.85)'; g.fillRect(X(p.x) - 2, X(p.z) - 2, 4, 4); });
    }
    // Player arrow (yaw 0 faces north = up).
    g.save();
    g.translate(X(player.x), X(player.z)); g.rotate(-player.yaw);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#ff2d95'; g.lineWidth = 1.5;
    const a = Math.max(5, 9 * k);
    g.beginPath(); g.moveTo(0, -a * 1.5); g.lineTo(a, a); g.lineTo(0, a * 0.45); g.lineTo(-a, a); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}
