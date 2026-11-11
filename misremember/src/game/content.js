// Everything loose in the house: the props that drift, the Host's notes, and what each drift value looks like.
import * as THREE from 'three';
import { toThree, wallYaw } from './world.js';
import { NOTES } from '../core/story.js';

const INK = '#2a2317';

function noteTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#e6d57c'; g.fillRect(0, 0, 512, 384);
  const grad = g.createLinearGradient(0, 0, 0, 384);
  grad.addColorStop(0, 'rgba(255,255,255,.18)'); grad.addColorStop(1, 'rgba(120,90,0,.14)');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 384);
  const lines = text.split('\n');
  let size = 78;
  const font = (s) => `600 ${s}px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive`;
  g.font = font(size);
  while (size > 26 && (Math.max(...lines.map((l) => g.measureText(l).width)) > 452 || lines.length * size * 1.2 > 330)) { size -= 3; g.font = font(size); }
  g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.translate(256, 192); g.rotate(-0.025);
  lines.forEach((l, i) => g.fillText(l, 0, (i - (lines.length - 1) / 2) * size * 1.2));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function dialTexture(hours, small = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#ece6d4'; g.beginPath(); g.arc(256, 256, 256, 0, 7); g.fill();
  g.fillStyle = '#1b1814'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${small ? 70 : hours > 12 ? 50 : 56}px Georgia, serif`;
  for (let i = 1; i <= hours; i++) {
    const a = (i / hours) * Math.PI * 2;
    if (small && i % 3) { g.fillRect(256 + Math.sin(a) * 205 - 4, 256 - Math.cos(a) * 205 - 4, 8, 8); continue; }
    g.fillText(String(i), 256 + Math.sin(a) * 196, 256 - Math.cos(a) * 196 + 3);
  }
  for (let i = 0; i < hours * 5; i++) {
    const a = (i / (hours * 5)) * Math.PI * 2;
    g.save(); g.translate(256, 256); g.rotate(a); g.fillRect(-1.5, -250, 3, i % 5 ? 10 : 20); g.restore();
  }
  g.beginPath(); g.arc(256, 256, 9, 0, 7); g.fill();
  return c;
}

export function populate(world, assets) {
  const templates = {};
  for (const node of [...assets.props.children]) templates[node.name] = node;
  const R = world.rooms;

  const spawn = (roomName, prop, own = {}) => {
    const room = R[roomName];
    const obj = templates[prop].clone(true);
    obj.traverse((m) => {
      if (!m.isMesh) return;
      const n = m.material.name;
      m.material = own[n] ?? room.mats.lit(n);
    });
    room.group.add(obj);
    return obj;
  };
  const put = (obj, x, y, z, yaw = 0) => { obj.position.copy(toThree(x, y, z)); obj.rotation.y = yaw; return obj; };
  const picture = (roomName, name) => {
    const t = assets.tex(name, { wrap: 'clamp' });
    return R[roomName].mats.register(new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
  };

  // ------------------------------------------------------------ notes
  const notes = {};
  const addNote = (id, roomName, [x, y, z], { wall = null, yaw = 0, text = NOTES[id], show = true, ask = false, size = 0.19 } = {}) => {
    const mat = R[roomName].mats.register(new THREE.MeshStandardMaterial({ map: noteTexture(text), roughness: 0.9 }));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.75), mat);
    if (wall) { mesh.rotation.y = wallYaw(wall); mesh.position.copy(toThree(x + wall[0] * 0.007, y + wall[1] * 0.007, z)); }
    else { mesh.rotation.set(-Math.PI / 2, yaw, 0, 'YXZ'); mesh.position.copy(toThree(x, y, z + 0.004)); }
    mesh.visible = show;
    R[roomName].group.add(mesh);
    notes[id] = { id, room: roomName, pos: [x, y, z], mesh, mat, text, show, ask, read: false };
    return notes[id];
  };
  const setNote = (id, text, show = true, ask = false) => {
    const n = notes[id];
    if (!n) return;
    if (text && text !== n.text) { n.mat.map.dispose(); n.mat.map = noteTexture(text); n.text = text; n.read = false; }
    n.show = show; n.ask = ask; n.mesh.visible = show;
  };

  addNote('welcome', 'hall', [1.6, 2.3, 0.77], { yaw: -Math.PI / 2 });
  addNote('behind', 'hall', [0.9, 7.4, 1.45], { wall: [0, -1], show: false, size: 0.24 });
  addNote('dinner', 'kitchen', [2.2, 2.08, 0.74], { yaw: Math.PI / 2 - 0.15, ask: true });
  addNote('tired', 'kitchen', [4.4, 2.0, 1.45], { wall: [-1, 0], show: false, size: 0.24 });
  addNote('thanks', 'kitchen', [1.85, 2.3, 0.74], { yaw: Math.PI / 2 + 0.3, show: false });
  addNote('bed', 'bedroom', [1.9, 2.5, 0.527], { yaw: 0.1 });
  addNote('nothing', 'bedroom', [3.0, 0, 1.45], { wall: [0, 1], size: 0.24 });
  addNote('true', 'nook', [0.8, 0, 1.35], { wall: [0, 1], size: 0.24 });
  // evening two
  addNote('evening2', 'bedroom', [3.25, 1.98, 0.74], { yaw: -Math.PI / 2, show: false });
  addNote('doors', 'hall', [0.9, 7.4, 1.45], { wall: [0, -1], show: false, size: 0.24 });
  addNote('count', 'kitchen', [2.2, 2.3, 0.74], { yaw: Math.PI / 2, text: '...', show: false, size: 0.22 });
  addNote('pantry', 'kitchen', [1.3, 0, 1.45], { wall: [0, 1], show: false, size: 0.26 });
  addNote('three', 'pantry', [0.2, 2.3, 1.4], { wall: [0, -1], size: 0.22 });
  addNote('her', 'kitchen', [2.2, 0, 1.5], { wall: [0, 1], show: false, size: 0.26 });

  // soft contact shadow for loose furniture, so it sits in the baked light instead of floating on it
  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = blobCanvas.height = 128;
  {
    const g = blobCanvas.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,.55)'); grad.addColorStop(0.55, 'rgba(0,0,0,.28)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  }
  const blobTex = new THREE.CanvasTexture(blobCanvas);
  const blob = (roomName, size) => {
    const mat = R[roomName].mats.register(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.004;
    return m;
  };

  // ------------------------------------------------------------ kitchen
  const chairs = [];
  const settings = [];
  const SEATS = [
    [1.85, 1.62, 90], [2.55, 2.98, -90], [2.55, 1.62, 90], [1.85, 2.98, -90], // the four that were always there
    [1.2, 2.3, 0], [3.2, 2.3, 180], // the heads of the table
    [0.42, 0.42, 225], [4.0, 2.75, 0], // one facing the corner, one facing the wall
  ];
  const baseColliders = R.kitchen.colliders.length;
  let laid = false; // from the second evening a place is laid for every chair at the table
  let chairCount = 4;
  const setChairs = (n) => {
    chairCount = n;
    while (chairs.length < n) { const c = spawn('kitchen', 'chair'); c.add(blob('kitchen', 0.82)); chairs.push(c); }
    R.kitchen.colliders.length = baseColliders;
    chairs.forEach((c, i) => {
      c.visible = i < n;
      const [x, y, face] = SEATS[i];
      put(c, x, y, 0, THREE.MathUtils.degToRad(face) - Math.PI / 2);
      if (i < n) R.kitchen.colliders.push([x - 0.2, y - 0.2, x + 0.2, y + 0.2, 0.9]);
    });
    const places = laid ? Math.min(n, 6) : 0;
    while (settings.length < places) {
      const [x, y, face] = SEATS[settings.length];
      const a = THREE.MathUtils.degToRad(face);
      const g = new THREE.Group();
      R.kitchen.group.add(g);
      g.add(spawn('kitchen', 'plate', { pic: R.kitchen.mats.lit('china') }), spawn('kitchen', 'cutlery'));
      put(g, x + Math.cos(a) * 0.45, y + Math.sin(a) * 0.45, 0.74, a - Math.PI / 2);
      settings.push(g);
    }
    settings.forEach((g, i) => { g.visible = i < places; });
  };

  const dial = new THREE.CanvasTexture(dialTexture(12));
  dial.colorSpace = THREE.SRGBColorSpace; dial.flipY = false;
  const clock = put(spawn('kitchen', 'clock', { clock_face: R.kitchen.mats.register(new THREE.MeshStandardMaterial({ map: dial, roughness: 0.5 })) }), 4.4, 3.4, 1.95, wallYaw([-1, 0]));
  const handH = spawn('kitchen', 'clock_hand_h');
  const handM = spawn('kitchen', 'clock_hand_m');
  clock.add(handH, handM);
  let clockHours = 12;
  const setClock = (h) => { clockHours = h; dial.image = dialTexture(h); dial.needsUpdate = true; };

  const photos = [null, 'family_photo_01', 'family_photo_02', assets.has('family_photo_03') ? 'family_photo_03' : 'family_photo_02', assets.has('family_photo_04') ? 'family_photo_04' : 'family_photo_01'];
  const photoMat = picture('kitchen', photos[1]);
  put(spawn('kitchen', 'frame_photo', { pic: photoMat }), 3.2, 0, 1.52, wallYaw([0, 1]));
  const setPhoto = (k) => { photoMat.map = assets.tex(photos[k], { wrap: 'clamp' }); };

  const foodMat = picture('kitchen', 'dinner_plate');
  const plate = put(spawn('kitchen', 'plate', { pic: foodMat }), 2.55, 2.08, 0.74);
  const cutlery = put(spawn('kitchen', 'cutlery'), 2.55, 2.08, 0.74);
  const frames = [[2.6, 1.52], [3.8, 1.52], [2.9, 1.92], [3.5, 1.92], [3.2, 1.13]].map(([x, z]) => {
    const f = put(spawn('kitchen', 'frame_photo', { pic: photoMat }), x, 0, z, wallYaw([0, 1]));
    f.visible = false;
    return f;
  });
  const setFrames = (n) => frames.forEach((f, i) => { f.visible = i < n - 1; });
  const setPlate = (v) => {
    foodMat.map = v === 'empty' ? null : assets.tex(v === 'wrong' ? 'dinner_plate_wrong' : 'dinner_plate', { wrap: 'clamp' });
    foodMat.color.set(v === 'empty' ? '#e9e6dc' : '#ffffff');
    foodMat.needsUpdate = true;
  };
  setChairs(4);

  // ------------------------------------------------------------ hall
  const lake = picture('hall', 'painting_lake');
  put(spawn('hall', 'frame_painting', { pic: lake }), 1.8, 2.3, 1.5, wallYaw([-1, 0]));
  const paintings = [[0, 4.1, 1.6, [1, 0], 1], [1.8, 5.1, 1.5, [-1, 0], 0.42], [0, 3.1, 1.5, [1, 0], 0.42]].map(([x, y, z, n, k]) => {
    const f = put(spawn('hall', 'frame_painting', { pic: lake }), x, y, z, wallYaw(n));
    f.scale.setScalar(k);
    f.visible = false;
    return f;
  });
  const setPaintings = (n) => paintings.forEach((f, i) => { f.visible = i < n - 1; });
  const setDoors = (n) => ['extra1', 'extra2'].forEach((id, i) => { if (i < n) world.door('hall', id).state.veil = 'none'; });

  // ------------------------------------------------------------ the napkin rings (the second true thing)
  const rings = spawn('pantry', 'rings');
  rings.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.side = THREE.DoubleSide; } });
  put(rings, 1.72, 1.15, 1.058, 0.4);

  // ------------------------------------------------------------ the watch (the one true thing)
  const watchCanvas = document.createElement('canvas');
  watchCanvas.width = watchCanvas.height = 256;
  const watchTex = new THREE.CanvasTexture(watchCanvas);
  watchTex.colorSpace = THREE.SRGBColorSpace; watchTex.flipY = false;
  const watchFace = new THREE.MeshBasicMaterial({ map: watchTex });
  const watch = spawn('nook', 'watch', { watch_face: watchFace });
  watch.traverse((m) => { if (m.isMesh && m.material !== watchFace) m.material = m.material.clone(); });
  const watchMats = [];
  watch.traverse((m) => { if (m.isMesh) watchMats.push(m.material); });
  put(watch, 0.8, 0.7, 0.9, 0.5);
  let lastSecond = -1;
  const drawWatch = () => {
    const now = new Date();
    if (now.getSeconds() === lastSecond) return;
    lastSecond = now.getSeconds();
    const g = watchCanvas.getContext('2d');
    g.drawImage(dialTexture(12, true), 0, 0, 256, 256);
    const hand = (a, len, w) => { g.save(); g.translate(128, 128); g.rotate(a); g.fillStyle = '#1b1814'; g.fillRect(-w / 2, -len, w, len + 12); g.restore(); };
    hand(((now.getHours() % 12) + now.getMinutes() / 60) / 12 * Math.PI * 2, 62, 9);
    hand((now.getMinutes() + now.getSeconds() / 60) / 60 * Math.PI * 2, 96, 6);
    g.save(); g.translate(128, 128); g.rotate(now.getSeconds() / 60 * Math.PI * 2); g.fillStyle = '#a02818'; g.fillRect(-1.5, -104, 3, 124); g.restore();
    watchTex.needsUpdate = true;
  };

  // ------------------------------------------------------------ the Host
  // dissolves in a stochastic dither rather than fading like glass
  const hostMats = {
    host_cloth: new THREE.MeshStandardMaterial({ color: '#17140f', roughness: 0.95, alphaHash: true, opacity: 0 }),
    host_skin: new THREE.MeshStandardMaterial({ color: '#b8a892', roughness: 0.7, alphaHash: true, opacity: 0 }),
  };
  const host = templates.host.clone(true);
  host.traverse((m) => { if (m.isMesh) m.material = hostMats[m.material.name] ?? hostMats.host_cloth; });
  const hostMat = { set opacity(v) { hostMats.host_cloth.opacity = v; hostMats.host_skin.opacity = v; }, get opacity() { return hostMats.host_cloth.opacity; } };
  host.visible = false;

  // ------------------------------------------------------------ drift slots
  const slots = {
    // watched = every place a chair may appear or vanish, not the whole table
    'kitchen.chairs': { room: 'kitchen', value: 4, center: [2.2, 2.3, 0.6], radius: 1.5, also: [[[0.42, 0.42, 0.5], 0.7], [[4.0, 2.75, 0.5], 0.7]], apply: setChairs },
    'kitchen.frames': { room: 'kitchen', value: 1, center: [3.2, 0, 1.52], radius: 0.95, apply: setFrames },
    'hall.paintings': { room: 'hall', value: 1, center: [0, 4.1, 1.6], radius: 0.6, also: [[[1.8, 5.1, 1.5], 0.4], [[0, 3.1, 1.5], 0.4]], apply: setPaintings },
    'hall.doors': { room: 'hall', value: 0, center: [0, 0.95, 1.0], radius: 1.15, also: [[[1.8, 6.2, 1.0], 1.15]], apply: setDoors },
    'kitchen.clock': { room: 'kitchen', value: 12, center: [4.4, 3.4, 1.95], radius: 0.3, apply: setClock },
    // every frame on that wall shows the same photograph, so all of them must be off screen
    'kitchen.photo': { room: 'kitchen', value: 1, center: [3.2, 0, 1.52], radius: 0.95, apply: setPhoto },
    'kitchen.plate': { room: 'kitchen', value: 'dinner', center: [2.55, 2.08, 0.76], radius: 0.25, apply: setPlate },
  };

  return {
    notes, setNote, slots, plate, watch, watchMats, host, hostMat, rings,
    // the table is laid for everyone from the second evening on; yesterday's dinner plate is cleared away
    layTable() { laid = true; plate.visible = false; cutlery.visible = false; setChairs(chairCount); },
    update() {
      const now = new Date();
      const h = now.getHours() + now.getMinutes() / 60;
      handH.rotation.z = -((h % clockHours) / clockHours) * Math.PI * 2;
      handM.rotation.z = -((now.getMinutes() + now.getSeconds() / 60) / 60) * Math.PI * 2;
      drawWatch();
    },
  };
}
