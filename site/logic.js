// Pure logic shared by the app and the tests. No DOM, no storage.

export const PHASE_NAMES = {
  1: 'Débutant (A1)',
  2: 'Intermédiaire (A2 → B1)',
  3: 'Avancé (B1 → B2)',
  4: 'Exam mode (B2)',
};

// Minutes per block for each phase. Every phase adds up to 240 (4 hours).
export const MINUTES = {
  1: {
    ankiReview: 15,
    book: 50,
    cards: 10,
    write: 15,
    input: 40,
    youtube: 30,
    speak: 20,
    ankiNew: 25,
    retest: 15,
    errorLog: 20,
  },
  2: {
    ankiReview: 15,
    book: 50,
    cards: 10,
    write: 20,
    input: 35,
    youtube: 30,
    speak: 30,
    ankiNew: 25,
    retest: 15,
    errorLog: 10,
  },
  3: {
    ankiReview: 15,
    book: 40,
    cards: 10,
    write: 30,
    input: 30,
    youtube: 30,
    speak: 40,
    ankiNew: 20,
    retest: 15,
    errorLog: 10,
  },
  4: {
    ankiReview: 15,
    book: 20,
    cards: 0,
    write: 50,
    input: 50,
    youtube: 0,
    speak: 60,
    ankiNew: 20,
    retest: 15,
    errorLog: 10,
  },
};

export const LINKS = {
  tv5: 'https://apprendre.tv5monde.com/fr',
  alexa: 'https://www.youtube.com/@learnfrenchwithalexa',
  easyFrench: 'https://www.youtube.com/@easyfrench',
  superEasyFrench: 'https://www.youtube.com/@easyfrench/search?query=super%20easy%20french',
  tcf: 'https://www.france-education-international.fr/test/tcf-canada',
  claude: 'https://claude.ai',
};

export const WRITING_PROMPT = (topic) =>
  `Corrige ce texte (niveau visé : B2, TCF Canada). Sujet : ${topic}\n` +
  `Donne-moi : 1) la version corrigée, 2) chaque erreur avec la règle expliquée en anglais, ` +
  `3) une note estimée /20 selon les critères du TCF, 4) trois tournures plus naturelles.\n\n` +
  `Mon texte :\n`;

export const SPEAKING_PROMPT = (task, phase) =>
  phase === 1
    ? `Parle avec moi en français simple (niveau A1–A2). Sujet : ${task}. ` +
      `Pose-moi des questions une par une, attends ma réponse, puis corrige mes erreurs principales à la fin.`
    : `Tu es examinateur du TCF Canada. Fais-moi passer cette tâche d'expression orale : ${task}. ` +
      `Respecte le temps officiel, puis donne-moi une note /20 et corrige mes erreurs principales.`;

const VOLUMES = {
  'Déb.': { name: 'Niveau débutant (3e édition)', level: 'A1' },
  'Int.': { name: 'Niveau intermédiaire (4e édition)', level: 'A2–B1' },
  'Av.': { name: 'Niveau avancé (3e édition)', level: 'B1–B2' },
};

/**
 * Prompt asking Claude to explain the day's book chapter(s) in English. The chapter titles are not
 * in the data, so the prompt names the volume and chapter numbers and asks for a photo of the rule page.
 */
export const EXPLAIN_PROMPT = (book) => {
  const m = String(book).match(/^(Déb\.|Int\.|Av\.) (\d+)(?:–(\d+))?$/);
  const where = m
    ? `"Grammaire progressive du français", ${VOLUMES[m[1]].name}, ` +
      (m[3] ? `chapters ${m[2]} to ${m[3]}` : `chapter ${m[2]}`) +
      ` (my level: ${VOLUMES[m[1]].level})`
    : `"Grammaire progressive du français", [volume + chapter number]`;
  return (
    `I'm a native English speaker learning French with ${where}. ` +
    `I'm attaching a photo of the rule page (the left page) for each chapter. ` +
    `If there's no photo, the chapter title is: [type it here].\n\n` +
    `For each chapter, explain in English:\n` +
    `1) the rule in plain words, and how it differs from English;\n` +
    `2) when to use it and when not to;\n` +
    `3) the mistakes English speakers typically make with it;\n` +
    `4) 5 example sentences in French with English translations.\n` +
    `Then quiz me with 5 short questions, one at a time, and correct my answers.`
  );
};

/** Local calendar date as YYYY-MM-DD. Never use toISOString(): it is UTC and shifts the day in France. */
export function localISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

export function addDays(iso, n) {
  const [y, m, d] = parts(iso);
  return localISO(new Date(y, m, d + n));
}

