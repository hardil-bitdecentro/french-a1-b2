// Flashcards: FSRS scheduling (same algorithm family Anki uses), daily queue, deck words.
// Pure functions: the caller passes `now` and the state; nothing here touches the DOM or storage.
import { fsrs, generatorParameters, createEmptyCard, Rating } from './vendor/ts-fsrs.mjs';
import { localISO } from './logic.js';
import { liveCards } from './store.js';

export const RETENTION = 0.9;
const scheduler = fsrs(generatorParameters({ request_retention: RETENTION, enable_fuzz: true, maximum_interval: 365 }));

export const RATINGS = [
  { value: Rating.Again, key: '1', label: 'Again' },
  { value: Rating.Hard, key: '2', label: 'Hard' },
  { value: Rating.Good, key: '3', label: 'Good' },
  { value: Rating.Easy, key: '4', label: 'Easy' },
];

const NEW = 0; // FSRS State.New

/** Stored scheduling data is plain JSON (ISO dates); FSRS wants Date objects. */
function toFsrs(s) {
  return { ...s, due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined };
}
function fromFsrs(c) {
  const out = { ...c, due: c.due.toISOString() };
  if (c.last_review) out.last_review = c.last_review.toISOString();
  else delete out.last_review;
  return out;
}

export function deckCardId(rank) {
  return `w${rank}`;
}

export function sentenceCardId(i) {
  return `s${i}`;
}

/** Sentence i of the deck as { i, fr, en, level } ("b" basic, "i" intermediate). */
export function sentence(deck, i) {
  const s = deck && deck.sentences && deck.sentences[i];
  return s ? { i, fr: s[0], en: s[1], level: s[2] } : null;
}

export function newSentenceCard(i, now = new Date()) {
  return { id: sentenceCardId(i), kind: 'sent', idx: i, created: now.toISOString(), s: fromFsrs(createEmptyCard(now)) };
}

export function newDeckCard(rank, now = new Date()) {
  return { id: deckCardId(rank), kind: 'deck', rank, created: now.toISOString(), s: fromFsrs(createEmptyCard(now)) };
}

export function newOwnCard({ front, back, src = 'other' }, now = new Date()) {
  const id = `m${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    kind: 'mine',
    front: String(front).trim(),
    back: String(back).trim(),
    src,
    created: now.toISOString(),
    s: fromFsrs(createEmptyCard(now)),
  };
}

/** Apply a rating; returns the updated card (caller stores it). */
export function review(card, rating, now = new Date()) {
  const { card: next } = scheduler.next(toFsrs(card.s), now, rating);
  return { ...card, s: fromFsrs(next) };
}

/** Short human interval, e.g. "1m", "10m", "1d", "2mo". */
export function shortInterval(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo}mo` : `${Math.round(d / 365)}y`;
}

/** What each button would do, for showing intervals on the buttons. */
export function preview(card, now = new Date()) {
  const p = scheduler.repeat(toFsrs(card.s), now);
  return Object.fromEntries(RATINGS.map((r) => [r.value, shortInterval(p[r.value].card.due - now)]));
}

const isToday = (iso, now) => !!iso && localISO(new Date(iso)) === localISO(now);

/** Deck words already started today (counts against the daily new-word limit). */
export function deckNewToday(state, now = new Date()) {
  return liveCards(state).filter((c) => c.kind === 'deck' && isToday(c.created, now)).length;
}

/** Sentences already started today. */
export function sentNewToday(state, now = new Date()) {
  return liveCards(state).filter((c) => c.kind === 'sent' && isToday(c.created, now)).length;
}

/** The next sentence indexes not yet started, in the deck's order (easy → harder). */
export function nextSentences(state, deck, n) {
  if (!deck || !deck.sentences || n <= 0) return [];
  const out = [];
  for (let i = 0; i < deck.sentences.length && out.length < n; i++)
    if (!(sentenceCardId(i) in state.cards)) out.push(i);
  return out;
}

/** Cards reviewed at least once today. */
export function reviewedToday(state, now = new Date()) {
  return liveCards(state).filter((c) => isToday(c.s.last_review, now)).length;
}

