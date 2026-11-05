// Pure logic shared by the app and the tests. No DOM, no storage.

export const PHASE_NAMES = {
  1: 'Débutant (A1)',
  2: 'Intermédiaire (A2 → B1)',
  3: 'Avancé (B1 → B2)',
  4: 'Exam mode (B2)',
};

// Minutes per block for each phase. Every phase adds up to 240 (4 hours).
export const MINUTES = {
  // Phase 1: 1 hour of Vincent's lessons on the day's chapters, topped up with Super Easy French.
  1: {
    ankiReview: 15,
    book: 50,
    cards: 10,
    write: 15,
    input: 20,
    youtube: 60,
    speak: 20,
    ankiNew: 25,
    retest: 15,
    errorLog: 10,
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
  vincent: 'https://www.youtube.com/playlist?list=PLdR5FaFp7N5M',
  tcf: 'https://www.france-education-international.fr/test/tcf-canada',
  claude: 'https://claude.ai',
};

const AUDIO_BASE = 'https://progressive.cle-international.com/9782090398502/assets';
const DIALOGUE_PAGES = [
  158, 158, 158, 158, 159, 159, 159, 160, 161, 161, 162, 162, 162, 163, 163, 164, 165, 165, 165, 166, 166, 167, 167,
  168, 168, 169, 169, 169,
];
const SONGS = [
  ['Je parle français', 170, 'je-parle-francais'],
  ["C'est dur", 170, 'cest-dur'],
  ['Oui et non', 170, 'oui-et-non'],
  ['Quand tu pleures', 171, 'quand-tu-pleures'],
  ['Ah, quelle journée !', 171, 'ah-quelle-journee'],
  ["C'est ma vie", 171, 'cest-ma-vie'],
  ["Ça, c'est la question", 172, 'ca-cest-la-question'],
  ['Votez pour moi', 172, 'votez-pour-moi'],
  ['Bonnes résolutions', 172, 'bonnes-resolutions'],
  ['Ma langue', 172, 'ma-langue'],
];

/**
 * The Débutant book's free recordings. They play from the publisher's own site, because this repo and
 * site are public: the audio itself must never be committed here.
 */
export const BOOK_AUDIO = [
  ...DIALOGUE_PAGES.map((page, i) => ({
    n: i + 1,
    kind: 'dialogue',
    title: `Dialogue ${i + 1}`,
    page,
    url: `${AUDIO_BASE}/audio-${i + 1}-dialogue-${i + 1}-p-${page}-1/download`,
  })),
  ...SONGS.map(([title, page, slug], i) => ({
    n: i + 29,
    kind: 'song',
    title,
    page,
    url: `${AUDIO_BASE}/audio-${i + 29}-chanson-${slug}-p-${page}-1/download`,
  })),
];

/** Everyday topics the word deck leaves thin. Added as the learner's own flashcards with one tap. */
export const WORD_SETS = {
  clothes: {
    title: 'clothes',
    words: [
      ['un pantalon', 'trousers'],
      ['un jean', 'jeans'],
      ['une chemise', 'a shirt'],
      ['un t-shirt', 'a T-shirt'],
      ['un pull', 'a jumper'],
      ['une robe', 'a dress'],
      ['une jupe', 'a skirt'],
      ['une veste', 'a jacket'],
      ['un manteau', 'a coat'],
      ['un costume', 'a suit'],
      ['une cravate', 'a tie'],
      ['une ceinture', 'a belt'],
      ['une écharpe', 'a scarf'],
      ['un chapeau', 'a hat'],
      ['une casquette', 'a cap'],
      ['des gants', 'gloves'],
      ['des chaussettes', 'socks'],
      ['des chaussures', 'shoes'],
      ['des bottes', 'boots'],
      ['des baskets', 'trainers'],
    ],
  },
  transport: {
    title: 'transport',
    words: [
      ['le métro', 'the underground'],
      ['le bus', 'the bus'],
      ['le train', 'the train'],
      ['le tramway', 'the tram'],
      ['le taxi', 'the taxi'],
      ['le vélo', 'the bicycle'],
      ['la voiture', 'the car'],
      ["l'avion", 'the plane (masculine)'],
      ['à pied', 'on foot'],
      ['la gare', 'the train station'],
      ['la station', 'the metro station'],
      ["l'arrêt de bus", 'the bus stop (masculine)'],
      ["l'aéroport", 'the airport (masculine)'],
      ['le quai', 'the platform'],
      ['le billet', 'the ticket (train, plane)'],
      ['le ticket', 'the ticket (metro, bus)'],
      ['la correspondance', 'the connection, the change'],
      ['le départ', 'the departure'],
      ["l'arrivée", 'the arrival (feminine)'],
      ['le retard', 'the delay'],
    ],
  },
};

/** The French the book's instructions and rule boxes use constantly. */
export const BOOK_WORDS = [
  [
    'Instructions',
    [
      ['Complétez', 'Fill in the blanks'],
      ['selon le modèle', 'following the example'],
      ['Répondez', 'Answer'],
      ['Transformez', 'Change, rewrite'],
      ['Mettez au pluriel', 'Put into the plural'],
      ['Mettez au féminin', 'Put into the feminine'],
      ['Reliez', 'Join, match'],
      ['Choisissez', 'Choose'],
      ['Soulignez', 'Underline'],
      ['Lisez', 'Read'],
      ['Écrivez', 'Write'],
      ['Décrivez', 'Describe'],
      ['Imaginez', 'Imagine, make something up'],
      ['Continuez', 'Carry on'],
      ['Posez des questions', 'Ask questions'],
      ['Présentez-vous', 'Introduce yourself'],
      ['Faites des phrases', 'Make sentences'],
      ['Associez', 'Match up'],
      ['manquant', 'missing'],
      ['plusieurs solutions', 'several possible answers'],
    ],
  ],
  [
    'Grammar words',
    [
      ['le verbe', 'verb'],
      ['le nom', 'noun'],
      ["l'adjectif", 'adjective'],
      ["l'article", 'article'],
      ['le pronom', 'pronoun'],
      ['masculin, féminin', 'masculine, feminine'],
      ['singulier, pluriel', 'singular, plural'],
      ['la négation, la forme négative', 'the negative'],
      ["l'interrogation", 'questions'],
      ['la conjugaison', 'verb forms'],
      ["l'infinitif", 'the infinitive (parler, finir)'],
      ['le présent', 'present tense'],
      ['le participe passé', 'past participle (mangé, fini)'],
      ['la voyelle, la consonne', 'vowel, consonant'],
      ['la place', 'position, where it goes'],
    ],
  ],
  [
    'In the rules',
    [
      ['Attention', 'Watch out'],
      ['exemple', 'example'],
      ['devant', 'before, in front of'],
      ['après', 'after'],
      ['toujours', 'always'],
      ['souvent', 'often'],
      ['en général', 'usually'],
      ['sauf', 'except'],
      ['comme', 'like, as'],
      ['on prononce', "it's pronounced"],
      ['ne change pas', "doesn't change"],
      ['devient', 'becomes'],
      ['pour', 'for, in order to'],
      ['ou', 'or'],
    ],
  ],
];

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
 * Prompt asking Claude to explain the day's book chapter(s) in English. It names the volume, the chapter
 * numbers and, where the plan has them (Débutant), the topics; otherwise it asks for the chapter title.
 */
export const EXPLAIN_PROMPT = (book, topics) => {
  const m = String(book).match(/^(Déb\.|Int\.|Av\.) (\d+)(?:–(\d+))?$/);
  const where = m
    ? `"Grammaire progressive du français", ${VOLUMES[m[1]].name}, ` +
      (m[3] ? `chapters ${m[2]} to ${m[3]}` : `chapter ${m[2]}`) +
      ` (my level: ${VOLUMES[m[1]].level})`
    : `"Grammaire progressive du français", [volume + chapter number]`;
  const about = topics?.length
    ? `These chapters cover: ${topics.map((t) => `${t.ch}) ${t.topic}`).join('; ')}.\n\n`
    : `If there's no photo, the chapter title is: [type it here].\n\n`;
  return (
    `I'm a native English speaker learning French with ${where}. ` +
    `I'm attaching a photo of the rule page (the left page) for each chapter. ` +
    about +
    `For each chapter, explain in English:\n` +
    `1) the rule in plain words, and how it differs from English;\n` +
    `2) when to use it and when not to;\n` +
    `3) the mistakes English speakers typically make with it;\n` +
    `4) 5 example sentences in French with English translations.\n` +
    `Then quiz me with 5 short questions, one at a time, and correct my answers.`
  );
};

