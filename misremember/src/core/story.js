// Evening 1 as a pure reducer: game events in, new state and a list of effects out. The renderer performs the
// effects (show a note, queue a drift, unveil a door); nothing here touches the scene.
export const NOTES = {
  welcome: 'WELCOME HOME\n(home?)',
  dinner: 'DINNER.\nYOU LIKE THIS.\n(yes?)',
  dinnerYes: 'GOOD.\nI THOUGHT SO.\nEAT.',
  dinnerAgain: 'SORRY.\nIS THIS IT?',
  dinnerInsist: 'IT IS WHAT YOU LIKE.\nEAT.',
  tired: 'YOU MUST BE TIRED.\nYOUR ROOM IS\nACROSS THE HALL.',
  behind: 'IT IS BEHIND YOU.\n(it always was)',
  bed: 'BED. YOURS.\nSLEEP WHEN YOU\nARE READY.',
  nothing: 'NOTHING HERE.\nPLEASE KEEP\nYOUR EYES OPEN.',
  true: 'I DID NOT MAKE THIS.\nIT WAS ALREADY TRUE.',
  thanks: 'OH.\nTHAT IS RIGHT.\nTHANK YOU.',
  notyet: 'NOT YET.\nI AM STILL\nREMEMBERING THIS ONE.',
  evening2: 'GOOD EVENING.\n(it is always evening)',
  doors: 'I COUNTED AGAIN.\nTHERE WERE\nMORE DOORS.',
  pantry: 'PANTRY.\nIT IS BEHIND YOU.\nIT IS ALWAYS\nBEHIND YOU.',
  three: 'THREE.\nI DID NOT\nMAKE THESE.',
  her: 'THEN I MADE HER.\nYOU LOOKED\nLONELY IN IT.',
};

export function initial() {
  return { evening: 1, dinner: 'asked', ate: false, bedDoor: false, carrying: null, anchored: [], seenBedroom: false, done: false, watch: 'left', count: 6, answers: 0, rings: false };
}

