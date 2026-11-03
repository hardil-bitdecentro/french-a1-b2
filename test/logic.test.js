import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MINUTES,
  EXPLAIN_PROMPT,
  localISO,
  addDays,
  dayNumber,
  clampDate,
  sessionsFor,
  taskIds,
  totalMinutes,
  dayProgress,
  overallProgress,
  groupByWeek,
  esc,
} from '../site/logic.js';

const plan = JSON.parse(readFileSync(new URL('../site/data/schedule.json', import.meta.url), 'utf8'));
const studyDays = plan.days.filter((d) => !d.sunday);

describe('dates', () => {
  it('localISO uses the local calendar day, not UTC', () => {
    // 00:30 local on 3 Nov: toISOString() would say 2 Nov in France (UTC+1).
    expect(localISO(new Date(2026, 10, 3, 0, 30))).toBe('2026-11-03');
    expect(localISO(new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03');
  });

  it('addDays crosses month, year and DST boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-27', 1)).toBe('2027-03-28'); // clocks go forward in France
    expect(addDays('2027-03-29', -2)).toBe('2027-03-27');
  });

  it('dayNumber is 1 on the first day and 182 on the last, across DST', () => {
    expect(dayNumber(plan.start, plan.start)).toBe(1);
    expect(dayNumber(plan.end, plan.start)).toBe(182);
    expect(dayNumber('2027-03-29', '2027-03-27')).toBe(3);
  });

  it('clampDate keeps a date inside the plan', () => {
    expect(clampDate('2026-10-01', plan.start, plan.end)).toBe(plan.start);
    expect(clampDate('2027-06-01', plan.start, plan.end)).toBe(plan.end);
    expect(clampDate('2027-01-15', plan.start, plan.end)).toBe('2027-01-15');
  });
});