/** Book pages in a label like "p. 122–123, 126–127". */
export function pagesFrom(label) {
  const pages = [];
  for (const [, a, b] of String(label || '').matchAll(/(\d+)(?:–(\d+))?/g)) {
    for (let n = Number(a); n <= Number(b || a); n++) pages.push(n);
  }
  return pages;
}

/** The learner's private answers for these pages, from the imported deck. Nothing here without one. */
export function answersFor(answers, pages) {
  return (pages || []).filter((p) => answers?.pages?.[p]).map((p) => ({ page: p, ex: answers.pages[p] }));
}

/** Prompt asking Claude to mark the day's exercises from a photo, for when the Corrigés aren't to hand. */
export const CHECK_PROMPT = (book, topics) =>
  `I'm a native English speaker working through "Grammaire progressive du français", ${book}` +
  (topics?.length ? ` (${topics.map((t) => t.topic).join('; ')})` : '') +
  `. I'm attaching a photo of the exercise page with my answers written in.\n\n` +
  `For each exercise:\n` +
  `1) mark every answer right or wrong;\n` +
  `2) give the correct answer for each wrong one, and say when more than one answer is acceptable;\n` +
  `3) explain each mistake in one line of English, with the rule;\n` +
  `4) if you can't read my writing or the question, ask me instead of guessing.\n\n` +
  `Then list my mistakes for my error log, one per line: what I wrote → correct version → rule.`;

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

