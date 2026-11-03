import {
  PHASE_NAMES,
  LINKS,
  WRITING_PROMPT,
  SPEAKING_PROMPT,
  EXPLAIN_PROMPT,
  localISO,
  addDays,
  dayNumber,
  clampDate,
  sessionsFor,
  dayProgress,
  overallProgress,
  groupByWeek,
  esc,
} from './logic.js';

const KEY = 'fr-a1-b2:v1';
const app = document.getElementById('app');
let plan = null;
let byDate = new Map();
let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { done: s.done || {}, notes: s.notes || {}, grammar: s.grammar || [] };
  } catch {
    return { done: {}, notes: {}, grammar: [] };
  }
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

const todayISO = () => clampDate(localISO(new Date()), plan.start, plan.end);
const longDate = (iso) =>
  new Date(...iso.split('-').map((n, i) => (i === 1 ? n - 1 : +n))).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

// ---------- views ----------

function viewDay(iso) {
  const day = byDate.get(iso);
  if (!day) return viewDay(todayISO());
  const n = dayNumber(iso, plan.start);
  const total = plan.days.length;
  const real = localISO(new Date());
  const isToday = iso === real;
  const prog = dayProgress(day, state.done[iso]);
  const overall = overallProgress(plan.days, state.done);
  let notice = '';
  if (real < plan.start) notice = `<p class="notice">Your plan starts on ${esc(longDate(plan.start))}.</p>`;
  if (real > plan.end)
    notice = `<p class="notice">The 182 days are over. Time for the exam, or another exam-mode block.</p>`;

  const sessions = sessionsFor(day)
    .map(
      (s) => `
    <section class="card session">
      <div class="session-head">
        <h2>${esc(s.title)}</h2>
        <p class="sub">${esc(s.note)}${s.tasks.some((t) => t.minutes) ? ` · ${s.tasks.reduce((a, t) => a + (t.minutes || 0), 0)} min` : ''}</p>
      </div>
      <ul class="tasks">${s.tasks.map((t) => taskRow(iso, t)).join('')}</ul>
    </section>`,
    )
    .join('');

  return `
    ${notice}
    <div class="day-head">
      <div>
        <p class="eyebrow">Day ${n} of ${total} · Week ${day.week} · ${esc(PHASE_NAMES[day.phase])}</p>
        <h1>${esc(longDate(iso))}${isToday ? ' <span class="today-mark">today</span>' : ''}</h1>
      </div>
      <div class="day-nav">
        ${iso > plan.start ? `<a class="btn" href="#/day/${addDays(iso, -1)}" aria-label="Previous day">←</a>` : '<span class="btn disabled" aria-hidden="true">←</span>'}
        ${!isToday && real >= plan.start && real <= plan.end ? `<a class="btn" href="#/today">Today</a>` : ''}
        ${iso < plan.end ? `<a class="btn" href="#/day/${addDays(iso, 1)}" aria-label="Next day">→</a>` : '<span class="btn disabled" aria-hidden="true">→</span>'}
      </div>
    </div>
    <div class="progress-row">
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${prog.total}" aria-valuenow="${prog.done}" aria-label="Today's tasks">
        <span style="width:${Math.round((prog.done / prog.total) * 100)}%"></span>
      </div>
      <p class="sub"><b>${prog.done}/${prog.total}</b> tasks today · <b>${overall.complete}</b> of ${overall.total} days complete</p>
    </div>
    ${sessions}
    <section class="card">
      <h2>Mistakes today</h2>
      <p class="sub">Write each mistake as: what you wrote → correct version → rule. They all show up on the Mistakes page.</p>
      <textarea id="notes" data-date="${iso}" rows="5" placeholder="j'ai allé → je suis allé (aller takes être)">${esc(state.notes[iso] || '')}</textarea>
    </section>`;
}

