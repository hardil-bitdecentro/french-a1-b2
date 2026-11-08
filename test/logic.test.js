import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MINUTES,
  wordLimit,
  countWords,
  wordStatus,
  EXPLAIN_PROMPT,
  CHECK_PROMPT,
  timerLeft,
  formatClock,
  taskMinutes,
  parseMistake,
  splitTitle,
  detailParts,
  mistakeLines,
  repeatedMistakes,
  addNoteLine,
  removeNoteLine,
  pagesFrom,
  answersFor,
  BOOK_AUDIO,
  BOOK_WORDS,
  WORD_SETS,
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
/** The core 4 hours plus Vincent's later lessons, which run on top. */
const phaseCore = (d) => Object.values(MINUTES[d.phase]).reduce((a, b) => a + b, 0);
const extraMinutes = (d) => (d.extras || []).reduce((sum, x) => sum + x.minutes, 0);
const coreAndVincent = (d) =>
  phaseCore(d) + extraMinutes(d) + Math.round((d.vincent_later || []).reduce((sum, l) => sum + l.to - l.from, 0) / 60);

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
  it('has 182 consecutive days from 9 Nov 2026 to 9 May 2027', () => {
    expect(plan.start).toBe('2026-11-09');
    expect(plan.end).toBe('2027-05-09');
    expect(plan.days).toHaveLength(182);
    plan.days.forEach((d, i) => expect(d.date).toBe(addDays(plan.start, i)));
  });

  it('marks exactly the Sundays, plus the end-of-Débutant review on 9 Dec, as review days', () => {
    for (const d of plan.days) {
      const isReview = new Date(`${d.date}T12:00:00`).getDay() === 0 || d.date === '2026-12-09';
      expect(d.sunday).toBe(isReview);
      if (d.sunday) expect(d.sunday_items.length).toBeGreaterThan(2);
      else expect(d.book && d.write && d.speak && d.retest).toBeTruthy();
    }
  });

  it('covers every chapter of each volume exactly once, in order', () => {
    const volumes = { 'Déb.': 60, 'Int.': 52, 'Av.': 27 };
    for (const [code, count] of Object.entries(volumes)) {
      const seen = [];
      for (const d of studyDays) {
        const m = d.book.match(/^(Déb\.|Int\.|Av\.) (\d+)(?:–(\d+))?$/);
        if (!m || m[1] !== code) continue;
        const lo = Number(m[2]);
        const hi = Number(m[3] || m[2]);
        // A long chapter runs over several days, so only count it the first time.
        for (let c = lo; c <= hi; c++) if (seen.at(-1) !== c) seen.push(c);
      }
      expect(seen).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  });

  it('switches to exam mode on 5 Apr 2027 with no new chapters', () => {
    for (const d of studyDays.filter((x) => x.date >= '2027-04-08')) {
      expect(d.phase).toBe(4);
      expect(d.book).toMatch(/^Error-log chapters/);
    }
  });

  it('has a full 4-part mock on the last three Sundays', () => {
    for (const date of ['2027-04-18', '2027-04-25', '2027-05-02', '2027-05-09']) {
      const d = plan.days.find((x) => x.date === date);
      expect(d.sunday_items.some((t) => t.startsWith('FULL MOCK'))).toBe(true);
    }
  });

  it('groups into 26 Monday-to-Sunday weeks', () => {
    const weeks = groupByWeek(plan.days);
    expect(weeks).toHaveLength(26);
    expect(weeks[0].days).toHaveLength(7); // starts on a Monday
    expect(weeks[1].days[0].day).toMatch(/^Mon /);
  });
});

