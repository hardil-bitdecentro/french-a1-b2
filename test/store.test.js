import { describe, expect, it } from 'vitest';
import {
  emptyState,
  migrate,
  doneIds,
  setDone,
  setNote,
  noteText,
  setGrammar,
  grammarOn,
  putCard,
  deleteCard,
  liveCards,
  merge,
  differs,
} from '../site/store.js';

describe('migrate', () => {
  it('turns v1 progress into timestamped v2 without losing anything', () => {
    const v1 = {
      done: { '2026-11-04': ['book', 'write'] },
      notes: { '2026-11-04': 'j’ai allé → je suis allé' },
      grammar: [0, 3],
    };
    const s = migrate(v1, 1000);
    expect(s.v).toBe(2);
    expect(doneIds(s, '2026-11-04').sort()).toEqual(['book', 'write']);
    expect(noteText(s, '2026-11-04')).toBe('j’ai allé → je suis allé');
    expect(grammarOn(s, 3)).toBe(true);
    expect(grammarOn(s, 1)).toBe(false);
  });

  it('returns an empty state for junk', () => {
    expect(migrate(null)).toEqual(emptyState());
    expect(migrate('x')).toEqual(emptyState());
  });

  it('keeps a v2 state as is', () => {
    const s = setDone(emptyState(), '2026-11-05', 'book', true, 5);
    expect(migrate(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('merge (two devices)', () => {
  it('keeps the newer change for each item', () => {
    const phone = setDone(emptyState(), '2026-11-04', 'book', true, 100);
    const laptop = setDone(emptyState(), '2026-11-04', 'book', false, 200);
    setDone(laptop, '2026-11-04', 'write', true, 50);
    const m = merge(phone, laptop);
    expect(doneIds(m, '2026-11-04')).toEqual(['write']); // unticked later on the laptop
    expect(doneIds(merge(laptop, phone), '2026-11-04')).toEqual(['write']); // order doesn't matter
  });

  it('merges notes, grammar and cards independently', () => {
    const a = setNote(emptyState(), '2026-11-04', 'old', 1);
    const b = setNote(emptyState(), '2026-11-04', 'new', 2);
    setGrammar(a, 2, true, 5);
    putCard(b, { id: 'w1', kind: 'deck', rank: 1, s: {} }, 3);
    const m = merge(a, b);
    expect(noteText(m, '2026-11-04')).toBe('new');
    expect(grammarOn(m, 2)).toBe(true);
    expect(liveCards(m).map((c) => c.id)).toEqual(['w1']);
  });

  it('a deletion on one device wins over an older edit on the other', () => {
    const a = putCard(emptyState(), { id: 'm1', kind: 'mine', front: 'x', back: 'y', s: {} }, 10);
    const b = deleteCard(JSON.parse(JSON.stringify(a)), 'm1', 20);
    expect(liveCards(merge(a, b))).toEqual([]);
  });

  it('differs() tells whether a pull brings anything new', () => {
    const a = setDone(emptyState(), 'd', 'x', true, 10);
    expect(differs(a, a)).toBe(false);
    expect(differs(a, setDone(emptyState(), 'd', 'y', true, 11))).toBe(true);
    expect(differs(a, setDone(emptyState(), 'd', 'x', true, 5))).toBe(false); // older: ignored
  });
});