function taskRow(iso, t) {
  const done = (state.done[iso] || []).includes(t.id);
  const actions = [];
  if (t.link) actions.push(`<a class="act" href="${esc(t.link)}" target="_blank" rel="noopener">Open ↗</a>`);
  for (const l of t.links || [])
    actions.push(`<a class="act" href="${esc(l.url)}" target="_blank" rel="noopener">▶ ${esc(l.label)} ↗</a>`);
  const COPY_LABELS = {
    write: 'Copy correction prompt',
    speak: 'Copy examiner prompt',
    explain: 'Stuck? Explain in English',
  };
  if (t.copy)
    actions.push(
      `<button class="act" type="button" data-copy="${esc(t.copy)}">${COPY_LABELS[t.kind] || 'Copy prompt'}</button>`,
    );
  if (t.kind === 'explain')
    actions.push(`<a class="act" href="${LINKS.claude}" target="_blank" rel="noopener">Open Claude ↗</a>`);
  return `
    <li class="task${done ? ' done' : ''}">
      <button class="check" type="button" role="checkbox" aria-checked="${done}" data-task="${esc(t.id)}" data-date="${iso}" aria-label="Mark done: ${esc(t.title)}"></button>
      <div class="task-body">
        <p class="task-title">${esc(t.title)}</p>
        ${t.detail ? `<p class="task-detail">${esc(t.detail)}</p>` : ''}
        ${actions.length ? `<div class="acts">${actions.join('')}</div>` : ''}
      </div>
      ${t.minutes ? `<span class="mins">${t.minutes} min</span>` : ''}
    </li>`;
}

function viewPlan() {
  const overall = overallProgress(plan.days, state.done);
  const real = localISO(new Date());
  const weeks = groupByWeek(plan.days)
    .map(({ week, days }) => {
      const first = days[0];
      const last = days[days.length - 1];
      const rows = days
        .map((d) => {
          const p = dayProgress(d, state.done[d.date]);
          const status = p.complete ? '✓' : p.done ? `${p.done}/${p.total}` : '';
          const what = d.sunday ? 'Review day' : d.book;
          return `<li><a class="plan-day${d.date === real ? ' is-today' : ''}${p.complete ? ' is-done' : ''}" href="#/day/${d.date}">
            <span class="pd-date">${esc(d.day)}</span><span class="pd-what">${esc(what)}</span><span class="pd-status">${status}</span></a></li>`;
        })
        .join('');
      return `<section class="card week" id="w${week}">
        <h2>Week ${week} <span class="sub">· ${esc(first.day)} – ${esc(last.day)} · ${esc(PHASE_NAMES[first.phase])}</span></h2>
        <ul class="plan-days">${rows}</ul></section>`;
    })
    .join('');
  return `
    <h1>The 182-day plan</h1>
    <p class="sub">4 Nov 2026 → 4 May 2027. Tap a day to open its checklist.</p>
    <div class="progress-row">
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${overall.total}" aria-valuenow="${overall.complete}" aria-label="Days complete"><span style="width:${overall.pct}%"></span></div>
      <p class="sub"><b>${overall.complete}</b> of ${overall.total} days complete (${overall.pct}%)</p>
    </div>
    ${weeks}`;
}

function viewMistakes() {
  const entries = Object.entries(state.notes)
    .filter(([, v]) => v && v.trim())
    .sort(([a], [b]) => (a < b ? 1 : -1));
  const list = entries.length
    ? entries
        .map(
          ([d, v]) =>
            `<article class="card"><h2><a href="#/day/${d}">${esc(longDate(d))}</a></h2><pre class="note">${esc(v)}</pre></article>`,
        )
        .join('')
    : `<section class="card empty"><h2>No mistakes logged yet</h2><p class="sub">Each day has a "Mistakes today" box at the bottom. Review this page every Sunday: anything that shows up 3 or more times means redoing that book chapter.</p></section>`;
  return `
    <h1>Mistakes</h1>
    <p class="sub">Your error log, newest first. Review it every Sunday.</p>
    ${list}
    <section class="card">
      <h2>Backup</h2>
      <p class="sub">Progress lives in this browser only. Download a backup to keep it safe or move it to your phone.</p>
      <div class="acts">
        <button class="act" type="button" id="export">Download backup</button>
        <label class="act file">Restore from backup<input type="file" id="import" accept="application/json" /></label>
      </div>
      <p class="sub" id="backup-msg" role="status"></p>
    </section>`;
}