describe('schedule data', () => {
  it('has 182 consecutive days from 4 Nov 2026 to 4 May 2027', () => {
    expect(plan.start).toBe('2026-11-04');
    expect(plan.end).toBe('2027-05-04');
    expect(plan.days).toHaveLength(182);
    plan.days.forEach((d, i) => expect(d.date).toBe(addDays(plan.start, i)));
  });

  it('marks exactly the Sundays as review days', () => {
    for (const d of plan.days) {
      const isSunday = new Date(`${d.date}T12:00:00`).getDay() === 0;
      expect(d.sunday).toBe(isSunday);
      if (d.sunday) expect(d.sunday_items.length).toBeGreaterThan(2);
      else expect(d.book && d.write && d.speak && d.retest).toBeTruthy();
    }
  });

  it('covers every chapter of each volume exactly once, in order', () => {
    const volumes = { 'Déb.': 60, 'Int.': 52, 'Av.': 72 };
    for (const [code, count] of Object.entries(volumes)) {
      const seen = [];
      for (const d of studyDays) {
        const m = d.book.match(/^(Déb\.|Int\.|Av\.) (\d+)(?:–(\d+))?$/);
        if (!m || m[1] !== code) continue;
        const lo = Number(m[2]);
        const hi = Number(m[3] || m[2]);
        for (let c = lo; c <= hi; c++) seen.push(c);
      }
      expect(seen).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  });

  it('switches to exam mode on 3 Apr 2027 with no new chapters', () => {
    for (const d of studyDays.filter((x) => x.date >= '2027-04-03')) {
      expect(d.phase).toBe(4);
      expect(d.book).toMatch(/^Error-log chapters/);
    }
  });

  it('has a full 4-part mock on the last three Sundays', () => {
    for (const date of ['2027-04-18', '2027-04-25', '2027-05-02']) {
      const d = plan.days.find((x) => x.date === date);
      expect(d.sunday_items.some((t) => t.startsWith('FULL MOCK'))).toBe(true);
    }
  });

  it('groups into 27 Monday-to-Sunday weeks', () => {
    const weeks = groupByWeek(plan.days);
    expect(weeks).toHaveLength(27);
    expect(weeks[0].days).toHaveLength(5); // starts on a Wednesday
    expect(weeks[1].days[0].day).toMatch(/^Mon /);
  });
});

describe('daily checklist', () => {
  it('every phase adds up to exactly 4 hours', () => {
    for (const m of Object.values(MINUTES)) {
      expect(Object.values(m).reduce((a, b) => a + b, 0)).toBe(240);
    }
  });

  it('every study day is 240 minutes of tasks', () => {
    for (const d of studyDays) expect(totalMinutes(d)).toBe(240);
  });

  it('study days have three sessions; Sundays have one review list', () => {
    expect(sessionsFor(studyDays[0]).map((s) => s.id)).toEqual(['morning', 'afternoon', 'evening']);
    const sunday = plan.days.find((d) => d.sunday);
    const [review] = sessionsFor(sunday);
    expect(review.tasks).toHaveLength(sunday.sunday_items.length);
  });

  it('exam-mode days drop the Anki-card and YouTube blocks', () => {
    const exam = studyDays.find((d) => d.phase === 4);
    expect(taskIds(exam)).not.toContain('cards');
    expect(taskIds(exam)).not.toContain('youtube');
  });

  it('writing and speaking tasks carry a Claude prompt with the day topic', () => {
    const d = studyDays[0];
    const tasks = sessionsFor(d).flatMap((s) => s.tasks);
    expect(tasks.find((t) => t.id === 'write').copy).toContain(d.write);
    expect(tasks.find((t) => t.id === 'speak').copy).toContain(d.speak);
  });

  it('task ids are unique within a day', () => {
    for (const d of plan.days) {
      const ids = taskIds(d);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('progress', () => {
  const day = studyDays[0];

  it('counts done tasks and ignores unknown ids', () => {
    expect(dayProgress(day, [])).toMatchObject({ done: 0, complete: false });
    expect(dayProgress(day, ['book', 'nonsense']).done).toBe(1);
    expect(dayProgress(day, taskIds(day)).complete).toBe(true);
  });

  it('overall progress counts only fully complete days', () => {
    const done = { [day.date]: taskIds(day), [studyDays[1].date]: ['book'] };
    expect(overallProgress(plan.days, done)).toMatchObject({ complete: 1, total: 182, pct: 1 });
    expect(overallProgress(plan.days, {}).complete).toBe(0);
  });
});

describe('esc', () => {
  it('escapes all five HTML-special characters, including single quotes', () => {
    expect(esc(`<img src=x onerror='a("b")'>&`)).toBe('&lt;img src=x onerror=&#39;a(&quot;b&quot;)&#39;&gt;&amp;');
  });
});

describe('English explanation prompt', () => {
  it('names the volume and the chapter range', () => {
    const p = EXPLAIN_PROMPT('Déb. 1–2');
    expect(p).toContain('Niveau débutant (3e édition), chapters 1 to 2');
    expect(p).toContain('native English speaker');
    expect(p).toContain('photo of the rule page');
  });

  it('handles a single chapter and every volume', () => {
    expect(EXPLAIN_PROMPT('Int. 7')).toContain('Niveau intermédiaire (4e édition), chapter 7 (my level: A2–B1)');
    expect(EXPLAIN_PROMPT('Av. 30–31')).toContain('Niveau avancé (3e édition), chapters 30 to 31');
  });

  it('falls back to a placeholder on exam-mode days without chapter numbers', () => {
    expect(EXPLAIN_PROMPT('Error-log chapters: redo the 2 weakest (any volume)')).toContain(
      '[volume + chapter number]',
    );
  });

  it('is attached to the book task on every study day', () => {
    for (const d of studyDays) {
      const book = sessionsFor(d)[0].tasks.find((t) => t.id === 'book');
      expect(book.kind).toBe('explain');
      expect(book.copy).toContain('Grammaire progressive');
    }
  });
});

describe('vocabulary book', () => {
  const vocabDays = plan.days.filter((d) => d.vocab);

  it('covers chapters 1–25 in two halves each, in order, between 4 Dec and 31 Mar on study days', () => {
    const expected = [];
    for (let c = 1; c <= 25; c++) expected.push(`ch. ${c}, first half`, `ch. ${c}, second half`);
    expect(vocabDays.map((d) => d.vocab)).toEqual(expected);
    for (const d of vocabDays) {
      expect(d.sunday).toBe(false);
      expect(d.date >= '2026-12-04' && d.date <= '2027-03-31').toBe(true);
    }
  });

  it('never puts two vocab sessions on consecutive study days', () => {
    const idx = studyDays.map((d) => d.date);
    const pos = vocabDays.map((d) => idx.indexOf(d.date));
    for (let i = 1; i < pos.length; i++) expect(pos[i] - pos[i - 1]).toBeGreaterThanOrEqual(2);
  });

  it('replaces the deck words in the evening on vocab days only', () => {
    const vday = vocabDays[0];
    const other = studyDays.find((d) => !d.vocab && d.phase === 2);
    const title = (d) => sessionsFor(d)[2].tasks.find((t) => t.id === 'anki-new').title;
    expect(title(vday)).toBe('Vocabulary book: ch. 1, first half');
    expect(title(other)).toMatch(/^Anki: \d+ new words$/);
    expect(totalMinutes(vday)).toBe(240);
  });

  it('adds the week’s vocab chapters to the Sunday re-test', () => {
    const sunday = plan.days.find((d) => d.date === '2026-12-06');
    expect(sunday.sunday_items.some((t) => t.includes('Vocab. ch. 1'))).toBe(true);
  });
});