describe('daily checklist', () => {
  it('every phase is at least 4 hours', () => {
    for (const m of Object.values(MINUTES)) {
      expect(Object.values(m).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(240);
    }
  });

  it('every study day is at least 4 hours: the core blocks plus any extras', () => {
    for (const d of studyDays) {
      const later = (d.vincent_later || []).reduce((sum, l) => sum + l.to - l.from, 0);
      // A two or three chapter Débutant day shows its real length instead of the 50-minute slot.
      const bookOver = d.book_topics ? Math.max(0, d.book_topics.length * 40 - MINUTES[d.phase].book) : 0;
      const extras =
        (d.read_task ? 10 : 0) + (d.word_set ? 10 : 0) + Math.round(later / 60) + extraMinutes(d) + bookOver;
      // A long Vincent day can run a couple of minutes over the slot: that's fine, 4 hours is a minimum.
      expect(totalMinutes(d)).toBeGreaterThanOrEqual(phaseCore(d) + extras - 4);
      expect(totalMinutes(d)).toBeLessThanOrEqual(phaseCore(d) + extras + 4);
    }
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

describe('Intermédiaire, mapped to the book', () => {
  const int = studyDays.filter((d) => /^Int\. /.test(d.book));
  const pages = (d) =>
    d.book_pages
      .match(/p\. (\d+)–(\d+)/)
      .slice(1)
      .map(Number);
  const book = (d) => sessionsFor(d)[0].tasks.find((t) => t.id === 'book');

  it('runs from p. 8 to p. 255 with no gap except the bilan pages', () => {
    const bilans = new Set([72, 138, 220]);
    expect(pages(int[0])[0]).toBe(8);
    expect(pages(int.at(-1))[1]).toBe(255);
    int.slice(1).forEach((d, i) => {
      const prev = pages(int[i])[1] + 1;
      expect(pages(d)[0]).toBe(bilans.has(prev) ? prev + 2 : prev);
    });
  });

  it('never sets more than 6 pages in a day, and gives the passé composé six days', () => {
    for (const d of int) expect(pages(d)[1] - pages(d)[0] + 1).toBeLessThanOrEqual(6);
    expect(int.filter((d) => d.book === 'Int. 40')).toHaveLength(6);
  });

  it('shows the focus and pages, but never Débutant answers or the English-note task', () => {
    const d = int[0];
    expect(book(d).title).toContain(d.book_pages);
    expect(book(d).detail).toContain('Être and subject pronouns');
    expect(book(d).answerPages).toBeUndefined();
    expect(taskIds(d)).not.toContain('before-book');
  });

  it('puts each pair of bilans on the Sunday after its last chapter, then the final test', () => {
    const on = (needle) => plan.days.filter((d) => d.sunday_items?.some((i) => i.includes(needle))).map((d) => d.date);
    const after = (needle) => on(needle)[0];
    const lastDay = (ch) => int.filter((d) => d.book.match(/(\d+)$/)[1] >= ch).map((d) => d.date)[0];
    expect(on('Bilans 1 and 2')).toHaveLength(1);
    expect(after('Bilans 1 and 2') > lastDay(15)).toBe(true);
    expect(on('Bilans 7 and 8')).toEqual(['2027-02-14']);
    expect(on('Intermédiaire final test')).toEqual(['2027-02-14']);
  });
});

describe('Intermédiaire: videos, activities and prompts follow the book', () => {
  const byPages = (p) => plan.days.find((d) => d.phase === 2 && d.book_pages === p);
  const topics = (d) => (d.vincent_later || []).map((l) => l.topic).join(' | ');

  it('puts each grammar lesson on the day its chapter is in the book', () => {
    expect(topics(byPages('p. 132–137'))).toContain('Conditional');
    expect(topics(byPages('p. 140–143'))).toContain('dont, où');
    expect(topics(byPages('p. 214–219'))).toContain('Plus-que-parfait');
    expect(topics(byPages('p. 232–237'))).toContain('si clauses');
    expect(topics(byPages('p. 128–131'))).toContain('Two pronouns');
  });

  it('starts the verbs-and-prepositions lessons at their chapter, one a day', () => {
    const days = plan.days.filter((d) => topics(d).includes('Verbs and prepositions')).map((d) => d.date);
    expect(days[0]).toBe(byPages('p. 160–165').date);
    expect(new Set(days).size).toBe(days.length);
  });

  it('places each communication activity once, on a Sunday after its grammar', () => {
    const on = (needle) =>
      plan.days.filter((d) => d.sunday_items?.some((i) => i.includes(`Activité communicative (25 min): ${needle}`)));
    const expected = {
      'p. 266': 'p. 144–147',
      'p. 264': 'p. 210–213',
      'p. 265': 'p. 214–219',
      'p. 272': 'p. 198–203',
      'p. 267': 'p. 232–237',
      'p. 268–269': 'p. 246–249',
      'p. 270': 'p. 250–253',
      'p. 271': 'p. 254–255',
    };
    for (const [pages, grammar] of Object.entries(expected)) {
      expect(on(pages)).toHaveLength(1);
      expect(on(pages)[0].date > byPages(grammar).date).toBe(true);
    }
  });

  it('asks for the conditional and the imparfait only after their chapters', () => {
    const writeDay = (needle) => plan.days.find((d) => d.write?.includes(needle)).date;
    expect(writeDay('gagnais au loto') > byPages('p. 232–237').date).toBe(true);
    expect(writeDay("souvenir d'enfance") > byPages('p. 210–213').date).toBe(true);
  });
});

describe('Avancé, mapped to the book', () => {
  const av = studyDays.filter((d) => /^Av\. /.test(d.book));
  const pages = (d) =>
    d.book_pages
      .match(/p\. (\d+)–(\d+)/)
      .slice(1)
      .map(Number);
  const book = (d) => sessionsFor(d)[0].tasks.find((t) => t.id === 'book');
  const on = (needle) => plan.days.filter((d) => d.sunday_items?.some((i) => i.includes(needle)));

  it('runs from p. 6 to p. 165 with no gap except the bilan pages', () => {
    const skip = { 30: 34, 50: 52, 68: 70, 88: 90, 112: 114, 128: 130, 146: 148 };
    expect(pages(av[0])[0]).toBe(6);
    expect(pages(av.at(-1))[1]).toBe(165);
    av.slice(1).forEach((d, i) => {
      const next = pages(av[i])[1] + 1;
      expect(pages(d)[0]).toBe(skip[next] ?? next);
    });
  });

  it('never sets more than 4 pages a day, and only some days are light', () => {
    for (const d of av) expect(pages(d)[1] - pages(d)[0] + 1).toBeLessThanOrEqual(4);
    const light = av.filter((d) => d.book_light);
    expect(light.length).toBeGreaterThan(0);
    expect(light.every((d) => book(d).detail.includes('Lighter day'))).toBe(true);
    expect(av.filter((d) => !d.book_light).every((d) => !book(d).detail.includes('Lighter day'))).toBe(true);
  });

  it('never makes the subjunctive, conditional or linking chapters light', () => {
    const core = av.filter((d) =>
      /subjunctive|conditional|cause|consequence|opposition|concession|purpose/.test(d.book_focus),
    );
    expect(core.length).toBeGreaterThan(8);
    expect(core.every((d) => !d.book_light)).toBe(true);
  });

  it('sets every bilan once, then the final test and the activities', () => {
    for (let n = 1; n <= 8; n++) expect(on(`Avancé bilan ${n} `)).toHaveLength(1);
    expect(on('Avancé final test').map((d) => d.date)).toEqual(['2027-04-11']);
    expect(on('Activité communicative (25 min): p. 168–171')).toHaveLength(1);
    expect(on('Activité communicative (25 min): p. 180–184')).toHaveLength(1);
  });

  it('puts Vincent on the matching chapters', () => {
    const topics = (p) =>
      av
        .find((d) => d.book_pages === p)
        .vincent_later.map((l) => l.topic)
        .join(' | ');
    expect(topics('p. 52–53')).toContain('Subjunctive');
    expect(topics('p. 64–65')).toContain('Past conditional');
    expect(topics('p. 92–93')).toContain('tense changes');
  });

  it('does not offer Débutant answers on these pages', () => {
    expect(book(av[0]).answerPages).toBeUndefined();
  });
});

describe('writing practice matches the exam', () => {
  const write = (d) => sessionsFor(d)[0].tasks.find((t) => t.id === 'write');
  const find = (re, from = '') => studyDays.find((d) => d.date >= from && re.test(d.write));

  it('knows the word limit of each task', () => {
    expect(wordLimit('Tâche 1 (60–120 mots) : x')).toEqual([60, 120]);
    expect(wordLimit('Tâche 2 (120–150 mots) : x')).toEqual([120, 150]);
    expect(wordLimit('Tâche 3 timed (40 min) : x')).toEqual([120, 180]);
    expect(wordLimit('Remplis une fiche')).toBeNull();
  });

  it('counts words and flags anything outside the limit', () => {
    expect(countWords("  J'ai  mangé\nune pomme. ")).toBe(4);
    expect(countWords('   ')).toBe(0);
    expect(wordStatus(50, [60, 120])).toEqual({ text: '50 words: 10 short of the 60 minimum', off: true });
    expect(wordStatus(130, [60, 120])).toEqual({ text: '130 words: 10 over the 120 maximum', off: true });
    expect(wordStatus(100, [60, 120]).off).toBe(false);
    expect(wordStatus(1, null)).toEqual({ text: '1 word', off: false });
  });

  it('offers source texts on essay days only, with the topic and no leftover label', () => {
    const essay = find(/^Tâche 3/);
    expect(write(essay).sources).toContain(essay.write.split(' : ')[1]);
    expect(write(essay).sources).not.toContain('Tâche 3');
    expect(write(find(/^Tâche 1/)).sources).toBeUndefined();
  });

  it('asks you to type from 1 Feb, and not before', () => {
    expect(write(find(/^Tâche 1/)).detail).not.toContain('Type this');
    expect(write(find(/^Tâche 1/, '2027-02-01')).detail).toContain('Type this');
  });

  it('shows the counter on exam tasks but not on the beginner forms', () => {
    expect(write(studyDays[0]).counter).toBe(false);
    expect(write(find(/^Tâche 2/)).counter).toBe(true);
    expect(write(find(/^FULL writing/)).counter).toBe(true);
    expect(write(find(/^FULL writing/)).limit).toBeUndefined();
  });
});

describe('plan review changes', () => {
  const dated = (iso) => plan.days.find((d) => d.date === iso);
  const ids = (d) => (d.extras || []).map((x) => x.id);

  it('adds a daily article from 4 Jan to the exam, and none before', () => {
    expect(studyDays.filter((d) => d.date < '2027-01-04').every((d) => !ids(d).includes('article'))).toBe(true);
    expect(studyDays.filter((d) => d.date >= '2027-01-04').every((d) => ids(d).includes('article'))).toBe(true);
  });

  it('keeps 30 minutes of native audio every exam-mode study day', () => {
    for (const d of studyDays) expect(ids(d).includes('native-audio')).toBe(d.phase === 4);
  });

  it('has a tutor weekly from 2 Jan and twice a week in exam mode', () => {
    const tutor = studyDays.filter((d) => ids(d).includes('tutor'));
    expect(tutor[0].date).toBe('2027-01-02');
    expect(tutor.filter((d) => d.phase < 4).every((d) => new Date(d.date).getUTCDay() === 6)).toBe(true);
    const weekdays = new Set(tutor.filter((d) => d.phase === 4).map((d) => new Date(d.date).getUTCDay()));
    expect([...weekdays].sort()).toEqual([3, 6]);
  });

  it('puts the extras in the afternoon session with their own minutes', () => {
    const d = dated('2027-04-10');
    const tasks = sessionsFor(d)[1].tasks;
    for (const x of d.extras) expect(tasks.find((t) => t.id === x.id).minutes).toBe(x.minutes);
  });

  it('shows the real length of a multi-chapter Débutant day', () => {
    const d = studyDays.find((x) => x.book_topics?.length === 3);
    expect(sessionsFor(d)[0].tasks.find((t) => t.id === 'book').minutes).toBe(120);
  });

  it('schedules the baseline and the exam booking once each, on Sundays', () => {
    const items = (needle) =>
      plan.days.filter((d) => d.sunday_items?.some((i) => i.includes(needle))).map((d) => d.date);
    expect(items('Baseline test')).toEqual(['2026-11-15']);
    expect(items('Book your exam seats')).toEqual(['2027-02-07']);
  });

  it('no longer relies on being in France for speaking practice', () => {
    expect(JSON.stringify(plan.days)).not.toMatch(/café-langue|Meetup/);
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
    expect(plan.days.find((d) => d.date === '2026-11-30').book).toBe('Déb. 43–44');
    expect(plan.days.find((d) => d.date === '2026-12-01').book).toBe('Déb. 45–46');
  });

  it('shows pages and topics on the book task, and skips the bilan pages', () => {
    const d = deb[1];
    expect(d.book_pages).toBe('p. 14–17');
    const book = sessionsFor(d)[0].tasks.find((t) => t.id === 'book');
    expect(book.title).toBe('Book: Déb. 3–4, p. 14–17');
    expect(book.detail).toContain('Ch. 4: être');
    expect(plan.days.find((x) => x.date === '2026-12-03').book_pages).toBe('p. 122–123, 126–127');
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

  it('sets each of the 8 bilans once, on the first review day after its last chapter', () => {
    const where = (n) => sundays.filter((d) => d.sunday_items.some((t) => t.includes(`Bilan ${n} (`)));
    const expected = {
      1: '2026-11-15',
      2: '2026-11-22',
      3: '2026-11-22',
      4: '2026-11-29',
      5: '2026-11-29',
      6: '2026-12-06',
      7: '2026-12-06',
      8: '2026-12-09',
    };
    for (const [n, date] of Object.entries(expected)) expect(where(n).map((d) => d.date)).toEqual([date]);
    const last = sundays.find((d) => d.date === '2026-12-09');
    expect(last.sunday_items.some((t) => t.includes('final test on p. 173'))).toBe(true);
  });

  it('practises only grammar already reached in the book', () => {
    const before = (date) => deb.filter((d) => d.date < date);
    for (const d of before('2026-11-30')) {
      expect(`${d.write} ${d.speak}`).not.toMatch(/j'ai mangé|je suis arrivé|as fait hier|ton arrivée/i);
    }
    for (const d of before('2026-12-02')) expect(`${d.write} ${d.speak}`).not.toMatch(/quand j'étais|ton enfance/i);
    for (const d of before('2026-12-07')) expect(`${d.write} ${d.speak}`).not.toMatch(/j'en |avec en/i);
    expect(deb[3].write).toContain('je me lève'); // reflexive verbs, ch. 9
    expect(deb.at(-1).speak).toContain('BILAN');
  });
});

describe('book audio', () => {
  it('lists the 28 dialogues and 10 songs in the book, in page order', () => {
    expect(BOOK_AUDIO.map((a) => a.n)).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
    expect(BOOK_AUDIO.filter((a) => a.kind === 'dialogue')).toHaveLength(28);
    expect(BOOK_AUDIO.filter((a) => a.kind === 'song')).toHaveLength(10);
    for (let i = 1; i < 38; i++) expect(BOOK_AUDIO[i].page).toBeGreaterThanOrEqual(BOOK_AUDIO[i - 1].page);
    expect(BOOK_AUDIO[0].page).toBe(158);
    expect(BOOK_AUDIO.at(-1).page).toBe(172);
  });

  it('plays only from the publisher, one distinct address per recording', () => {
    for (const a of BOOK_AUDIO)
      expect(a.url).toMatch(/^https:\/\/progressive\.cle-international\.com\/9782090398502\//);
    expect(new Set(BOOK_AUDIO.map((a) => a.url)).size).toBe(38);
    expect(BOOK_AUDIO[0].url).toContain('/assets/audio-1-dialogue-1-p-158-1/download');
    expect(BOOK_AUDIO[29].url).toContain('/assets/audio-30-chanson-cest-dur-p-170-1/download');
  });
});

describe('everyday French in the Débutant month', () => {
  const deb = studyDays.filter((d) => d.phase === 1);
  const on = (date) => plan.days.find((d) => d.date === date);

  it('asks for practical writing: a form, a postcard, messages and a text', () => {
    expect(on('2026-11-09').write).toContain('Remplis une fiche');
    expect(on('2026-11-14').write).toContain('Carte postale');
    expect(on('2026-11-23').write).toContain('rendez-vous');
    expect(on('2026-11-28').write).toContain('SMS');
  });

  it('sets a different everyday reading task on every study day, and only in this month', () => {
    expect(new Set(deb.map((d) => d.read_task)).size).toBe(26);
    expect(studyDays.filter((d) => d.read_task)).toHaveLength(26);
    const t = sessionsFor(deb[12])[1].tasks.find((x) => x.id === 'reading');
    expect(t.title).toContain('train timetable');
    expect(t.minutes).toBe(10);
  });

  it('offers clothes and transport as one-tap flashcards on the right days', () => {
    expect(on('2026-11-16').word_set).toBe('clothes');
    expect(on('2026-11-28').word_set).toBe('transport');
    expect(deb.filter((d) => d.word_set)).toHaveLength(2);
    const t = sessionsFor(on('2026-11-28'))[2].tasks.find((x) => x.id === 'word-set');
    expect(t.addWords).toBe('transport');
    expect(t.title).toBe('New words: transport (20 cards)');
    for (const set of Object.values(WORD_SETS)) {
      expect(set.words).toHaveLength(20);
      expect(new Set(set.words.map(([fr]) => fr)).size).toBe(20);
      for (const [fr, en] of set.words) expect(fr && en).toBeTruthy();
    }
  });
});

describe('checking answers without the Corrigés', () => {
  it('names the chapters and asks for right or wrong, the rule and the error log', () => {
    const p = CHECK_PROMPT('Déb. 3–4', [{ ch: 3, topic: 'plural adjectives' }]);
    expect(p).toContain('Déb. 3–4 (plural adjectives)');
    expect(p).toContain('mark every answer right or wrong');
    expect(p).toContain('ask me instead of guessing');
    expect(p).toContain('what I wrote → correct version → rule');
  });

  it('is on the book task on study days with chapters, and not in exam mode', () => {
    const book = (d) => sessionsFor(d)[0].tasks.find((t) => t.id === 'book');
    for (const d of studyDays.filter((x) => x.phase < 4)) expect(book(d).check).toContain(d.book);
    for (const d of studyDays.filter((x) => x.phase === 4)) expect(book(d).check).toBeUndefined();
  });
});

describe('private answers', () => {
  const on = (date) => plan.days.find((d) => d.date === date);
  const answers = { pages: { 14: [{ n: 1, items: [['1', 'x']] }], 29: [{ n: 2, free: true }] } };

  it('reads pages from a label, including a gap', () => {
    expect(pagesFrom('p. 14–17')).toEqual([14, 15, 16, 17]);
    expect(pagesFrom('p. 122–123, 126–127')).toEqual([122, 123, 126, 127]);
    expect(pagesFrom(undefined)).toEqual([]);
  });

  it('finds only pages that have answers, and nothing without an import', () => {
    expect(answersFor(answers, [14, 15])).toEqual([{ page: 14, ex: answers.pages[14] }]);
    expect(answersFor(undefined, [14])).toEqual([]);
    expect(answersFor({}, [14])).toEqual([]);
  });

  it('points each task at its pages', () => {
    const book = sessionsFor(on('2026-11-10'))[0].tasks.find((t) => t.id === 'book');
    expect(book.answerPages).toEqual([14, 15, 16, 17]);
    const audio = sessionsFor(on('2026-11-18'))[1].tasks.find((t) => t.id === 'book-audio');
    expect(audio.answerPages).toEqual([158]);
    const song = sessionsFor(on('2026-11-11'))[1].tasks.find((t) => t.id === 'book-audio');
    expect(song.answerPages).toEqual([]);
  });

  it('points each Sunday at its Bilans and the final test', () => {
    const retest = (date) => sessionsFor(on(date))[0].tasks.find((t) => t.title.startsWith('Week re-test'));
    expect(retest('2026-11-15').answerPages).toEqual([28, 29]);
    expect(retest('2026-11-22').answerPages).toEqual([54, 55, 70, 71]);
    expect(retest('2026-12-06').answerPages).toEqual([124, 125, 136, 137]);
    expect(retest('2026-12-09').answerPages).toEqual([150, 151, 173]);
    expect(retest('2026-12-13').answerPages).toBeUndefined();
  });

  it('keeps no answers in the public plan', () => {
    expect(JSON.stringify(plan)).not.toContain('"answers"');
  });
});

describe('English first in the Débutant month', () => {
  const deb = studyDays.filter((d) => d.phase === 1);
  const morning = (d) => sessionsFor(d)[0].tasks;

  it('has a note for every chapter', () => {
    const notes = deb.flatMap((d) => d.book_topics);
    expect(notes).toHaveLength(60);
    for (const t of notes) expect(t.note.length).toBeGreaterThan(30);
  });

  it("puts the note and Vincent's grammar before the book, every day", () => {
    for (const d of deb) {
      const ids = morning(d).map((t) => t.id);
      expect(ids.indexOf('before-book')).toBeLessThan(ids.indexOf('book'));
      expect(morning(d).find((t) => t.id === 'before-book').notes).toEqual(d.book_topics);
    }
  });

  it('watches grammar in the morning, and word lists and extras in the afternoon', () => {
    const first = (date) =>
      plan.days
        .find((d) => d.date === date)
        .yt_links.filter((l) => l.first)
        .map((l) => l.topic)
        .join(' | ');
    const later = (date) =>
      plan.days
        .find((d) => d.date === date)
        .yt_links.filter((l) => !l.first)
        .map((l) => l.topic)
        .join(' | ');
    expect(first('2026-11-10')).toContain('être');
    expect(later('2026-11-10')).toContain('Silent e (extra)');
    expect(first('2026-11-30')).toContain('Passé composé');
    expect(first('2026-11-24')).toContain('du, de la, des');
    expect(later('2026-11-24')).toContain('Food words');
    for (const d of deb) {
      for (const l of d.yt_links.filter((x) => x.first)) expect(l.topic).not.toContain('(extra)');
    }
  });

  it('never loses or double-counts video time when it moves to the morning', () => {
    for (const d of deb) {
      const before = morning(d).find((t) => t.id === 'before-book').minutes;
      const after = sessionsFor(d)[1].tasks.find((t) => t.id === 'youtube')?.minutes || 0;
      const audio = d.book_audio?.minutes || 0;
      const total = d.yt_links.reduce((sum, l) => sum + l.to - l.from, 0) / 60 + d.yt_rest + audio;
      expect(Math.abs(before + after + audio - total)).toBeLessThan(2);
    }
  });

  it("says so when Vincent has no lesson on the day's grammar", () => {
    const none = deb.filter((d) => !d.yt_links.some((l) => l.first));
    for (const d of none) {
      const t = morning(d).find((x) => x.id === 'before-book');
      expect(t.title).toBe('Before the book: English note');
      expect(t.links).toBeUndefined();
    }
  });

  it('goes back to French first after Débutant', () => {
    const later = studyDays.find((d) => d.phase === 2);
    expect(morning(later).map((t) => t.id)).not.toContain('before-book');
  });

  it("lists the book's common words", () => {
    const words = BOOK_WORDS.flatMap(([, list]) => list);
    expect(words.length).toBeGreaterThan(40);
    expect(new Set(words.map(([fr]) => fr)).size).toBe(words.length);
    const book = morning(deb[0]).find((t) => t.id === 'book');
    expect(book.action.href).toBe('#/book-words');
  });
});

describe('focus timer', () => {
  it('counts down from an end time, and holds while paused', () => {
    expect(timerLeft({ endsAt: 10_000 }, 4_000)).toBe(6);
    expect(timerLeft({ endsAt: 10_000 }, 9_001)).toBe(1);
    expect(timerLeft({ endsAt: 10_000 }, 20_000)).toBe(0);
    expect(timerLeft({ left: 90 }, 20_000)).toBe(90);
    expect(timerLeft(null)).toBe(0);
  });

  it('survives the page being asleep, because it reads the clock instead of counting ticks', () => {
    const t = { endsAt: 1_000_000 };
    expect(timerLeft(t, 1_000_000 - 30 * 60_000)).toBe(30 * 60);
  });

  it('formats the clock', () => {
    expect(formatClock(90)).toBe('01:30');
    expect(formatClock(50 * 60)).toBe('50:00');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-5)).toBe('00:00');
  });

  it('takes minutes from the task, or from a Sunday title', () => {
    expect(taskMinutes({ minutes: 50, title: 'x' })).toBe(50);
    expect(taskMinutes({ title: 'Long speaking (90 min): café-langue' })).toBe(90);
    expect(taskMinutes({ title: 'Something else' })).toBe(25);
  });
});

describe('error log lines', () => {
  it('splits wrote → correct → rule', () => {
    expect(parseMistake("j'ai allé → je suis allé → aller takes être")).toEqual({
      wrong: "j'ai allé",
      right: 'je suis allé',
      rule: 'aller takes être',
    });
  });

  it('accepts the rule in brackets, and a plain arrow', () => {
    expect(parseMistake('le famille -> la famille (famille is feminine)')).toEqual({
      wrong: 'le famille',
      right: 'la famille',
      rule: 'famille is feminine',
    });
    expect(parseMistake("je suis 25 ans → j'ai 25 ans").rule).toBe('');
  });

  it('leaves anything else as a plain note', () => {
    expect(parseMistake('review ch. 8 again')).toEqual({ plain: 'review ch. 8 again' });
  });
});

describe('task text', () => {
  it('splits a long title at the French " : " only', () => {
    expect(splitTitle('Write: 8 phrases avec être : je suis, tu es')).toEqual({
      head: 'Write: 8 phrases avec être',
      tail: 'je suis, tu es',
    });
    expect(splitTitle('Book: Déb. 3–4, p. 14–17')).toEqual({ head: 'Book: Déb. 3–4, p. 14–17', tail: '' });
  });

  it('turns the book routine into numbered steps and keeps the chapter topics apart', () => {
    const { intro, steps } = detailParts(
      'Ch. 3: plural adjectives · Ch. 4: être. Read the examples, then the rule → close the book → check your answers.',
    );
    expect(intro).toBe('Ch. 3: plural adjectives · Ch. 4: être.');
    expect(steps).toEqual(['Read the examples, then the rule', 'Close the book', 'Check your answers.']);
  });

  it('leaves text without steps alone', () => {
    expect(detailParts('Record yourself and listen back')).toEqual({
      intro: 'Record yourself and listen back',
      steps: [],
    });
    expect(detailParts(undefined)).toEqual({ intro: '', steps: [] });
  });

  it('gives every book task in the plan real steps', () => {
    for (const d of plan.days.filter((x) => !x.sunday)) {
      const book = sessionsFor(d)[0].tasks.find((t) => t.id === 'book');
      expect(detailParts(book.detail).steps.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('the mistakes list', () => {
  const notes = {
    '2026-11-06': ["j'ai allé → je suis allé → aller takes être\n\nreview ch. 8", 1],
    '2026-11-08': ['elle a allé → elle est allée → Aller takes être', 2],
    '2026-11-07': ['nous avons allé → nous sommes allés → aller  takes être', 3],
  };

  it('lists every line, newest day first, remembering its position', () => {
    const lines = mistakeLines(notes);
    expect(lines.map((m) => m.date)).toEqual(['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-06']);
    expect(lines[2].index).toBe(0);
    expect(lines[3]).toEqual({ date: '2026-11-06', index: 2, plain: 'review ch. 8' });
  });

  it('spots a rule that comes back three times, however it was typed', () => {
    const [top, ...rest] = repeatedMistakes(mistakeLines(notes));
    expect(top.count).toBe(3);
    expect(top.firstDate).toBe('2026-11-06');
    expect(rest).toEqual([]);
  });

  it('does not flag twice, and ignores plain notes', () => {
    expect(repeatedMistakes(mistakeLines({ '2026-11-06': ['a → b → c\na2 → b2 → c', 1] }))).toEqual([]);
    expect(repeatedMistakes(mistakeLines({ '2026-11-06': ['x\nx\nx', 1] }))).toEqual([]);
  });

  it('adds and removes single lines', () => {
    expect(addNoteLine('', ' a → b ')).toBe('a → b');
    expect(addNoteLine('one\n', 'two')).toBe('one\ntwo');
    expect(removeNoteLine('one\ntwo\nthree', 1)).toBe('one\nthree');
  });
});

describe('offline files', () => {
  it('saves every file the app needs, and they all exist', () => {
    const sw = readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8');
    const list = [...sw.match(/PRECACHE = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const site = (f) => new URL(`../site/${f}`, import.meta.url);
    for (const f of list.filter((x) => x !== './')) expect(readFileSync(site(f)).length).toBeGreaterThan(0);
    const imports = (file) =>
      [...readFileSync(site(file), 'utf8').matchAll(/(?:from |import\()'\.\/([^']+)'/g)].map((m) => m[1]);
    for (const file of list.filter((x) => x.endsWith('.js'))) {
      if (file === 'sw.js') continue;
      for (const dep of imports(file)) expect(list).toContain(dep);
    }
  });
});

describe('the tutor page', () => {
  const page = readFileSync(new URL('../tutor/index.html', import.meta.url), 'utf8');
  const data = JSON.parse(page.match(/<script type="application\/json" id="plan">\s*([\s\S]*?)\s*<\/script>/)[1]);

  it('carries the whole plan, in step with the app', () => {
    expect(data.map((d) => d.date)).toEqual(plan.days.map((d) => d.date));
    const day = data.find((d) => d.date === '2026-11-10');
    expect(day.book).toBe('Déb. 3–4');
    expect(day.topics[0].ch).toBe(3);
    expect(data.find((d) => d.date === '2026-11-15').book).toBeUndefined();
  });

  it('holds no private material: only public plan fields', () => {
    const fields = new Set(data.flatMap((d) => Object.keys(d)));
    expect([...fields].sort()).toEqual(['book', 'date', 'pages', 'phase', 'topics', 'write']);
    expect(page).not.toMatch(/answers"|"ex":|deck\.words/);
  });

  it('keeps every section the app links to', () => {
    for (const name of ['explain', 'mark', 'write', 'quiz', 'exam']) expect(page).toContain(`${name}: {`);
  });
});

describe('app updates', () => {
  it('never reuses a cached copy of the service worker files', () => {
    const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
    expect(app).toMatch(/register\('sw\.js', \{ updateViaCache: 'none' \}\)/);
  });
});

describe('offline photo reader', () => {
  it('saves every engine file the photo page uses', async () => {
    const sw = readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8');
    const saved = [...sw.match(/const OCR_FILES = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const { OCR_FILES } = await import('../site/photo.js');
    const needed = OCR_FILES.filter((f) => !/LICENSE|NOTICE/.test(f)).map((f) => f.replace('vendor/ocr/', ''));
    expect(saved.sort()).toEqual(needed.sort());
    for (const f of saved)
      expect(readFileSync(new URL(`../site/vendor/ocr/${f}`, import.meta.url)).length).toBeGreaterThan(0);
  });
});

describe('book audio in the plan', () => {
  const withAudio = plan.days.filter((d) => d.book_audio);
  const dayOf = (n) => withAudio.find((d) => d.book_audio.items.includes(n)).date;

  it('places all 38 recordings exactly once', () => {
    const all = withAudio.flatMap((d) => d.book_audio.items).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
  });

  it("keeps the 28 dialogues in the book's order", () => {
    for (let n = 2; n <= 28; n++) expect(dayOf(n) >= dayOf(n - 1)).toBe(true);
  });

  it('never plays a recording before the grammar its label names', () => {
    expect(dayOf(1) >= '2026-11-18').toBe(true); // être, avoir: ch. 19
    expect(dayOf(9) >= '2026-11-23').toBe(true); // numbers: ch. 28
    expect(dayOf(16) >= '2026-11-27').toBe(true); // -ir, -re, -oir: ch. 39
    expect(dayOf(17) >= '2026-11-28').toBe(true); // vouloir, pouvoir, devoir: ch. 40
    expect(dayOf(19) >= '2026-11-30').toBe(true); // near future: ch. 43
    expect(dayOf(20) >= '2026-11-30').toBe(true); // passé composé in -é: ch. 44
    expect(dayOf(22) >= '2026-12-01').toBe(true); // passé composé with être: ch. 46
    expect(dayOf(26) >= '2026-12-02').toBe(true); // imparfait: ch. 47
    expect(dayOf(27) >= '2026-12-02').toBe(true); // simple future: ch. 48
    expect(dayOf(31) >= '2026-11-18').toBe(true); // song with pas de: ch. 20
    expect(dayOf(35) >= '2026-12-04').toBe(true); // song with questions: ch. 51–52
    expect(dayOf(37) >= '2026-12-05').toBe(true); // song with ne… plus: ch. 53
  });

  it('adds players for each recording, and keeps the video hour at 60 minutes', () => {
    for (const d of withAudio) {
      const tasks = sessionsFor(d)[1].tasks;
      const audio = tasks.find((t) => t.id === 'book-audio');
      expect(audio.players).toHaveLength(d.book_audio.items.length);
      expect(audio.players[0].url).toContain('progressive.cle-international.com');
      expect(audio.links).toBeUndefined(); // a plain link to these files would download them
    }
    const t = sessionsFor(plan.days.find((d) => d.date === '2026-11-18'))[1].tasks.find((x) => x.id === 'book-audio');
    expect(t.title).toBe('Book audio: Dialogues 1–4 (p. 158), song: Oui et non');
  });
});

describe('annexes (p. 152–153)', () => {
  const on = (date) => plan.days.find((d) => d.date === date);

  it('reads each section once its chapters are done', () => {
    const detail = (date) => sessionsFor(on(date))[0].tasks.find((t) => t.id === 'book').detail;
    expect(detail('2026-12-03')).toContain('Annexes §7');
    expect(detail('2026-12-05')).toContain('Annexes §1–3');
    expect(detail('2026-12-08')).toContain('Annexes §4');
    expect(sessionsFor(on('2026-12-03'))[0].tasks.find((t) => t.id === 'book').title).toContain('+ Annexes');
    expect(
      on('2026-12-05')
        .yt_links.map((l) => l.topic)
        .join(),
    ).toContain('Adverbs');
    expect(
      on('2026-12-03')
        .yt_links.map((l) => l.topic)
        .join(),
    ).toContain('Recent past');
  });

  it('finishes on the review day, Wed 9 Dec, with links to Vincent', () => {
    const sunday = on('2026-12-09');
    const task = sessionsFor(sunday)[0].tasks.find((t) => t.title.startsWith('Annexes §5'));
    const labels = task.links.map((l) => l.label).join(' | ');
    for (const t of ['Imperative', 'Indirect speech', 'celui, celle']) expect(labels).toContain(t);
    expect(labels).not.toContain('(cut)');
  });
});

describe('vocabulary book', () => {
  const vocabDays = plan.days.filter((d) => d.vocab);

  it('covers chapters 1–25 in two halves each, in order, between 10 Dec and 3 Apr on study days', () => {
    const expected = [];
    for (let c = 1; c <= 25; c++) expected.push(`ch. ${c}, first half`, `ch. ${c}, second half`);
    expect(vocabDays.map((d) => d.vocab)).toEqual(expected);
    for (const d of vocabDays) {
      expect(d.sunday).toBe(false);
      expect(d.date >= '2026-12-10' && d.date <= '2027-04-03').toBe(true);
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
    expect(totalMinutes(vday)).toBe(coreAndVincent(vday));
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

  it('fills the hour: Vincent, then book audio, then Super Easy French', () => {
    for (const d of vDays) {
      const min = d.yt_links.reduce((a, g) => a + g.to - g.from, 0) / 60;
      const used = min + (d.book_audio?.minutes || 0) + d.yt_rest;
      expect(min).toBeGreaterThan(0);
      expect(used).toBeGreaterThan(55);
      expect(used).toBeLessThan(65);
    }
  });

  it('puts each lesson on the day of its chapter', () => {
    const topicsOn = (date) =>
      plan.days
        .find((d) => d.date === date)
        .yt_links.map((l) => l.topic)
        .join(' | ');
    expect(topicsOn('2026-11-10')).toContain('être'); // ch. 4
    expect(topicsOn('2026-11-12')).toContain('-er verbs: spelling changes'); // ch. 8
    expect(topicsOn('2026-11-12')).toContain('Regular -er verbs'); // ch. 7, conjugation
    expect(topicsOn('2026-11-18')).toContain('avoir'); // ch. 19, conjugation
    expect(topicsOn('2026-11-19')).toContain('The preposition en'); // ch. 22
    expect(topicsOn('2026-11-21')).toContain("c'est + adjective"); // ch. 27
    expect(topicsOn('2026-11-23')).toContain('Numbers 0–9'); // ch. 28
    expect(topicsOn('2026-11-23')).toContain('Telling the time'); // ch. 29
    expect(topicsOn('2026-11-24')).toContain('Weather'); // ch. 30
    expect(topicsOn('2026-11-27')).toContain('venir'); // ch. 39, three-form verb
    expect(topicsOn('2026-11-30')).toContain('Passé composé of parler'); // ch. 44, -er verb
    expect(topicsOn('2026-12-01')).toContain('Passé composé of avoir'); // ch. 45, irregular
    expect(topicsOn('2026-12-01')).toContain('Verbs that take être'); // ch. 46
    expect(topicsOn('2026-12-02')).toContain('Imparfait'); // ch. 47
    expect(topicsOn('2026-12-04')).toContain('Three ways to ask a question'); // ch. 51
    expect(topicsOn('2026-12-08')).toContain('Relative pronouns: qui, que'); // ch. 60
  });

  it('stops a long lesson where it leaves the chapter', () => {
    const link = (date, topic) => plan.days.find((d) => d.date === date).yt_links.find((l) => l.topic.includes(topic));
    expect(link('2026-12-08', 'Relative pronouns').to).toBe(13690); // before agreement, dont, où
    expect(link('2026-11-16', 'ce, cet, cette').to).toBe(11989); // before celui, celle
    expect(link('2026-12-01', 'avoir or être + participle').to).toBe(24774); // before the advanced tenses
    expect(link('2026-11-19', 'The preposition en').to).toBe(24380); // before en + -ant
  });

  it("labels anything off the day's grammar as extra", () => {
    const topics = vDays.flatMap((d) => d.yt_links.map((l) => l.topic)).join(' | ');
    for (const t of ['Words that match English', 'Silent e', 'Liaison: required', '108 adjectives', 'False friends'])
      expect(topics).toContain(`${t} (extra)`);
  });

  it('keeps grammar beyond this volume out of November', () => {
    const all = vDays.flatMap((d) => d.yt_links.map((l) => l.topic)).join(' | ');
    for (const later of [
      'Subjunctive',
      'Conditional',
      'Passive',
      'Plus-que-parfait',
      'Indirect speech',
      'Imperative',
    ]) {
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
    const room = vDays.find((d) => d.yt_rest && !d.book_audio && d.yt_links.some((l) => !l.first));
    expect(task(room).links).toHaveLength(room.yt_links.filter((l) => !l.first).length + 1);
    expect(task(room).links.at(-1).label).toBe(`Super Easy French · ${room.yt_rest} min`);
    const full = vDays.find((d) => !d.yt_rest && d.yt_links.some((l) => !l.first));
    expect(task(full).links).toHaveLength(full.yt_links.filter((l) => !l.first).length);
  });

  it('formats H:MM:SS', () => {
    expect(hms(0)).toBe('0:00:00');
    expect(hms(28105)).toBe('7:48:25');
  });
});

describe('the whole Vincent series', () => {
  const lengths = { 1: 15015, 2: 16978, 3: 28105, 4: 17995, 5: 14074 };
  const later = plan.days.filter((d) => d.vincent_later);
  const sunday = plan.days.find((d) => d.date === '2026-12-09');
  const all = [
    ...plan.days.flatMap((d) => d.yt_links || []),
    ...plan.days.flatMap((d) => d.vincent_later || []),
    ...Object.values(sunday.sunday_links).flat(),
  ];

  it('covers all 5 videos end to end: nothing skipped, nothing twice', () => {
    for (let v = 1; v <= 5; v++) {
      const mine = all.filter((g) => g.video === v).sort((a, b) => a.from - b.from);
      expect(mine[0].from).toBe(0);
      for (let i = 1; i < mine.length; i++) expect(mine[i].from).toBe(mine[i - 1].to);
      expect(mine.at(-1).to).toBe(lengths[v]);
    }
  });

  it('runs the remaining lessons only on study days in the two later phases', () => {
    for (const d of later) {
      expect(d.sunday).toBe(false);
      expect([2, 3]).toContain(d.phase);
    }
    expect(later.every((d) => d.date >= '2026-12-10' && d.date <= '2027-04-07')).toBe(true);
  });

  it('keeps each phase to its level', () => {
    const topics = (ph) =>
      later
        .filter((d) => d.phase === ph)
        .flatMap((d) => d.vincent_later.map((l) => l.topic))
        .join(' | ');
    expect(topics(2)).toContain('Conditional');
    expect(topics(2)).toContain('Plus-que-parfait');
    expect(topics(2)).toContain('dont, où');
    expect(topics(2)).not.toContain('Subjunctive');
    expect(topics(3)).toContain('Subjunctive');
    expect(topics(3)).toContain('Passive');
    expect(topics(3)).toContain('Future perfect');
    expect(topics(3)).not.toContain('Plus-que-parfait');
  });

  it('teaches the conditional and the subjunctive in order', () => {
    const when = (topic) => later.find((d) => d.vincent_later.some((l) => l.topic.includes(topic))).date;
    expect(when('Conditional') <= when('Conditional: aller')).toBe(true);
    expect(when('Subjunctive') <= when('Past subjunctive')).toBe(true);
  });

  it('adds a task with links that keeps its own minutes', () => {
    const d = later[0];
    const t = sessionsFor(d)[1].tasks.find((x) => x.id === 'vincent-later');
    const secs = d.vincent_later.reduce((sum, l) => sum + l.to - l.from, 0);
    expect(t.minutes).toBe(Math.round(secs / 60));
    expect(t.title).toBe(`Vincent (${t.minutes} min)`);
    expect(t.links).toHaveLength(d.vincent_later.length);
  });

  it('keeps every lesson short enough to fit a day', () => {
    for (const d of later) {
      const secs = d.vincent_later.reduce((sum, l) => sum + l.to - l.from, 0);
      expect(secs / 60).toBeLessThan(40);
    }
  });
});

describe('sentences in the plan', () => {
  it('8 a day on study days from 4 Jan to 3 Apr, and the evening task says so', () => {
    const withSent = plan.days.filter((d) => d.sent);
    expect(withSent[0].date).toBe('2027-01-07');
    expect(withSent.at(-1).date).toBe('2027-04-07');
    expect(withSent.every((d) => d.sent === 8 && !d.sunday)).toBe(true);
    const day = withSent.find((d) => !d.vocab);
    const t = sessionsFor(day)[2].tasks.find((x) => x.id === 'anki-new');
    expect(t.title).toBe(`Flashcards: ${day.anki} new words + 8 sentences`);
    expect(totalMinutes(day)).toBe(coreAndVincent(day));
  });
});

describe('speaking cards in the plan', () => {
  it('6 a day on study days from 11 Jan to 3 Apr, named in the evening task', () => {
    const withSay = plan.days.filter((d) => d.say);
    expect(withSay[0].date).toBe('2027-01-14');
    expect(withSay.at(-1).date).toBe('2027-04-07');
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