/** The next deck ranks not yet started, lowest (most frequent) first. */
export function nextDeckRanks(state, deck, n) {
  if (!deck || n <= 0) return [];
  // Deleted deck words stay excluded (their tombstone keeps the id), so they never come back.
  const started = new Set(
    Object.keys(state.cards)
      .filter((id) => /^w\d+$/.test(id))
      .map((id) => Number(id.slice(1))),
  );
  const out = [];
  for (const w of deck.words) {
    if (out.length >= n) break;
    if (!started.has(w.r)) out.push(w.r);
  }
  return out;
}

/**
 * Today's counts. `newLimit` is the plan's number for the day (0 on vocabulary-book days and Sundays).
 * Learning cards due within `aheadMin` minutes are reported separately so the UI can say "back in 4 min".
 */
export function queueStats(state, deck, newLimit, now = new Date(), aheadMin = 20, sentLimit = 0) {
  const cards = liveCards(state);
  const t = now.getTime();
  const due = cards.filter((c) => new Date(c.s.due).getTime() <= t);
  const soon = cards.filter((c) => {
    const d = new Date(c.s.due).getTime();
    return d > t && d <= t + aheadMin * 60000 && c.s.state !== NEW;
  });
  const newLeft = Math.max(0, newLimit - deckNewToday(state, now));
  const deckLeft = deck ? deck.words.length - Object.keys(state.cards).filter((id) => /^w\d+$/.test(id)).length : 0;
  const sentTotal = deck && deck.sentences ? deck.sentences.length : 0;
  const sentStarted = Object.keys(state.cards).filter((id) => /^s\d+$/.test(id)).length;
  const sentLeft = Math.min(Math.max(0, sentLimit - sentNewToday(state, now)), Math.max(0, sentTotal - sentStarted));
  return {
    due: due.length,
    sentLeft,
    newLeft: Math.min(newLeft, Math.max(0, deckLeft)),
    soon: soon.length,
    nextSoon: soon.length ? Math.min(...soon.map((c) => new Date(c.s.due).getTime())) : null,
  };
}

/**
 * The card to show next: a due card that has been studied before (oldest due first), else your own new
 * cards, else a new deck word (returned as { rank } so the caller creates it only when it is shown).
 */
export function nextCard(state, deck, newLimit, now = new Date(), sentLimit = 0) {
  const t = now.getTime();
  const due = liveCards(state)
    .filter((c) => new Date(c.s.due).getTime() <= t)
    .sort((a, b) => new Date(a.s.due) - new Date(b.s.due));
  const studied = due.filter((c) => c.s.state !== NEW);
  if (studied.length) return { card: studied[0] };
  const ownNew = due.filter((c) => c.kind === 'mine');
  if (ownNew.length) return { card: ownNew[0] };
  const startedNew = due.filter((c) => c.kind === 'deck' || c.kind === 'sent');
  if (startedNew.length) return { card: startedNew[0] };
  const { newLeft, sentLeft } = queueStats(state, deck, newLimit, now, 20, sentLimit);
  const [rank] = nextDeckRanks(state, deck, newLeft > 0 ? 1 : 0);
  if (rank !== undefined) return { rank };
  const [idx] = nextSentences(state, deck, sentLeft > 0 ? 1 : 0);
  return idx === undefined ? null : { sentence: idx };
}

/** Look up a deck word by rank. */
export function deckWord(deck, rank) {
  if (!deck) return null;
  if (!deck._byRank) deck._byRank = new Map(deck.words.map((w) => [w.r, w]));
  return deck._byRank.get(rank) || null;
}

/** Validate an imported word deck (the JSON written by scripts/parse_apkg.py). Sentences are optional. */
export function validDeck(data) {
  return (
    !!data &&
    Array.isArray(data.words) &&
    data.words.length > 0 &&
    data.words.every((w) => Number.isInteger(w.r) && typeof w.a === 'string' && typeof w.m === 'string') &&
    (data.sentences === undefined ||
      (Array.isArray(data.sentences) &&
        data.sentences.every((s) => Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'string')))
  );
}

/** Plan's new-word limit for a day: deck words only on non-Sunday days without a vocabulary-book session. */
export function newLimitFor(day) {
  if (!day || day.sunday || day.vocab) return 0;
  return day.anki;
}

/** Plan's new-sentence limit for a day (8 a day from 4 Jan to 2 Apr, none on Sundays). */
export function sentLimitFor(day) {
  return day && !day.sunday ? day.sent || 0 : 0;
}
