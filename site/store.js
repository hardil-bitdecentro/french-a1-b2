// Progress state: pure functions only (no DOM, no storage), so they can be unit-tested and merged
// across devices. Every value carries a "last changed" timestamp; when two devices disagree, the
// newer change wins, per item.
//
// v2 shape:
//   done:    { [date]: { [taskId]: [isDone, ts] } }
//   notes:   { [date]: [text, ts] }
//   grammar: { [index]: [isDone, ts] }
//   cards:   { [cardId]: { ...card, u: ts } }        (deleted cards stay as { del: true, u })
//   settings:{ [name]: [value, ts] }

export const VERSION = 2;

export function emptyState() {
  return { v: VERSION, done: {}, notes: {}, grammar: {}, cards: {}, settings: {} };
}

/** Accepts anything that was ever saved (v1 or v2) and returns a valid v2 state. */
export function migrate(raw, now = Date.now()) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  if (raw.v === VERSION) {
    for (const k of ['done', 'notes', 'grammar', 'cards', 'settings']) {
      if (raw[k] && typeof raw[k] === 'object') s[k] = raw[k];
    }
    return s;
  }
  // v1: done = { date: [ids] }, notes = { date: text }, grammar = [indices]
  for (const [date, ids] of Object.entries(raw.done || {})) {
    if (!Array.isArray(ids)) continue;
    s.done[date] = Object.fromEntries(ids.map((id) => [id, [true, now]]));
  }
  for (const [date, text] of Object.entries(raw.notes || {})) {
    if (typeof text === 'string' && text) s.notes[date] = [text, now];
  }
  for (const i of Array.isArray(raw.grammar) ? raw.grammar : []) s.grammar[i] = [true, now];
  return s;
}

export function doneIds(state, date) {
  return Object.entries(state.done[date] || {})
    .filter(([, [on]]) => on)
    .map(([id]) => id);
}

export function setDone(state, date, id, on, now = Date.now()) {
  state.done[date] = { ...(state.done[date] || {}), [id]: [!!on, now] };
  return state;
}

export function noteText(state, date) {
  return (state.notes[date] || ['', 0])[0];
}

export function setNote(state, date, text, now = Date.now()) {
  state.notes[date] = [text, now];
  return state;
}

export function grammarOn(state, i) {
  return !!(state.grammar[i] || [false])[0];
}

export function setGrammar(state, i, on, now = Date.now()) {
  state.grammar[i] = [!!on, now];
  return state;
}

export function setting(state, name, fallback) {
  return state.settings[name] ? state.settings[name][0] : fallback;
}

export function setSetting(state, name, value, now = Date.now()) {
  state.settings[name] = [value, now];
  return state;
}

export function putCard(state, card, now = Date.now()) {
  state.cards[card.id] = { ...card, u: now };
  return state;
}

export function deleteCard(state, id, now = Date.now()) {
  state.cards[id] = { id, del: true, u: now };
  return state;
}

export function liveCards(state) {
  return Object.values(state.cards).filter((c) => !c.del);
}

const tsOfPair = (x) => (Array.isArray(x) ? x[1] || 0 : 0);
const tsOfCard = (x) => (x && x.u) || 0;

function mergeMap(a = {}, b = {}, ts) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!(k in out) || ts(v) > ts(out[k])) out[k] = v;
  }
  return out;
}

/** Merge two states; per item, the newer change wins. Pure: returns a new object. */
export function merge(a, b) {
  const A = migrate(a);
  const B = migrate(b);
  const done = { ...A.done };
  for (const [date, tasks] of Object.entries(B.done)) done[date] = mergeMap(done[date], tasks, tsOfPair);
  return {
    v: VERSION,
    done,
    notes: mergeMap(A.notes, B.notes, tsOfPair),
    grammar: mergeMap(A.grammar, B.grammar, tsOfPair),
    cards: mergeMap(A.cards, B.cards, tsOfCard),
    settings: mergeMap(A.settings, B.settings, tsOfPair),
  };
}

/** True when merging `incoming` into `base` would change anything. */
export function differs(base, incoming) {
  return JSON.stringify(merge(base, incoming)) !== JSON.stringify(merge(base, {}));
}