/** 1-based day number of `iso` in a plan starting on `startIso` (DST-safe). */
export function dayNumber(iso, startIso) {
  return Math.round((Date.UTC(...parts(iso)) - Date.UTC(...parts(startIso))) / 86400000) + 1;
}

export function clampDate(iso, startIso, endIso) {
  if (iso < startIso) return startIso;
  if (iso > endIso) return endIso;
  return iso;
}

function youtubeLink(yt) {
  if (yt.includes('Alexa')) return LINKS.alexa;
  if (yt.includes('Super Easy')) return LINKS.superEasyFrench;
  return LINKS.easyFrench;
}

/** The checklist for one day, grouped into sessions. */
export function sessionsFor(day) {
  if (day.sunday) {
    return [
      {
        id: 'sunday',
        title: 'Review day',
        note: 'No new chapters today.',
        tasks: day.sunday_items.map((text, i) => ({ id: `sun-${i}`, title: text })),
      },
    ];
  }
  const m = MINUTES[day.phase];
  const exam = day.phase === 4;
  const morning = [
    { id: 'anki-review', title: 'Anki: all due reviews', minutes: m.ankiReview },
    {
      id: 'book',
      title: exam ? day.book : `Book: ${day.book}`,
      detail: 'Read the rule → close the book, say it aloud → exercises without looking → check the Corrigés',
      minutes: m.book,
      kind: 'explain',
      copy: EXPLAIN_PROMPT(day.book),
    },
  ];
  if (m.cards)
    morning.push({ id: 'cards', title: 'Make Anki cards: 2–3 per chapter + one per mistake', minutes: m.cards });
  morning.push({
    id: 'write',
    title: `Write: ${day.write}`,
    kind: 'write',
    minutes: m.write,
    copy: WRITING_PROMPT(day.write),
  });

  const afternoon = [{ id: 'input', title: day.tv5, minutes: m.input, link: exam ? LINKS.tcf : LINKS.tv5 }];
  if (m.youtube) {
    afternoon.push({
      id: 'youtube',
      title: day.yt,
      detail: 'Watch with subtitles, again without, then shadow 1 minute aloud',
      minutes: m.youtube,
      link: youtubeLink(day.yt),
    });
  }
  afternoon.push({
    id: 'speak',
    title: `Speak: ${day.speak}`,
    kind: 'speak',
    detail: 'Record yourself and listen back',
    minutes: m.speak,
    copy: SPEAKING_PROMPT(day.speak, day.phase),
  });

  const newWords = day.vocab
    ? {
        id: 'anki-new',
        title: `Vocabulary book: ${day.vocab}`,
        detail:
          'Read the lesson page, do its exercises, check the Corrigés, then add 15–20 key phrases to Anki (whole phrases, not single words)',
        minutes: m.ankiNew,
      }
    : { id: 'anki-new', title: `Anki: ${day.anki} new words`, minutes: m.ankiNew };
  const evening = [
    newWords,
    {
      id: 'retest',
      title: `Re-test: ${day.retest}`,
      detail: '1 exercise each, answers covered, from memory',
      minutes: m.retest,
    },
    {
      id: 'errorlog',
      title:
        day.phase <= 2
          ? 'Error log aloud (each correct version 3×) + light listening'
          : 'Error log aloud (each correct version 3×)',
      minutes: m.errorLog,
    },
  ];

  return [
    { id: 'morning', title: 'Morning', note: 'New material while you are freshest', tasks: morning },
    { id: 'afternoon', title: 'Afternoon', note: 'Input and speaking', tasks: afternoon },
    { id: 'evening', title: 'Evening', note: 'Consolidate before sleep', tasks: evening },
  ];
}

export function taskIds(day) {
  return sessionsFor(day).flatMap((s) => s.tasks.map((t) => t.id));
}

export function totalMinutes(day) {
  return sessionsFor(day)
    .flatMap((s) => s.tasks)
    .reduce((sum, t) => sum + (t.minutes || 0), 0);
}

/** How many of a day's tasks are done, given the saved list of done task ids. */
export function dayProgress(day, doneIds = []) {
  const ids = taskIds(day);
  const done = ids.filter((id) => doneIds.includes(id)).length;
  return { done, total: ids.length, complete: done === ids.length };
}

export function overallProgress(days, doneMap = {}) {
  let complete = 0;
  for (const d of days) if (dayProgress(d, doneMap[d.date]).complete) complete++;
  return { complete, total: days.length, pct: Math.round((complete / days.length) * 100) };
}

export function groupByWeek(days) {
  const weeks = new Map();
  for (const d of days) {
    if (!weeks.has(d.week)) weeks.set(d.week, []);
    weeks.get(d.week).push(d);
  }
  return [...weeks.entries()].map(([week, list]) => ({ week, days: list }));
}

/** HTML-escape, including single quotes (attribute safety). */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