const WORD = { 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX', 7: 'SEVEN', 8: 'EIGHT' };
const countNote = (n) => `I COUNT ${WORD[n]}.\n${WORD[n]}? (yes?)`;

// Evening 2, COUNT: the Host keeps recounting the family; only the three napkin rings from the pantry settle it.
function advance2(state, ev) {
  const s = { ...state, anchored: [...state.anchored] };
  const fx = [];
  const note = (id, text, show = true, ask = false) => fx.push({ type: 'note', id, text, show, ask });
  switch (ev.type) {
    case 'wake':
      for (const id of ['welcome', 'dinner', 'tired', 'behind', 'thanks']) note(id, '', false);
      note('evening2', NOTES.evening2);
      note('doors', NOTES.doors);
      note('count', `HOW MANY WERE WE?\n${WORD[s.count]}? (yes?)`, true, true);
      fx.push({ type: 'set', id: 'kitchen.chairs', value: s.count });
      fx.push({ type: 'set', id: 'kitchen.frames', value: 3 });
      fx.push({ type: 'set', id: 'hall.doors', value: 1 });
      fx.push({ type: 'set', id: 'hall.paintings', value: 2 });
      if (s.watch !== 'placed') fx.push({ type: 'set', id: 'kitchen.clock', value: 14 });
      break;
    case 'answer': {
      if (ev.note !== 'count' || s.rings) break;
      s.answers += 1;
      const up = ev.value === 'yes' ? s.count < 8 : s.count <= 5;
      fx.push({ type: 'drift', id: 'kitchen.chairs', value: s.count + (up ? 1 : -1) });
      note('count', ev.value === 'yes' ? 'GOOD.\nI WILL SET IT.' : 'NO?\nI WILL COUNT AGAIN.');
      if (s.answers === 1) {
        note('pantry', NOTES.pantry);
        fx.push({ type: 'pantry' });
        fx.push({ type: 'drift', id: 'hall.doors', value: 2 });
        fx.push({ type: 'drift', id: 'hall.paintings', value: 4 });
        fx.push({ type: 'drift', id: 'kitchen.frames', value: 6 });
        fx.push({ type: 'drift', id: 'kitchen.photo', value: 3 });
      }
      break;
    }
    case 'drifted':
      if (ev.id === 'kitchen.chairs') {
        s.count = ev.value;
        if (s.rings) note('count', 'THREE.\nONLY THREE.');
        else note('count', countNote(ev.value), true, true);
      } else if (ev.id === 'kitchen.photo' && ev.value === 4) note('her', NOTES.her);
      break;
    case 'pickup':
      s.carrying = ev.item;
      fx.push({ type: 'say', text: 'Three napkin rings. One each.' });
      break;
    case 'place':
      if (s.carrying !== ev.item) break;
      s.carrying = null;
      s.rings = true;
      fx.push({ type: 'truth', id: 'kitchen.chairs', value: 3 });
      fx.push({ type: 'truth', id: 'kitchen.photo', value: 4 });
      fx.push({ type: 'truth', id: 'kitchen.frames', value: 1 });
      fx.push({ type: 'anchor', room: ev.room, item: ev.item });
      note('count', 'THREE?');
      break;
    case 'sleep':
      if (s.answers === 0) { fx.push({ type: 'say', text: 'Not yet. The table is waiting to be counted.' }); break; }
      s.done = true;
      fx.push({ type: 'end', evening: 2, anchored: s.rings });
      break;
    default:
  }
  return { state: s, effects: fx };
}

export function advance(state, ev) {
  if (state.evening === 2) return advance2(state, ev);
  const s = { ...state, anchored: [...state.anchored] };
  const fx = [];
  const note = (id, text, show = true, ask = false) => fx.push({ type: 'note', id, text, show, ask });
  switch (ev.type) {
    case 'answer':
      if (ev.note !== 'dinner' || s.ate) break;
      if (ev.value === 'yes') {
        s.dinner = 'agreed';
        note('dinner', NOTES.dinnerYes);
      } else if (s.dinner === 'asked') {
        s.dinner = 'asked-again';
        fx.push({ type: 'drift', id: 'kitchen.plate', value: 'wrong', now: true });
        note('dinner', NOTES.dinnerAgain, true, true);
      } else {
        s.dinner = 'insisted';
        note('dinner', NOTES.dinnerInsist);
      }
      break;
    case 'eat':
      if (s.ate) break;
      s.ate = true;
      fx.push({ type: 'blink' });
      fx.push({ type: 'drift', id: 'kitchen.plate', value: 'empty', now: true });
      fx.push({ type: 'drift', id: 'kitchen.chairs', value: 5 });
      fx.push({ type: 'drift', id: 'kitchen.clock', value: 13 });
      fx.push({ type: 'drift', id: 'kitchen.photo', value: 2 });
      note('dinner', '', false);
      note('tired', NOTES.tired);
      note('behind', NOTES.behind);
      break;
    case 'read':
      if (ev.note === 'behind' && s.ate && !s.bedDoor) {
        s.bedDoor = true;
        fx.push({ type: 'unveil', room: 'hall', door: 'bed' });
      }
      break;
    case 'enter':
      if (ev.room === 'bedroom' && !s.seenBedroom) {
        s.seenBedroom = true;
        fx.push({ type: 'drift', id: 'kitchen.chairs', value: 7 });
        fx.push({ type: 'drift', id: 'kitchen.photo', value: 3 });
      }
      break;
    case 'pickup':
      s.carrying = ev.item;
      fx.push({ type: 'say', text: 'A wristwatch. It is still running — and it is right.' });
      break;
    case 'place':
      if (s.carrying !== ev.item) break;
      s.carrying = null;
      if (!s.anchored.includes(ev.room)) s.anchored.push(ev.room);
      fx.push({ type: 'anchor', room: ev.room, item: ev.item });
      note('thanks', NOTES.thanks);
      break;
    case 'sleep':
      if (!s.ate) { fx.push({ type: 'say', text: 'Not yet. Something is waiting in the kitchen.' }); break; }
      s.watch = s.anchored.includes('kitchen') ? 'placed' : s.carrying === 'watch' ? 'held' : 'left';
      s.carrying = null;
      s.evening = 2;
      fx.push({ type: 'night', evening: 2, watch: s.watch });
      break;
    default:
  }
  return { state: s, effects: fx };
}
