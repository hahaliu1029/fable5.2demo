// The drift engine: things in the house change, but only while nobody is looking at them.
// A slot holds one value (how many chairs, which photograph, how many hours on the clock). Changes are queued and
// land once the slot has gone unwatched for a while; each new state then has to be witnessed before the next lands,
// so the player sees every step. A room with an anchor in it quietly returns to the truth instead.
export function createDrift() {
  const slots = new Map();

  return {
    add({ id, room, value }) {
      slots.set(id, { id, room, value, truth: value, queue: [], unseen: 0, witnessed: true, seenFor: 0 });
    },
    get: (id) => slots.get(id)?.value,
    truth: (id) => slots.get(id)?.truth,
    setTruth(id, value) { slots.get(id).truth = value; },
    pending: (id) => slots.get(id)?.queue.length ?? 0,
    queue(id, value, { unseen = 1.5 } = {}) {
      const s = slots.get(id);
      if (!s) throw new Error(`no drift slot ${id}`);
      s.queue.push({ value, unseen });
    },
    clear(id) { const s = slots.get(id); if (s) s.queue.length = 0; },
    clearAll() { for (const s of slots.values()) s.queue.length = 0; },
    // Force a value (used when the player answers a question): still counts as a state to witness.
    // permanent: true also makes it the new truth, for changes the player caused (an eaten dinner stays eaten).
    set(id, value, { permanent = false } = {}) {
      const s = slots.get(id);
      s.value = value; s.witnessed = false; s.seenFor = 0;
      if (permanent) s.truth = value;
    },
    // observed(id) -> is the slot on screen right now; anchored(room, id) -> does an anchor hold that slot.
    // witnessed(id) -> is the player actually looking at it (defaults to observed). A slot that merely could be seen
    // holds still, but only one that is really seen counts as witnessed.
    tick(dt, observed, anchored = () => false, witnessed = observed) {
      const changes = [];
      for (const s of slots.values()) {
        if (observed(s.id)) {
          s.unseen = 0;
          if (witnessed(s.id)) s.seenFor += dt; else s.seenFor = 0;
          if (s.seenFor >= 0.3) s.witnessed = true;
          continue;
        }
        s.unseen += dt;
        s.seenFor = 0;
        if (anchored(s.room, s.id)) {
          s.queue.length = 0;
          if (s.value !== s.truth && s.unseen >= 1.0) {
            changes.push({ id: s.id, room: s.room, from: s.value, to: s.truth });
            s.value = s.truth; s.witnessed = false;
          }
          continue;
        }
        const next = s.queue[0];
        if (next && s.witnessed && s.unseen >= next.unseen) {
          s.queue.shift();
          if (next.value !== s.value) {
            changes.push({ id: s.id, room: s.room, from: s.value, to: next.value });
            s.value = next.value; s.witnessed = false;
          }
        }
      }
      return changes;
    },
  };
}
