import { describe, expect, it } from 'vitest';
import {
  RATINGS,
  newDeckCard,
  newSentenceCard,
  newOwnCard,
  review,
  preview,
  shortInterval,
  nextCard,
  nextDeckRanks,
  queueStats,
  deckNewToday,
  deckWord,
  validDeck,
  newLimitFor,
  sentLimitFor,
  sentence,
  sentNewToday,
} from '../site/cards.js';
import { emptyState, putCard, deleteCard } from '../site/store.js';

const deck = {
  words: Array.from({ length: 30 }, (_, r) => ({ r, w: `mot${r}`, a: `le mot${r}`, g: 'm', m: `word ${r}`, ex: [] })),
  sentences: Array.from({ length: 5 }, (_, i) => [`Phrase ${i}.`, `Sentence ${i}.`, i < 3 ? 'b' : 'i']),
};
const at = (iso) => new Date(iso);
const AGAIN = RATINGS[0].value;
const GOOD = RATINGS[2].value;
const EASY = RATINGS[3].value;

describe('scheduling', () => {
  it('a new card answered Good comes back in minutes; Easy in days', () => {
    const now = at('2026-11-04T08:00:00');
    const c = newDeckCard(0, now);
    const good = review(c, GOOD, now);
    expect(new Date(good.s.due) - now).toBeLessThan(60 * 60000);
    const easy = review(c, EASY, now);
    expect(new Date(easy.s.due) - now).toBeGreaterThan(24 * 3600000);
  });

  it('intervals grow with each successful review', () => {
    let t = at('2026-11-04T08:00:00');
    let c = review(newDeckCard(1, t), EASY, t);
    const gaps = [];
    for (let i = 0; i < 4; i++) {
      t = new Date(c.s.due);
      const before = t;
      c = review(c, GOOD, t);
      gaps.push(new Date(c.s.due) - before);
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });

  it('Again on a known card brings it back soon', () => {
    let t = at('2026-11-04T08:00:00');
    let c = review(newDeckCard(2, t), EASY, t);
    t = new Date(c.s.due);
    c = review(c, AGAIN, t);
    expect(new Date(c.s.due) - t).toBeLessThan(60 * 60000);
    expect(c.s.lapses).toBe(1);
  });

  it('preview gives a label for every button', () => {
    const p = preview(newDeckCard(3, at('2026-11-04T08:00:00')), at('2026-11-04T08:00:00'));
    expect(Object.keys(p)).toHaveLength(4);
    for (const label of Object.values(p)) expect(label).toMatch(/^\d+(m|h|d|mo|y)$/);
  });

  it('shortInterval formats minutes to years', () => {
    expect(shortInterval(60000)).toBe('1m');
    expect(shortInterval(90 * 60000)).toBe('2h');
    expect(shortInterval(3 * 86400000)).toBe('3d');
    expect(shortInterval(60 * 86400000)).toBe('2mo');
    expect(shortInterval(400 * 86400000)).toBe('1y');
  });
});

describe('daily queue', () => {
  const now = at('2026-11-04T08:00:00');

  it('introduces deck words in frequency order, up to the daily limit', () => {
    let s = emptyState();
    const seen = [];
    for (let i = 0; i < 10; i++) {
      const next = nextCard(s, deck, 3, now);
      if (!next) break;
      const card = next.card || newDeckCard(next.rank, now);
      seen.push(card.rank);
      putCard(s, review(card, EASY, now), now.getTime());
    }
    expect(seen).toEqual([0, 1, 2]);
    expect(deckNewToday(s, now)).toBe(3);
    expect(queueStats(s, deck, 3, now).newLeft).toBe(0);
  });

  it('shows due reviews before new words, and your own cards before deck words', () => {
    const s = emptyState();
    const old = review(newDeckCard(5, at('2026-11-01T08:00:00')), EASY, at('2026-11-01T08:00:00'));
    putCard(s, { ...old, s: { ...old.s, due: '2026-11-03T08:00:00.000Z' } }, 1);
    putCard(s, newOwnCard({ front: 'le loyer', back: 'rent', src: 'vocab' }, now), 2);
    expect(nextCard(s, deck, 5, now).card.rank).toBe(5);
    putCard(s, review(s.cards.w5, EASY, now), 3);
    expect(nextCard(s, deck, 5, now).card.kind).toBe('mine');
  });

  it('a deleted deck word never comes back', () => {
    const s = emptyState();
    putCard(s, newDeckCard(0, now), 1);
    deleteCard(s, 'w0', 2);
    expect(nextDeckRanks(s, deck, 2)).toEqual([1, 2]);
  });

  it('nothing to do without a deck and with no due cards', () => {
    expect(nextCard(emptyState(), null, 25, now)).toBeNull();
  });

  it('reports learning cards coming back soon', () => {
    const s = emptyState();
    putCard(s, review(newDeckCard(0, now), GOOD, now), 1);
    const st = queueStats(s, deck, 1, now);
    expect(st.due).toBe(0);
    expect(st.soon).toBe(1);
  });
});

describe('deck + plan', () => {
  it('validates the imported deck format', () => {
    expect(validDeck(deck)).toBe(true);
    expect(validDeck({ words: [] })).toBe(false);
    expect(validDeck({ words: [{ r: 'x', a: 'a', m: 'b' }] })).toBe(false);
    expect(validDeck(null)).toBe(false);
  });

  it('looks words up by rank', () => {
    expect(deckWord(deck, 7).m).toBe('word 7');
    expect(deckWord(deck, 99)).toBeNull();
  });

  it('takes the plan’s new-word number, 0 on Sundays and vocabulary-book days', () => {
    expect(newLimitFor({ sunday: false, vocab: null, anki: 25 })).toBe(25);
    expect(newLimitFor({ sunday: true, vocab: null, anki: 25 })).toBe(0);
    expect(newLimitFor({ sunday: false, vocab: 'ch. 1, first half', anki: 25 })).toBe(0);
  });
});

describe('reading sentences', () => {
  const now = at('2027-01-04T20:00:00');

  it('come after the day’s new words, in deck order, up to the sentence limit', () => {
    const s = emptyState();
    const shown = [];
    for (let i = 0; i < 10; i++) {
      const next = nextCard(s, deck, 2, now, 3);
      if (!next) break;
      const card =
        next.card || (next.sentence !== undefined ? newSentenceCard(next.sentence, now) : newDeckCard(next.rank, now));
      shown.push(card.kind === 'sent' ? `s${card.idx}` : `w${card.rank}`);
      putCard(s, review(card, EASY, now), now.getTime());
    }
    expect(shown).toEqual(['w0', 'w1', 's0', 's1', 's2']);
    expect(sentNewToday(s, now)).toBe(3);
  });

  it('none without a sentence limit, or when the deck has no sentences', () => {
    const s = emptyState();
    for (const r of [0, 1]) putCard(s, review(newDeckCard(r, now), EASY, now), 1);
    expect(nextCard(s, deck, 2, now, 0)).toBeNull();
    expect(nextCard(s, { words: deck.words }, 2, now, 5)).toBeNull();
  });

  it('looks sentences up and validates them in imported decks', () => {
    expect(sentence(deck, 3)).toEqual({ i: 3, fr: 'Phrase 3.', en: 'Sentence 3.', level: 'i' });
    expect(sentence(deck, 99)).toBeNull();
    expect(validDeck(deck)).toBe(true);
    expect(validDeck({ ...deck, sentences: [['only french']] })).toBe(false);
  });

  it('takes 8 a day from the plan, none on Sundays', () => {
    expect(sentLimitFor({ sunday: false, sent: 8 })).toBe(8);
    expect(sentLimitFor({ sunday: true, sent: 8 })).toBe(0);
    expect(sentLimitFor({ sunday: false, sent: 0 })).toBe(0);
  });
});