/** H:MM:SS for a number of seconds. */
export function hms(sec) {
  const h = Math.floor(sec / 3600);
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Direct links to the day's Vincent lessons: each starts on the lesson and says where to stop. */
export function vincentLinks(ytLinks) {
  return ytLinks.map((l) => ({
    label: `${l.topic} · stop at ${hms(l.to)}`,
    url: `https://www.youtube.com/watch?v=${l.id}&t=${l.from}s`,
  }));
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
        tasks: day.sunday_items.map((text, i) => {
          const links = day.sunday_links?.[i];
          return {
            id: `sun-${i}`,
            title: text,
            ...(links ? { links: vincentLinks(links) } : {}),
            ...(day.sunday_answer_pages?.[i] ? { answerPages: day.sunday_answer_pages[i] } : {}),
          };
        }),
      },
    ];
  }
  const m = MINUTES[day.phase];
  const exam = day.phase === 4;
  const firstLinks = (day.yt_links || []).filter((l) => l.first);
  const firstMinutes = Math.round(firstLinks.reduce((sum, l) => sum + l.to - l.from, 0) / 60);
  const morning = [
    {
      id: 'anki-review',
      title: 'Flashcards: all due reviews',
      minutes: m.ankiReview,
      action: { label: 'Review now', href: '#/cards' },
    },
    ...(day.book_topics
      ? [
          {
            id: 'before-book',
            title: firstLinks.length
              ? `Before the book: English note + Vincent (${firstMinutes} min)`
              : 'Before the book: English note',
            detail: firstLinks.length
              ? 'Read the note, then watch. Repeat every word aloud with Vincent.'
              : "Vincent has no lesson on this chapter's grammar, so read the note carefully.",
            notes: day.book_topics,
            minutes: firstMinutes,
            ...(firstLinks.length ? { links: vincentLinks(firstLinks) } : {}),
          },
        ]
      : []),
    {
      id: 'book',
      title: exam
        ? day.book
        : `Book: ${day.book}${day.book_pages ? `, ${day.book_pages}` : ''}${day.book_annex ? ' + Annexes' : ''}`,
      detail:
        (day.book_topics ? `${day.book_topics.map((t) => `Ch. ${t.ch}: ${t.topic}`).join(' · ')}. ` : '') +
        (day.book_annex ? `${day.book_annex}. ` : '') +
        (day.book_topics ? 'Read the examples on the left page, then the rule' : 'Read the rule') +
        ' → close the book, say it aloud → exercises without looking → check your answers (Corrigés, or the button below). Take as long as it needs.',
      ...(day.book_topics ? { action: { label: 'French words in the book', href: '#/book-words' } } : {}),
      minutes: m.book,
      kind: 'explain',
      copy: EXPLAIN_PROMPT(day.book, day.book_topics),
      check: exam ? undefined : CHECK_PROMPT(day.book, day.book_topics),
      answerPages: pagesFrom(day.book_pages),
    },
  ];
  if (m.cards)
    morning.push({
      id: 'cards',
      title: 'Make flashcards: 2–3 per chapter + one per mistake',
      minutes: m.cards,
      action: { label: 'Add a card', href: '#/cards/add/book' },
    });
  morning.push({
    id: 'write',
    title: `Write: ${day.write}`,
    kind: 'write',
    minutes: m.write,
    copy: WRITING_PROMPT(day.write),
  });

  const afternoon = [{ id: 'input', title: day.tv5, minutes: m.input, link: exam ? LINKS.tcf : LINKS.tv5 }];
  if (m.youtube && day.yt_links) {
    const laterLinks = day.yt_links.filter((l) => !l.first);
    const laterMinutes = Math.round(laterLinks.reduce((sum, l) => sum + l.to - l.from, 0) / 60);
    const links = vincentLinks(laterLinks);
    if (day.yt_rest) links.push({ label: `Super Easy French · ${day.yt_rest} min`, url: LINKS.superEasyFrench });
    const names = [
      ...(laterLinks.length ? [`Vincent: words and sounds (${laterMinutes} min)`] : []),
      ...(day.yt_rest ? [`Super Easy French (${day.yt_rest} min)`] : []),
    ];
    if (names.length) {
      afternoon.push({
        id: 'youtube',
        title: names.join(', then '),
        detail: [
          ...(laterLinks.length ? ['Repeat every word aloud with Vincent.'] : []),
          ...(day.yt_rest ? ['Super Easy French: subtitles on, then shadow 1 minute aloud.'] : []),
        ].join(' '),
        minutes: laterMinutes + day.yt_rest,
        links,
      });
    }
    if (day.book_audio) {
      afternoon.push({
        id: 'book-audio',
        title: `Book audio: ${day.book_audio.title}`,
        detail:
          'Open the page. Listen with the text covered, then following it, then repeat aloud and do the questions on the page.',
        minutes: day.book_audio.minutes,
        answerPages: [...new Set(day.book_audio.items.filter((n) => n <= 28).map((n) => BOOK_AUDIO[n - 1].page))],
        // Played in the page: the publisher serves these as downloads, so a plain link would save a file.
        players: day.book_audio.items.map((n) => {
          const a = BOOK_AUDIO[n - 1];
          return { label: `${a.title} · p. ${a.page}`, url: a.url };
        }),
      });
    }
  } else if (m.youtube) {
    afternoon.push({
      id: 'youtube',
      title: day.yt,
      detail: 'Watch with subtitles, again without, then shadow 1 minute aloud',
      minutes: m.youtube,
      link: youtubeLink(day.yt),
    });
  }
  if (day.vincent_later) {
    const seconds = day.vincent_later.reduce((sum, l) => sum + l.to - l.from, 0);
    const minutes = Math.round(seconds / 60);
    afternoon.push({
      id: 'vincent-later',
      title: `Vincent (${minutes} min)`,
      detail: 'His next lessons, explained in English, in order of difficulty. Repeat the examples aloud.',
      minutes,
      links: vincentLinks(day.vincent_later),
    });
  }
  if (day.read_task) {
    afternoon.push({
      id: 'reading',
      title: `Read: ${day.read_task}`,
      detail: 'In real life or online. Read for the gist, look up 3 words, then make a flashcard from one of them.',
      minutes: 10,
      action: { label: 'Add a card', href: '#/cards/add/vocab' },
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
          'Read the lesson page, do its exercises, check the Corrigés, then add 15–20 key phrases as flashcards (whole phrases, not single words)' +
          (day.sent ? `. Then ${day.sent} new sentences${day.say ? ` and ${day.say} to say` : ''} in Cards.` : ''),
        minutes: m.ankiNew,
        action: { label: 'Add cards', href: '#/cards/add/vocab' },
      }
    : {
        id: 'anki-new',
        title:
          `Flashcards: ${day.anki} new words` +
          (day.sent ? ` + ${day.sent} sentences` : '') +
          (day.say ? ` + ${day.say} to say` : ''),
        minutes: m.ankiNew,
        action: { label: 'Start', href: '#/cards' },
      };
  const evening = [
    newWords,
    ...(day.word_set
      ? [
          {
            id: 'word-set',
            title: `New words: ${WORD_SETS[day.word_set].title} (${WORD_SETS[day.word_set].words.length} cards)`,
            detail: 'Add them once, then learn them in Cards with your other flashcards.',
            minutes: 10,
            addWords: day.word_set,
          },
        ]
      : []),
    {
      id: 'retest',
      title: `Re-test: ${day.retest}`,
      detail: `${day.retest_note ? `${day.retest_note}. ` : ''}1 exercise each, answers covered, from memory`,
      minutes: m.retest,
    },
    {
      id: 'errorlog',
      title:
        day.phase === 2
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

/** A day keeps the streak alive once at least half of its tasks are ticked (the "minimum day" rule). */
export function streakTarget(day) {
  return Math.ceil(taskIds(day).length / 2);
}

export function dayCounts(day, doneIds = []) {
  return dayProgress(day, doneIds).done >= streakTarget(day);
}

/**
 * Current and best streak up to `todayIso`. Today only adds to the streak once it counts; until then the
 * streak still stands from yesterday (the day isn't over yet).
 */
export function streaks(days, doneMap = {}, todayIso) {
  let run = 0;
  let best = 0;
  let todayCounts = false;
  for (const d of days) {
    if (d.date > todayIso) break;
    if (dayCounts(d, doneMap[d.date])) {
      run++;
      best = Math.max(best, run);
      if (d.date === todayIso) todayCounts = true;
    } else if (d.date !== todayIso) run = 0;
  }
  return { current: run, best, todayCounts };
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
