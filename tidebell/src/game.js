// Progression rules: bells, hull depth rating, logbook. Pure state, no rendering.

export const BELL_COUNT = 7;
export const RATINGS = [45, 95, Infinity];

export const BELL_LINES = [
  'The first bell wakes. Somewhere far below, something turns to listen.',
  'Two voices now. The kelp leans toward the sound. Your hull hums with it.',
  'The wreck remembers the surface. The bell remembers further back.',
  'Four notes hang at the edge of the dark. The pressure no longer frightens the hull.',
  'The lanterns pulse in time. They have been waiting for the measure.',
  'Heat and song. The deep is older than the light above it.',
  'Seven. The chord is whole. The sea remembers its song.',
];

export const SPECIES = {
  darter: { name: 'Sunstripe Darter', note: 'Schools turn as one body. Nobody leads.' },
  chromlet: { name: 'Blush Chromlet', note: 'Never strays more than a breath from its coral.' },
  parrot: { name: 'Mosaic Parrotfish', note: 'Grinds reef to sand. Every beach is its work.' },
  turtle: { name: 'Greenback Elder', note: 'Has crossed this bay more times than it has years.' },
  kelp: { name: 'Cathedral Kelp', note: 'Grows a hand-span a day, reaching for a sun it will never touch.' },
  runner: { name: 'Silver Runner', note: 'Hunts the forest edge in bright, nervous squadrons.' },
  manta: { name: 'Veil Ray', note: 'Flies rather than swims. Circles the wreck at dusk.' },
  shark: { name: 'Reef Warden', note: 'Curious, unhurried, and entirely uninterested in you.' },
  jelly: { name: 'Moon Lantern', note: 'Lights itself from within, one slow heartbeat at a time.' },
  minnow: { name: 'Star Minnow', note: 'Carries its own constellations along its belly.' },
  angler: { name: 'Deep Lure', note: 'Keeps a single patient light. Do not follow it.' },
  lantern: { name: 'Lantern Stalk', note: 'A garden that has only ever known its own glow.' },
  worms: { name: 'Vent Plume', note: 'Lives on heat and sulphur. Has no mouth, and no need of one.' },
  whalefall: { name: 'The Fallen Singer', note: 'One voice ended here. A whole reef began.' },
  whale: { name: 'The Singer', note: 'It heard the bells. It came back.' },
};

export function createGame(saved) {
  const g = { bells: new Set(), log: new Set(), finale: false };
  if (saved && typeof saved === 'object') {
    const list = (v) => (Array.isArray(v) ? v : []);
    for (const i of list(saved.bells)) if (Number.isInteger(i) && i >= 0 && i < BELL_COUNT) g.bells.add(i);
    for (const id of list(saved.log)) if (typeof id === 'string' && Object.hasOwn(SPECIES, id)) g.log.add(id);
    g.finale = g.bells.size >= BELL_COUNT;
  }
  return g;
}

export function depthLimit(g) {
  return g.bells.size >= 4 ? RATINGS[2] : g.bells.size >= 2 ? RATINGS[1] : RATINGS[0];
}

// Awaken a bell. Returns the list of things that happened so the caller can present them.
export function awaken(g, index) {
  if (index < 0 || index >= BELL_COUNT || g.bells.has(index)) return [];
  const before = depthLimit(g);
  g.bells.add(index);
  const events = [{ type: 'bell', index, count: g.bells.size, line: BELL_LINES[g.bells.size - 1] }];
  const after = depthLimit(g);
  if (after !== before) events.push({ type: 'rating', limit: after });
  if (g.bells.size === BELL_COUNT && !g.finale) {
    g.finale = true;
    events.push({ type: 'finale' });
  }
  return events;
}

export function discover(g, id) {
  if (!Object.hasOwn(SPECIES, id) || g.log.has(id)) return false;
  g.log.add(id);
  return true;
}

export function serialize(g) {
  return { bells: [...g.bells].sort(), log: [...g.log] };
}
