import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MINUTES,
  EXPLAIN_PROMPT,
  hms,
  vincentLinks,
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
  streaks,
  streakTarget,
  dayCounts,
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
  it('has 182 consecutive days from 6 Nov 2026 to 6 May 2027', () => {
    expect(plan.start).toBe('2026-11-06');
    expect(plan.end).toBe('2027-05-06');
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

  it('switches to exam mode on 5 Apr 2027 with no new chapters', () => {
    for (const d of studyDays.filter((x) => x.date >= '2027-04-05')) {
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
    expect(weeks[0].days).toHaveLength(3); // starts on a Friday
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

describe('Débutant book (from its contents pages)', () => {
  const deb = studyDays.filter((d) => d.phase === 1);
  const sundays = plan.days.filter((d) => d.sunday);

  it('covers chapters 1–60 once each, in order', () => {
    expect(deb.flatMap((d) => d.book_topics.map((t) => t.ch))).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('keeps the first days and splits the passé composé across two days', () => {
    expect(deb.slice(0, 2).map((d) => d.book)).toEqual(['Déb. 1–2', 'Déb. 3–4']);
    expect(plan.days.find((d) => d.date === '2026-11-27').book).toBe('Déb. 43–44');
    expect(plan.days.find((d) => d.date === '2026-11-28').book).toBe('Déb. 45–46');
  });

  it('shows pages and topics on the book task, and skips the bilan pages', () => {
    const d = deb[1];
    expect(d.book_pages).toBe('p. 14–17');
    const book = sessionsFor(d)[0].tasks.find((t) => t.id === 'book');
    expect(book.title).toBe('Book: Déb. 3–4, p. 14–17');
    expect(book.detail).toContain('Ch. 4: être');
    expect(plan.days.find((x) => x.date === '2026-12-01').book_pages).toBe('p. 122–123, 126–127');
  });

  it('never assigns more than 8 pages in a morning', () => {
    for (const d of deb) {
      const pages = [...d.book_pages.matchAll(/(\d+)–(\d+)/g)].reduce((a, m) => a + Number(m[2]) - Number(m[1]) + 1, 0);
      expect(pages).toBeLessThanOrEqual(8);
    }
  });

  it('names the topics in the explain prompt instead of asking for the title', () => {
    const p = sessionsFor(deb[1])[0].tasks.find((t) => t.id === 'book').copy;
    expect(p).toContain('These chapters cover: 3) describing: plural adjectives; 4) être');
    expect(p).not.toContain('[type it here]');
    expect(EXPLAIN_PROMPT('Int. 7')).toContain('[type it here]');
  });

  it('names the topics in the evening re-test', () => {
    const t = sessionsFor(deb[1])[2].tasks.find((x) => x.id === 'retest');
    expect(t.title).toBe('Re-test: yesterday: Déb. 1–2');
    expect(t.detail).toContain('Déb. 1–2: introducing yourself');
    expect(t.detail).toContain('from memory');
  });

  it('sets each of the 8 bilans once, on the first Sunday after its last chapter', () => {
    const where = (n) => sundays.filter((d) => d.sunday_items.some((t) => t.includes(`Bilan ${n} (`)));
    const expected = {
      1: '2026-11-15',
      2: '2026-11-22',
      3: '2026-11-22',
      4: '2026-11-29',
      5: '2026-11-29',
      6: '2026-12-06',
      7: '2026-12-06',
      8: '2026-12-06',
    };
    for (const [n, date] of Object.entries(expected)) expect(where(n).map((d) => d.date)).toEqual([date]);
    const last = sundays.find((d) => d.date === '2026-12-06');
    expect(last.sunday_items.some((t) => t.includes('final test on p. 173'))).toBe(true);
  });

  it('practises only grammar already reached in the book', () => {
    const before = (date) => deb.filter((d) => d.date < date);
    for (const d of before('2026-11-27')) {
      expect(`${d.write} ${d.speak}`).not.toMatch(/j'ai mangé|je suis arrivé|as fait hier|ton arrivée/i);
    }
    for (const d of before('2026-11-30')) expect(`${d.write} ${d.speak}`).not.toMatch(/quand j'étais|ton enfance/i);
    for (const d of before('2026-12-04')) expect(`${d.write} ${d.speak}`).not.toMatch(/j'en |avec en/i);
    expect(deb[3].write).toContain('je me lève'); // reflexive verbs, ch. 9
    expect(deb.at(-1).speak).toContain('BILAN');
  });
});

describe('vocabulary book', () => {
  const vocabDays = plan.days.filter((d) => d.vocab);

  it('covers chapters 1–25 in two halves each, in order, between 7 Dec and 2 Apr on study days', () => {
    const expected = [];
    for (let c = 1; c <= 25; c++) expected.push(`ch. ${c}, first half`, `ch. ${c}, second half`);
    expect(vocabDays.map((d) => d.vocab)).toEqual(expected);
    for (const d of vocabDays) {
      expect(d.sunday).toBe(false);
      expect(d.date >= '2026-12-07' && d.date <= '2027-04-02').toBe(true);
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
    expect(title(other)).toMatch(/^Flashcards: \d+ new words$/);
    expect(totalMinutes(vday)).toBe(240);
  });

  it('adds the week’s vocab chapters to the Sunday re-test', () => {
    const sunday = plan.days.find((d) => d.date === '2026-12-13');
    expect(sunday.sunday_items.some((t) => t.includes('Vocab. ch. 1'))).toBe(true);
  });
});

describe('Vincent course (November)', () => {
  const vDays = plan.days.filter((d) => d.yt_links);
  const lengths = { 1: 15015, 2: 16978, 3: 28105, 4: 17995, 5: 14074 };

  it('runs on every Débutant study day and nowhere else', () => {
    const phase1 = studyDays.filter((d) => d.phase === 1).map((d) => d.date);
    expect(vDays.map((d) => d.date)).toEqual(phase1);
  });

  it('never repeats any part of a video and stays inside it', () => {
    const segs = vDays.flatMap((d) => d.yt_links);
    for (let v = 1; v <= 5; v++) {
      const mine = segs.filter((g) => g.video === v).sort((a, b) => a.from - b.from);
      expect(mine.length).toBeGreaterThan(0);
      for (const g of mine) {
        expect(g.from).toBeLessThan(g.to);
        expect(g.to).toBeLessThanOrEqual(lengths[v]);
        expect(g.topic.length).toBeGreaterThan(0);
      }
      for (let i = 1; i < mine.length; i++) expect(mine[i].from).toBeGreaterThanOrEqual(mine[i - 1].to);
    }
  });

  it('fills the hour: Vincent first, Super Easy French for the rest', () => {
    for (const d of vDays) {
      const min = d.yt_links.reduce((a, g) => a + g.to - g.from, 0) / 60;
      expect(min).toBeGreaterThan(0);
      expect(min).toBeLessThan(65);
      expect(min + d.yt_rest).toBeGreaterThan(55);
      expect(min + d.yt_rest).toBeLessThan(65);
    }
  });

  it('puts each lesson on the day of its chapter', () => {
    const topicsOn = (date) =>
      plan.days
        .find((d) => d.date === date)
        .yt_links.map((l) => l.topic)
        .join(' | ');
    expect(topicsOn('2026-11-07')).toContain('être'); // ch. 4
    expect(topicsOn('2026-11-10')).toContain('-er verbs: spelling changes'); // ch. 8
    expect(topicsOn('2026-11-20')).toContain('Telling the time'); // ch. 29
    expect(topicsOn('2026-11-27')).toContain('Passé composé'); // ch. 44
    expect(topicsOn('2026-11-30')).toContain('Imparfait'); // ch. 47
    expect(topicsOn('2026-12-05')).toContain('Relative pronouns'); // ch. 60
  });

  it('keeps grammar beyond this volume out of November', () => {
    const all = vDays.flatMap((d) => d.yt_links.map((l) => l.topic)).join(' | ');
    for (const later of ['Subjunctive', 'Conditional', 'Passive', 'Plus-que-parfait', 'Reported speech']) {
      expect(all).not.toContain(later);
    }
  });

  it('builds links that start on the lesson and say where to stop', () => {
    const links = vincentLinks([{ video: 1, id: 'keBSvVsEibI', from: 969, to: 1530, topic: 'être' }]);
    expect(links).toEqual([
      {
        label: 'être · stop at 0:25:30',
        url: 'https://www.youtube.com/watch?v=keBSvVsEibI&t=969s',
      },
    ]);
  });

  it('adds Super Easy French to the task only when the hour has room', () => {
    const task = (d) => sessionsFor(d)[1].tasks.find((t) => t.id === 'youtube');
    const room = vDays.find((d) => d.yt_rest);
    expect(task(room).links).toHaveLength(room.yt_links.length + 1);
    expect(task(room).links.at(-1).label).toBe(`Super Easy French · ${room.yt_rest} min`);
    expect(task(room).minutes).toBe(60);
    const full = vDays.find((d) => !d.yt_rest);
    expect(task(full).links).toHaveLength(full.yt_links.length);
  });

  it('formats H:MM:SS', () => {
    expect(hms(0)).toBe('0:00:00');
    expect(hms(28105)).toBe('7:48:25');
  });
});

describe('sentences in the plan', () => {
  it('8 a day on study days from 4 Jan to 3 Apr, and the evening task says so', () => {
    const withSent = plan.days.filter((d) => d.sent);
    expect(withSent[0].date).toBe('2027-01-04');
    expect(withSent.at(-1).date).toBe('2027-04-03');
    expect(withSent.every((d) => d.sent === 8 && !d.sunday)).toBe(true);
    const day = withSent.find((d) => !d.vocab);
    const t = sessionsFor(day)[2].tasks.find((x) => x.id === 'anki-new');
    expect(t.title).toBe(`Flashcards: ${day.anki} new words + 8 sentences`);
    expect(totalMinutes(day)).toBe(240);
  });
});

describe('speaking cards in the plan', () => {
  it('6 a day on study days from 11 Jan to 3 Apr, named in the evening task', () => {
    const withSay = plan.days.filter((d) => d.say);
    expect(withSay[0].date).toBe('2027-01-11');
    expect(withSay.at(-1).date).toBe('2027-04-03');
    expect(withSay.every((d) => d.say === 6 && d.sent === 8 && !d.sunday)).toBe(true);
    const day = withSay.find((d) => !d.vocab);
    const t = sessionsFor(day)[2].tasks.find((x) => x.id === 'anki-new');
    expect(t.title).toBe(`Flashcards: ${day.anki} new words + 8 sentences + 6 to say`);
  });
});

describe('streak', () => {
  const days = plan.days.slice(0, 10);
  const half = (d) => taskIds(d).slice(0, Math.ceil(taskIds(d).length / 2));
  const all = (d) => taskIds(d);

  it('a day counts from half of its tasks', () => {
    const d = days[0];
    expect(dayCounts(d, half(d))).toBe(true);
    expect(dayCounts(d, half(d).slice(1))).toBe(false);
    expect(streakTarget(d)).toBe(Math.ceil(taskIds(d).length / 2));
  });

  it('counts consecutive days; today only adds once it counts', () => {
    const map = { [days[0].date]: all(days[0]), [days[1].date]: half(days[1]), [days[2].date]: half(days[2]) };
    expect(streaks(days, map, days[2].date)).toEqual({ current: 3, best: 3, todayCounts: true });
    expect(streaks(days, map, days[3].date)).toEqual({ current: 3, best: 3, todayCounts: false }); // day 4 not done yet
  });

  it('a missed day resets the streak but keeps the best', () => {
    const map = {
      [days[0].date]: all(days[0]),
      [days[1].date]: all(days[1]),
      [days[3].date]: all(days[3]),
    };
    expect(streaks(days, map, days[4].date)).toEqual({ current: 1, best: 2, todayCounts: false });
    expect(streaks(days, {}, days[0].date)).toEqual({ current: 0, best: 0, todayCounts: false });
  });

  it('nothing before the plan starts', () => {
    expect(streaks(days, {}, '2026-11-01')).toEqual({ current: 0, best: 0, todayCounts: false });
  });
});