function viewMaterials() {
  const isbn = (n) =>
    `<a href="https://www.amazon.fr/s?k=${n}" target="_blank" rel="noopener">Amazon.fr</a> · <a href="https://www.fnac.com/SearchResult/ResultList.aspx?Search=${n}" target="_blank" rel="noopener">Fnac</a>`;
  return `
    <h1>Materials</h1>
    <p class="sub">Everything the plan uses, and nothing else.</p>

    <section class="card">
      <h2>The book: Grammaire progressive du français (CLE International)</h2>
      <p>The grammar workbook FLE teachers recommend most for self-study: the rule on the left page, exercises on the right. Three volumes take you from A1 to B2. <b>Always buy the matching Corrigés (answer key)</b>, or you can't check your own work.</p>
      <ul class="plain volumes">
        <li><p class="vol-when">Buy now · used 4 Nov – 3 Dec · A1</p><p class="task-title">Niveau débutant, 3e éd. (2025 "+ appli" printing), 60 chapters + Corrigés</p><p class="sub">ISBN 9782090398502 · ${isbn('9782090398502')}</p></li>
        <li><p class="vol-when">Buy late Nov · used 4 Dec – 2 Feb · A2–B1</p><p class="task-title">Niveau intermédiaire, 4e éd. + Corrigés</p><p class="sub">ISBN 9782090381030 · ${isbn('9782090381030')} · Corrigés 9782090381047</p></li>
        <li><p class="vol-when">Buy late Jan · used 3 Feb – 2 Apr · B1–B2</p><p class="task-title">Niveau avancé, 3e éd., 72 chapters + Corrigés</p><p class="sub">ISBN 9782090381979 · ${isbn('9782090381979')}</p></li>
      </ul>
      <p class="sub">Also at Gibert Joseph, Decitre and Cultura, or borrow them free from your médiathèque. The plan assumes 52 chapters in Intermédiaire; if your copy has a different number, keep about one a day and let the dates slide.</p>
    </section>

    <section class="card">
      <h2>The vocabulary book: Vocabulaire progressif du français (CLE International)</h2>
      <p>Same publisher and layout as the grammar books: a themed lesson on the left page, exercises on the right. It teaches words <b>by topic</b> (housing, work, health, travel…), which is what the TCF writing and speaking tasks are about. Anki alone teaches words one at a time.</p>
      <ul class="plain volumes">
        <li><p class="vol-when">Buy late Nov · used 4 Dec – 31 Mar · A2–B1</p><p class="task-title">Niveau intermédiaire + appli, 3e éd. (2025 printing), 25 chapters + Corrigés</p><p class="sub">ISBN 9782090398571 · ${isbn('9782090398571')} · Corrigés 9782090380163</p></li>
      </ul>
      <p class="sub">Half a chapter on 50 evenings (the app shows which), in place of that evening's deck words. Turn its key phrases into Anki cards, so Anki handles the spacing.</p>
    </section>

    <section class="card">
      <h2>Course: TV5MONDE EDU (free)</h2>
      <p>Video exercises from A1 to B2. France Éducation International, which runs the TCF, points candidates here for training. App on iOS/Android, or the website.</p>
      <div class="acts"><a class="act" href="${LINKS.tv5}" target="_blank" rel="noopener">apprendre.tv5monde.com ↗</a></div>
      <p class="sub">Level by date: A1 in November · A2 until mid-January · B1 until mid-March · B2 after that.</p>
    </section>

    <section class="card">
      <h2>YouTube (free)</h2>
      <ul class="plain">
        <li><b>4 Nov – 3 Dec · Vincent, "Learn French in 5 Days" (Legacy Version)</b>, 1 hour a day: Vincent's original A1 course, explained in English, with slow pronunciation drills. That makes it the English companion to the French-only Débutant book. Its 254 short lessons (5 videos, 25.6 h) are split into one-hour parts that start and end on a lesson. Each day's task has links that jump straight to the right second. Skip the paid french4me site advertised in the description; you don't need it. <a href="${LINKS.vincent}" target="_blank" rel="noopener">Playlist ↗</a></li>
        <li><b>Dec – Jan · Super Easy French</b> (Easy French): slow, real French for beginners. <a href="${LINKS.superEasyFrench}" target="_blank" rel="noopener">Videos ↗</a></li>
        <li><b>Feb – Mar · Easy French</b>: street interviews with French and English subtitles, which is what TCF listening sounds like. Subtitles on, then off. <a href="${LINKS.easyFrench}" target="_blank" rel="noopener">Channel ↗</a></li>
      </ul>
    </section>

    <section class="card">
      <h2>Memory engine: Anki (free)</h2>
      <ol>
        <li>Install <b>AnkiDroid</b> (Android, free) or use <b>AnkiWeb</b> in the browser (free). The iPhone app is paid.</li>
        <li>Deck options → <b>FSRS on</b>, <b>desired retention 0.90</b>.</li>
        <li>Add a shared "French frequency 5000" deck for words. Your own cards come from the grammar book (rules, cloze sentences), the vocabulary book (whole phrases) and every mistake.</li>
        <li>New words per evening: 25 until February, 20 in March, 15 in April–May. On vocabulary-book evenings, the 15–20 new cards come from the book instead of the deck. That's about 4,000 words by May.</li>
        <li>Never skip reviews. If short on time, cut new cards instead.</li>
      </ol>
      <div class="acts"><a class="act" href="https://apps.ankiweb.net" target="_blank" rel="noopener">apps.ankiweb.net ↗</a><a class="act" href="https://ankiweb.net/shared/decks?search=french%20frequency" target="_blank" rel="noopener">Shared decks ↗</a></div>
    </section>

    <section class="card">
      <h2>Correction: Claude + real people</h2>
      <p>Every day's writing and speaking task has a copy button with the full prompt. Paste it into Claude, then your text, or use voice mode for speaking. You're in France: whenever you can, swap a Claude session for a real conversation (café-langue, Meetup language exchange, shops).</p>
      <p><b>English explanations of the book:</b> the book is all in French. Read every rule in French first and try the exercises; that is reading practice for the TCF. Only if a rule is still unclear, use the book task's "Stuck? Explain in English" button. It copies a prompt that already names the volume and chapter numbers. In the Claude app, paste it, attach a photo of the chapter's rule page (the left page), and send. If you'd rather not take a photo, type the chapter title instead.</p>
      <details><summary>English explanation prompt</summary><pre class="note">${esc(EXPLAIN_PROMPT('Déb. 1–2'))}</pre></details>
      <details><summary>Writing correction prompt</summary><pre class="note">${esc(WRITING_PROMPT('[sujet du jour]'))}</pre></details>
      <details><summary>Speaking examiner prompt</summary><pre class="note">${esc(SPEAKING_PROMPT('[tâche du jour]', 2))}</pre></details>
      <div class="acts"><a class="act" href="${LINKS.claude}" target="_blank" rel="noopener">claude.ai ↗</a></div>
    </section>

    <section class="card">
      <h2>Exam papers: official TCF Canada samples (free)</h2>
      <p>From the people who write the test. Use them from February (Sunday mock sections) and daily in April.</p>
      <div class="acts"><a class="act" href="${LINKS.tcf}" target="_blank" rel="noopener">france-education-international.fr ↗</a></div>
    </section>`;
}

