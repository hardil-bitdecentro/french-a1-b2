import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MINUTES,
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
  it('has 182 consecutive days from 3 Nov 2026 to 3 May 2027', () => {
    expect(plan.start).toBe('2026-11-03');
    expect(plan.end).toBe('2027-05-03');
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

  it('switches to exam mode on 2 Apr 2027 with no new chapters', () => {
    for (const d of studyDays.filter((x) => x.date >= '2027-04-02')) {
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
    expect(weeks[0].days).toHaveLength(6); // starts on a Tuesday
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
