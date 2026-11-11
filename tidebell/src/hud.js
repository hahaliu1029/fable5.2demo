// DOM overlay: depth gauge, bell tally, zone cards, prompts, toasts, sonar markers and the logbook.
import * as THREE from 'three';
import { SPECIES, BELL_COUNT } from './game.js';
import { BELL_COLORS } from './world.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    hud: $('hud'), title: $('title'), loading: $('loading'), depth: $('depthNum'), zone: $('zoneName'), gauge: $('gauge'), rating: $('rating'),
    bells: $('bells'), zonecard: $('zonecard'), story: $('story'), prompt: $('prompt'), toasts: $('toasts'), warn: $('warn'), markers: $('markers'),
    logbook: $('logbook'), logGrid: $('logGrid'), logCount: $('logCount'), finale: $('finale'),
  };
  const pips = [];
  const markers = [];
  for (let i = 0; i < BELL_COUNT; i++) {
    const s = document.createElement('span');
    s.style.setProperty('--c', `#${BELL_COLORS[i].getHexString()}`);
    el.bells.appendChild(s);
    pips.push(s);
    const m = document.createElement('div');
    m.className = 'marker';
    m.style.setProperty('--c', `#${BELL_COLORS[i].getHexString()}`);
    m.innerHTML = '<i></i><span></span>';
    el.markers.appendChild(m);
    markers.push(m);
  }
  let zoneTimer = 0;
  let storyTimer = 0;
  let lastDepth = -1;
  let promptKey = '';
  let markersShown = false;
  const v = new THREE.Vector3();

  return {
    ready() {
      el.loading.style.opacity = 0;
      setTimeout(() => el.loading.remove(), 1300);
      el.title.classList.add('on');
    },
    onStart(fn) {
      el.title.addEventListener('click', fn);
    },
    begin() {
      el.title.classList.remove('on');
      el.hud.classList.add('on');
    },
    toggleHidden() {
      el.hud.classList.toggle('hidden');
    },
    depth(d, limit, over) {
      const n = Math.max(0, Math.round(d));
      if (n !== lastDepth) {
        lastDepth = n;
        el.depth.textContent = n;
      }
      const cap = Number.isFinite(limit) ? limit : 210;
      el.gauge.firstElementChild.style.width = `${Math.min(100, (d / cap) * 100)}%`;
      el.gauge.classList.toggle('warn', over > 0 || d > cap * 0.93);
      el.warn.classList.toggle('on', over > 0.5);
    },
    rating(limit) {
      el.rating.textContent = Number.isFinite(limit) ? `HULL RATED TO ${limit} M` : 'HULL RATED FOR ANY DEPTH';
    },
    bells(set) {
      pips.forEach((p, i) => p.classList.toggle('awake', set.has(i)));
    },
    zone(z) {
      el.zone.textContent = z.name;
      el.zonecard.querySelector('h2').textContent = z.name.toUpperCase();
      el.zonecard.querySelector('p').textContent = z.sub;
      el.zonecard.classList.add('on');
      clearTimeout(zoneTimer);
      zoneTimer = setTimeout(() => el.zonecard.classList.remove('on'), 5200);
    },
    story(text, ms = 9000) {
      el.story.textContent = text;
      el.story.classList.add('on');
      clearTimeout(storyTimer);
      storyTimer = setTimeout(() => el.story.classList.remove('on'), ms);
    },
    prompt(key, text, progress = 0) {
      if (!text) {
        el.prompt.classList.remove('on');
        promptKey = '';
        return;
      }
      if (promptKey !== key + text) {
        promptKey = key + text;
        el.prompt.innerHTML = `<b>${key}</b>${text}<i></i>`;
      }
      el.prompt.lastElementChild.style.width = `${progress * 100}%`;
      el.prompt.classList.add('on');
    },
    toast(label, name, note) {
      const t = document.createElement('div');
      t.className = 'toast';
      t.innerHTML = `<div class="caps"></div><div class="name"></div><div class="note"></div>`;
      t.children[0].textContent = label;
      t.children[1].textContent = name;
      t.children[2].textContent = note ?? '';
      el.toasts.appendChild(t);
      setTimeout(() => t.remove(), 7200);
      while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
    },
    // Project dormant bells to the screen while a sonar reading is fresh.
    markers(bells, camera, active, from) {
      if (!active) {
        if (markersShown) for (const m of markers) m.classList.remove('on');
        markersShown = false;
        return;
      }
      markersShown = true;
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Only the two nearest sleeping bells, so the reading points somewhere useful.
      const nearest = bells.filter((b) => !b.awake).sort((a, b) => a.pos.distanceToSquared(from) - b.pos.distanceToSquared(from)).slice(0, 2);
      bells.forEach((b, i) => {
        const m = markers[i];
        const show = active && nearest.includes(b);
        m.classList.toggle('on', show);
        if (!show) return;
        v.copy(b.pos).project(camera);
        const behind = v.z > 1;
        let x = v.x;
        let y = v.y;
        if (behind) {
          // Behind the camera the projection is mirrored: flip it and pin the marker to the screen edge.
          x = -x;
          y = -y;
          const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86);
          if (k < 1e-4) {
            x = 0;
            y = -0.86;
          } else {
            x /= k;
            y /= k;
          }
        } else {
          const k = Math.max(1, Math.abs(x) / 0.92, Math.abs(y) / 0.86);
          x /= k;
          y /= k;
        }
        m.style.transform = `translate(${((x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-y * 0.5 + 0.5) * h).toFixed(1)}px)`;
        m.lastElementChild.textContent = `${Math.round(b.pos.distanceTo(from))} M`;
      });
    },
    logbook(open, log) {
      el.logbook.classList.toggle('on', open);
      if (!open) return;
      const ids = Object.keys(SPECIES);
      el.logCount.textContent = `${log.size} of ${ids.length} recorded`;
      el.logGrid.replaceChildren(...ids.map((id) => {
        const d = document.createElement('div');
        const known = log.has(id);
        d.className = `entry${known ? '' : ' unknown'}`;
        d.innerHTML = '<div class="name"></div><div class="note"></div>';
        d.children[0].textContent = known ? SPECIES[id].name : '— — —';
        d.children[1].textContent = known ? SPECIES[id].note : 'Not yet seen.';
        return d;
      }));
    },
    finale() {
      el.finale.classList.add('on');
      setTimeout(() => el.finale.classList.remove('on'), 16000);
    },
  };
}