const GRAMMAR = [
  'Subjonctif présent (il faut que, bien que, pour que, avant que, emotions, doubt)',
  'Conditionnel présent + passé',
  'Si-clauses (all 3 types)',
  'Plus-que-parfait · futur antérieur',
  'Relative pronouns: qui, que, dont, où, lequel / auquel / duquel',
  'y / en · double pronouns',
  'Reported speech + concordance des temps',
  'Passive voice · gérondif · participe présent',
  'Connectors: cause, consequence, opposition, concession, purpose',
  'Mise en relief (c’est … qui / que)',
  'Complex negation (ne … plus / jamais / rien / personne / aucun / ni … ni)',
];

function viewMethod() {
  return `
    <h1>The method</h1>
    <p class="sub">Why the day is built the way it is.</p>

    <section class="card">
      <h2>Your 4 hours, timed for memory</h2>
      <table class="tbl">
        <thead><tr><th>Session</th><th>What</th><th>Why then</th></tr></thead>
        <tbody>
          <tr><td><b>Morning</b><br />~90 min</td><td>Anki reviews → new book chapter → Anki cards → short writing</td><td>Recalling right after sleep locks in yesterday's work. The hardest new material goes where attention peaks.</td></tr>
          <tr><td><b>Afternoon</b><br />~90 min</td><td>TV5MONDE → YouTube + shadowing → speaking</td><td>Input and output once the heavy learning is done.</td></tr>
          <tr><td><b>Evening</b><br />~60 min</td><td>New Anki words → re-tests → error log</td><td>Things learned shortly before sleep consolidate overnight. Finish 30 min before bed.</td></tr>
        </tbody>
      </table>
      <p class="sub">Take a 5–10 min break every ~45 min (stand up, no scrolling). Sleep 7–8 hours: cutting sleep to study more costs more than it gains.</p>
    </section>

    <section class="card">
      <h2>One chapter, done properly (~50 min)</h2>
      <ol>
        <li>Read the rule (left page) once, carefully.</li>
        <li><b>Close the book.</b> Say the rule aloud in your own words; write 2 examples from memory.</li>
        <li>Do the exercises (right page) <b>in writing, without looking back</b>.</li>
        <li>Check against the Corrigés. Circle every mistake.</li>
        <li>Make 2–3 Anki cards (one rule + cloze sentences). Every mistake becomes a card too.</li>
      </ol>
    </section>

    <section class="card">
      <h2>When things come back</h2>
      <table class="tbl">
        <thead><tr><th>Day 0</th><th>+1 day</th><th>+7 days</th><th>+30 days</th><th>Exam month</th></tr></thead>
        <tbody><tr><td>Learn (morning)</td><td>Re-test (evening)</td><td>Re-test (evening) + Sunday</td><td>Last Sunday of the month</td><td>Only what the error log flags</td></tr></tbody>
      </table>
      <p class="sub">Testing yourself beats re-reading by a wide margin, and mixing old topics with new ones beats studying one at a time. For an exam ~6 months away, the best final review gap is about 10–20% of the time left (Cepeda et al., 2008), hence the monthly review. Anki handles the timing of words, rules and your own mistakes automatically.</p>
    </section>

    <section class="card">
      <h2>The target: NCLC 7 in all four skills</h2>
      <table class="tbl">
        <thead><tr><th>TCF Canada</th><th>NCLC 7</th><th>Train to</th></tr></thead>
        <tbody>
          <tr><td>Listening (39 Q, 35 min)</td><td>458–502 / 699</td><td>~480</td></tr>
          <tr><td>Reading (39 Q, 60 min)</td><td>453–498 / 699</td><td>~480</td></tr>
          <tr><td>Writing (3 tasks, 60 min)</td><td>10–11 / 20</td><td>12</td></tr>
          <tr><td>Speaking (3 tasks, 12 min)</td><td>10–11 / 20</td><td>12</td></tr>
        </tbody>
      </table>
      <p class="sub">IRCC table, canada.ca (updated 16 Oct 2026). If even one skill is below NCLC 7, you don't qualify.</p>
    </section>

    <section class="card">
      <h2>Checkpoints</h2>
      <table class="tbl">
        <tbody>
          <tr><td>3 Dec</td><td>Débutant finished · ~700 words · 2-min self-intro, no notes</td></tr>
          <tr><td>3 Jan</td><td>Half of Intermédiaire · ~1,400 words · 10-min conversation</td></tr>
          <tr><td>3 Feb</td><td>Intermédiaire finished · ~2,100 words · first listening/reading mock (250–330 is normal)</td></tr>
          <tr><td>3 Mar</td><td>Half of Avancé · subjonctif, conditionnel, relatives · mocks ≥ 400</td></tr>
          <tr><td>3 Apr</td><td>Avancé finished · ~3,300 words · mocks ≥ 440 · writing/speaking ~10/20</td></tr>
          <tr><td>May</td><td>Two full mocks in a row at NCLC 7+ in all four skills → sit the exam</td></tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>B1–B2 grammar checklist</h2>
      <ul class="tasks">${GRAMMAR.map((g, i) => {
        const on = state.grammar.includes(i);
        return `<li class="task${on ? ' done' : ''}"><button class="check" type="button" role="checkbox" aria-checked="${on}" data-grammar="${i}" aria-label="Covered: ${esc(g)}"></button><div class="task-body"><p class="task-title">${esc(g)}</p></div></li>`;
      }).join('')}</ul>
    </section>`;
}

// ---------- routing ----------

function route() {
  const h = location.hash || '#/today';
  const [, name, arg] = h.split('/');
  let html;
  let tab = name;
  if (name === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(arg || '')) {
    html = viewDay(clampDate(arg, plan.start, plan.end));
    tab = arg === localISO(new Date()) ? 'today' : 'plan';
  } else if (name === 'plan') html = viewPlan();
  else if (name === 'mistakes') html = viewMistakes();
  else if (name === 'materials') html = viewMaterials();
  else if (name === 'method') html = viewMethod();
  else {
    html = viewDay(todayISO());
    tab = 'today';
  }
  app.innerHTML = html;
  document
    .querySelectorAll('.tabs a')
    .forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  if (name === 'plan') {
    const cur = document.querySelector('.plan-day.is-today');
    if (cur) cur.closest('.week').scrollIntoView({ block: 'start' });
  } else window.scrollTo(0, 0);
}

// ---------- events ----------

app.addEventListener('click', async (e) => {
  const check = e.target.closest('.check');
  if (check && check.dataset.task) {
    const { date, task } = check.dataset;
    const list = new Set(state.done[date] || []);
    list.has(task) ? list.delete(task) : list.add(task);
    state.done[date] = [...list];
    save();
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
    return;
  }
  if (check && check.dataset.grammar !== undefined) {
    const i = Number(check.dataset.grammar);
    state.grammar = state.grammar.includes(i) ? state.grammar.filter((x) => x !== i) : [...state.grammar, i];
    save();
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const text = copy.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const old = copy.textContent;
    copy.textContent = 'Copied ✓';
    setTimeout(() => (copy.textContent = old), 1500);
    return;
  }
  if (e.target.id === 'export') {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `french-plan-backup-${localISO(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
});

let noteTimer;
app.addEventListener('input', (e) => {
  if (e.target.id !== 'notes') return;
  const { date } = e.target.dataset;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    state.notes[date] = e.target.value;
    save();
  }, 300);
});

app.addEventListener('change', async (e) => {
  if (e.target.id !== 'import' || !e.target.files[0]) return;
  const msg = document.getElementById('backup-msg');
  try {
    const data = JSON.parse(await e.target.files[0].text());
    const ok =
      data && typeof data.done === 'object' && typeof data.notes === 'object' && Array.isArray(data.grammar || []);
    if (!ok) throw new Error('shape');
    state = { done: data.done, notes: data.notes, grammar: data.grammar || [] };
    save();
    msg.textContent = 'Backup restored.';
  } catch {
    msg.textContent = 'That file is not a backup from this plan.';
  }
});

window.addEventListener('hashchange', route);

fetch('data/schedule.json', { cache: 'no-cache' })
  .then((r) => r.json())
  .then((data) => {
    plan = data;
    byDate = new Map(plan.days.map((d) => [d.date, d]));
    route();
  })
  .catch(() => {
    app.innerHTML = '<p class="loading">Could not load the plan. Check your connection and reload.</p>';
  });
