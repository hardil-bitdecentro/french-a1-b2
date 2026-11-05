import {
  PHASE_NAMES,
  LINKS,
  BOOK_AUDIO,
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
  streaks,
  streakTarget,
  esc,
} from './logic.js';
import * as S from './store.js';
import { queueStats, newLimitFor, sentLimitFor, sayLimitFor } from './cards.js';
import { renderCards, cardsClick, cardsKey, cardsSubmit, cardsChange, resetReview } from './cards-view.js';
import { createSync } from './syncctl.js';
import { idbGet, idbSet } from './db.js';
import { SYNC_URL } from './config.js';
import qrcode from './vendor/qrcode.mjs';

const KEY = 'fr-a1-b2:v1';
const app = document.getElementById('app');
let plan = null;
let byDate = new Map();
let deck = null;
let state = load();
let syncStatus = { state: 'off', lastOk: null };
let showPair = false;

function load() {
  try {
    return S.migrate(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return S.emptyState();
  }
}
function persist() {
  localStorage.setItem(KEY, JSON.stringify(state));
}
/** Save a local change and schedule a sync. */
function save() {
  persist();
  sync.schedule();
}

/** The plan-wide reset (plan.resetAt): keeps older progress from coming back from any source. */
const applyPlanReset = (s) => (plan && plan.resetAt ? S.applyReset(s, plan.resetAt) : s);

const sync = createSync({
  url: SYNC_URL,
  storage: localStorage,
  getState: () => state,
  setState: (s) => {
    state = s;
    persist();
    resetReview();
    if (plan) rerender({ keepScroll: true });
  },
  getDeck: async () => deck,
  setDeck: async (d) => {
    deck = d;
    await idbSet('deck', d);
    if (plan) rerender({ keepScroll: true });
  },
  prune: (s) => applyPlanReset(s),
  onStatus: (s) => {
    syncStatus = s;
    const el = document.getElementById('sync-status');
    if (el) el.textContent = statusText();
  },
});

function statusText() {
  if (!sync.configured) return 'The sync server is not set up yet.';
  if (!sync.enabled) return 'Sync is off on this device.';
  if (syncStatus.state === 'syncing') return 'Syncing…';
  if (syncStatus.state === 'error') return `Couldn't sync (${syncStatus.error}). It will retry.`;
  if (syncStatus.lastOk) return `Synced at ${new Date(syncStatus.lastOk).toLocaleTimeString('en-GB')}.`;
  return 'Sync is on.';
}

const todayISO = () => clampDate(localISO(new Date()), plan.start, plan.end);
const longDate = (iso) =>
  new Date(...iso.split('-').map((n, i) => (i === 1 ? n - 1 : +n))).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
/** The plan's new-word limit for today (before the start: day 1's; after the end: the last day's). */
const todaysNewLimit = () => newLimitFor(byDate.get(todayISO()));
const todaysSentLimit = () => sentLimitFor(byDate.get(todayISO()));
const todaysSayLimit = () => sayLimitFor(byDate.get(todayISO()));

// ---------- views ----------

function viewDay(iso) {
  const day = byDate.get(iso);
  if (!day) return viewDay(todayISO());
  const n = dayNumber(iso, plan.start);
  const total = plan.days.length;
  const real = localISO(new Date());
  const isToday = iso === real;
  const done = S.doneIds(state, iso);
  const prog = dayProgress(day, done);
  const doneMap = Object.fromEntries(plan.days.map((d) => [d.date, S.doneIds(state, d.date)]));
  const overall = overallProgress(plan.days, doneMap);
  const cardStats =
    isToday || iso === todayISO()
      ? queueStats(state, deck, todaysNewLimit(), new Date(), 20, todaysSentLimit(), todaysSayLimit())
      : null;
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
      <ul class="tasks">${s.tasks.map((t) => taskRow(iso, t, done, cardStats)).join('')}</ul>
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
      ${isToday ? streakLine(doneMap, day, prog.done) : ''}
    </div>
    ${sessions}
    <section class="card">
      <h2>Mistakes today</h2>
      <p class="sub">Write each mistake as: what you wrote → correct version → rule. They all show up on the Mistakes page. Turn the important ones into flashcards.</p>
      <textarea id="notes" data-date="${iso}" rows="5" placeholder="j'ai allé → je suis allé (aller takes être)">${esc(S.noteText(state, iso))}</textarea>
      <div class="acts"><a class="act" href="#/cards/add/mistake">Make a flashcard from a mistake</a></div>
    </section>`;
}

/** "🔥 5-day streak" line for today's view. */
function streakLine(doneMap, today, doneToday) {
  const real = localISO(new Date());
  if (real < plan.start || real > plan.end) return '';
  const st = streaks(plan.days, doneMap, real);
  const need = Math.max(0, streakTarget(today) - doneToday);
  const best = st.best > st.current ? ` · best ${st.best}` : '';
  let text;
  if (st.todayCounts) text = `🔥 <b>${st.current}</b>-day streak · today counts ✓${best}`;
  else if (st.current > 0)
    text = `🔥 <b>${st.current}</b>-day streak · tick ${need} more task${need === 1 ? '' : 's'} today to make it ${st.current + 1}${best}`;
  else text = `Start a streak: tick at least ${streakTarget(today)} of today's tasks (half the day)${best}.`;
  return `<p class="streak${st.todayCounts ? ' on' : ''}">${text}</p>`;
}

const COPY_LABELS = {
  write: 'Copy correction prompt',
  speak: 'Copy examiner prompt',
  explain: 'Stuck? Explain in English',
};

function taskRow(iso, t, done, cardStats) {
  const isDone = done.includes(t.id);
  const actions = [];
  if (t.action) actions.push(`<a class="act" href="${esc(t.action.href)}">${esc(t.action.label)} →</a>`);
  if (t.link) actions.push(`<a class="act" href="${esc(t.link)}" target="_blank" rel="noopener">Open ↗</a>`);
  for (const l of t.links || [])
    actions.push(`<a class="act" href="${esc(l.url)}" target="_blank" rel="noopener">▶ ${esc(l.label)} ↗</a>`);
  if (t.copy)
    actions.push(
      `<button class="act" type="button" data-copy="${esc(t.copy)}">${COPY_LABELS[t.kind] || 'Copy prompt'}</button>`,
    );
  if (t.kind === 'explain')
    actions.push(`<a class="act" href="${LINKS.claude}" target="_blank" rel="noopener">Open Claude ↗</a>`);
  let detail = t.detail || '';
  if (cardStats && t.id === 'anki-review') detail = `${cardStats.due} due now`;
  if (cardStats && t.id === 'anki-new' && !t.detail)
    detail = deck
      ? `${cardStats.newLeft} new words${t.title.includes('sentences') ? `, ${cardStats.sentLeft} sentences` : ''}${
          t.title.includes('to say') ? `, ${cardStats.sayLeft} to say` : ''
        } left today`
      : 'Import your word deck on the Cards page first';
  return `
    <li class="task${isDone ? ' done' : ''}">
      <button class="check" type="button" role="checkbox" aria-checked="${isDone}" data-task="${esc(t.id)}" data-date="${iso}" aria-label="Mark done: ${esc(t.title)}"></button>
      <div class="task-body">
        <p class="task-title">${esc(t.title)}</p>
        ${detail ? `<p class="task-detail">${esc(detail)}</p>` : ''}
        ${actions.length ? `<div class="acts">${actions.join('')}</div>` : ''}
      </div>
      ${t.minutes ? `<span class="mins">${t.minutes} min</span>` : ''}
    </li>`;
}

function viewPlan() {
  const doneMap = Object.fromEntries(plan.days.map((d) => [d.date, S.doneIds(state, d.date)]));
  const overall = overallProgress(plan.days, doneMap);
  const real = localISO(new Date());
  const weeks = groupByWeek(plan.days)
    .map(({ week, days }) => {
      const first = days[0];
      const last = days[days.length - 1];
      const rows = days
        .map((d) => {
          const p = dayProgress(d, doneMap[d.date]);
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
    <p class="sub">6 Nov 2026 → 6 May 2027. Tap a day to open its checklist.</p>
    <div class="progress-row">
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${overall.total}" aria-valuenow="${overall.complete}" aria-label="Days complete"><span style="width:${overall.pct}%"></span></div>
      <p class="sub"><b>${overall.complete}</b> of ${overall.total} days complete (${overall.pct}%)${(() => {
        const st = streaks(plan.days, doneMap, real);
        return st.best ? ` · 🔥 streak <b>${st.current}</b> (best ${st.best})` : '';
      })()}</p>
    </div>
    ${weeks}`;
}

function syncSection() {
  if (!sync.configured)
    return `<section class="card"><h2>Sync</h2><p class="sub" id="sync-status">${esc(statusText())}</p></section>`;
  const link = sync.link(location.href);
  let pair = '';
  if (sync.enabled && showPair && link) {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    pair = `<div class="pair">
      <div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
      <p class="sub">Scan this with your other device's camera, or copy the link and open it there. It pairs that device with this one.
      <b>Keep it private:</b> anyone with this code can read and change your progress.</p>
      <div class="acts"><button class="act" type="button" data-copy="${esc(link)}">Copy pairing link</button></div>
    </div>`;
  }
  return `<section class="card">
    <h2>Sync</h2>
    <p class="sub" id="sync-status">${esc(statusText())}</p>
    ${
      sync.enabled
        ? `<div class="acts">
            <button class="act" type="button" id="sync-now">Sync now</button>
            <button class="act" type="button" id="sync-pair">${showPair ? 'Hide pairing code' : 'Pair another device'}</button>
            <button class="act danger" type="button" id="sync-off">Turn off on this device</button>
          </div>${pair}`
        : `<p>Keeps your ticks, notes and flashcards the same on your phone and laptop. Everything is encrypted on your device before it's uploaded.</p>
          <div class="acts"><button class="btn primary" type="button" id="sync-on">Turn on sync</button></div>
          <form id="pair-form" class="form inline">
            <label>Already on another device? Paste its pairing link or code<input name="code" autocomplete="off" placeholder="https://…#/pair/…" /></label>
            <button class="btn" type="submit">Pair</button>
          </form>`
    }
    <p class="sub" id="sync-msg" role="status"></p>
  </section>`;
}

function viewMistakes() {
  const entries = Object.entries(state.notes)
    .map(([d, [text]]) => [d, text])
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
    ${syncSection()}
    <section class="card">
      <h2>Backup</h2>
      <p class="sub">A file copy of your ticks, notes and flashcards (the word deck itself isn't included: re-import it from <code>french-5000-words.json</code>). Restoring merges with what's here.</p>
      <div class="acts">
        <button class="act" type="button" id="export">Download backup</button>
        <label class="act file">Restore from backup<input type="file" id="import" accept="application/json" /></label>
      </div>
      <p class="sub" id="backup-msg" role="status"></p>
    </section>`;
}

function viewAudio() {
  const rows = (kind) =>
    BOOK_AUDIO.filter((a) => a.kind === kind)
      .map(
        (a) => `
        <li>
          <p class="task-title">${esc(a.title)} <span class="sub">p. ${a.page}</span></p>
          <audio class="book-audio" controls preload="none" src="${esc(a.url)}" aria-label="${esc(a.title)}, page ${a.page}"></audio>
        </li>`,
      )
      .join('');
  return `
    <p class="crumb"><a href="#/materials">← Materials</a></p>
    <h1>Book audio</h1>
    <p class="sub">The Débutant book's recordings. Open the page, listen once with the text covered, once following it, then repeat aloud. They play from CLE International's site, so they need internet.</p>
    <section class="card">
      <h2>Dialogues</h2>
      <ul class="plain">${rows('dialogue')}</ul>
    </section>
    <section class="card">
      <h2>Songs: La grammaire en chantant</h2>
      <ul class="plain">${rows('song')}</ul>
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
        <li><p class="vol-when">Buy now · used 6 Nov – 5 Dec · A1</p><p class="task-title">Niveau débutant, 3e éd. (2025 "+ appli" printing), 60 chapters + Corrigés</p><p class="sub">ISBN 9782090398502 · ${isbn('9782090398502')}</p></li>
        <li><p class="vol-when">Buy late Nov · used 7 Dec – 4 Feb · A2–B1</p><p class="task-title">Niveau intermédiaire, 4e éd. + Corrigés</p><p class="sub">ISBN 9782090381030 · ${isbn('9782090381030')} · Corrigés 9782090381047</p></li>
        <li><p class="vol-when">Buy late Jan · used 5 Feb – 3 Apr · B1–B2</p><p class="task-title">Niveau avancé, 3e éd., 72 chapters + Corrigés</p><p class="sub">ISBN 9782090381979 · ${isbn('9782090381979')}</p></li>
      </ul>
      <div class="acts"><a class="act" href="#/audio">▶ Débutant audio: 28 dialogues + 10 songs →</a></div>
      <p class="sub">Also at Gibert Joseph, Decitre and Cultura, or borrow them free from your médiathèque. The plan assumes 52 chapters in Intermédiaire; if your copy has a different number, keep about one a day and let the dates slide.</p>
    </section>

    <section class="card">
      <h2>The vocabulary book: Vocabulaire progressif du français (CLE International)</h2>
      <p>Same publisher and layout as the grammar books: a themed lesson on the left page, exercises on the right. It teaches words <b>by topic</b> (housing, work, health, travel…), which is what the TCF writing and speaking tasks are about. A frequency deck alone teaches words one at a time.</p>
      <ul class="plain volumes">
        <li><p class="vol-when">Buy late Nov · used 7 Dec – 2 Apr · A2–B1</p><p class="task-title">Niveau intermédiaire + appli, 3e éd. (2025 printing), 25 chapters + Corrigés</p><p class="sub">ISBN 9782090398571 · ${isbn('9782090398571')} · Corrigés 9782090380163</p></li>
      </ul>
      <p class="sub">Half a chapter on 50 evenings (the app shows which), in place of that evening's deck words. Turn its key phrases into flashcards, so the app handles the spacing.</p>
    </section>

    <section class="card">
      <h2>Where to buy in Paris: Fnac stock</h2>
      <p class="sub">"On the shelf" (en rayon) stock as checked on 3 Nov 2026. It changes daily, so check the Fnac page before you go. "Retrait 1H en magasin" on each page reserves a copy for free pickup within an hour.</p>
      <p><b>Go to Fnac Paris – Forum des Halles:</b> it's the only store with all four books on the shelf (€81.10 together).</p>
      <ul class="plain volumes">
        <li><p class="vol-when">Grammar · €26.80 · 176 pages</p><p class="task-title">Grammaire progressive du français, débutant + appli, 3e éd.</p><p class="sub">In stock: Forum des Halles, Ternes. Limited: Saint-Lazare, Gare Montparnasse, Bercy Village, La Défense-CNIT, Thiais, Créteil, Vélizy, Parinor. Not at Gare Châtelet, Gare Auber, Gare de l'Est. <a href="https://www.fnac.com/a21695847/Maia-Gregoire-Grammaire-progressive-du-francais-debutant-appli-3e-ed" target="_blank" rel="noopener">Fnac page ↗</a></p></li>
        <li><p class="vol-when">Grammar answer key · €12.70 · 40 pages</p><p class="task-title">Grammaire progressive du français A1 débutant, corrigés 3e éd.</p><p class="sub">Limited: Forum des Halles, Montparnasse, Ternes, Beaugrenelle, Boulogne. <a href="https://www.fnac.com/a12795338/Maia-Gregoire-Grammaire-progressive-du-francais-A1-debutant-corriges-3eme-edition" target="_blank" rel="noopener">Fnac page ↗</a></p></li>
        <li><p class="vol-when">Vocabulary · €28.10 · 208 pages</p><p class="task-title">Vocabulaire progressif intermédiaire + appli, 3e éd.</p><p class="sub">In stock: Forum des Halles. Limited: Montparnasse, Ternes, Gennevilliers, La Défense-CNIT, Herblay, Cergy, Carré Sénart, Val d'Europe. <a href="https://www.fnac.com/a21695846/Claire-Leroy-Miquel-Vocabulaire-progressif-intermediaire-appli-3e-edition" target="_blank" rel="noopener">Fnac page ↗</a></p></li>
        <li><p class="vol-when">Vocabulary answer key · €13.50 · 32 pages</p><p class="task-title">Corrigés vocabulaire progressif, niveau intermédiaire, 3e éd.</p><p class="sub"><b>Only at Forum des Halles</b>, limited, so buy or reserve it early even though you only need the book from 7 Dec. <a href="https://www.fnac.com/a11187087/Claire-Miquel-Corriges-vocabulaire-progressif-niveau-intermediaire-3e-edition" target="_blank" rel="noopener">Fnac page ↗</a></p></li>
      </ul>
      <p class="sub">Intermédiaire and Avancé grammar volumes: buy in late Nov / late Jan; use the Amazon.fr / Fnac links in the book list above.</p>
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
        <li><b>6 Nov – 5 Dec · Vincent, "Learn French in 5 Days" (Legacy Version)</b>, matched to the book: Vincent's original course, explained in English, with slow pronunciation drills. That makes it the English companion to the French-only Débutant book, so each afternoon you watch his lessons on that morning's chapters, in the book's order, and Super Easy French fills the rest of the hour. Each link starts on the lesson and tells you where to stop. His advanced lessons (conditional, subjunctive, passive and more) wait until you reach them in the later volumes. Skip the paid french4me site advertised in the description; you don't need it. <a href="${LINKS.vincent}" target="_blank" rel="noopener">Playlist ↗</a></li>
        <li><b>Dec – Jan · Super Easy French</b> (Easy French): slow, real French for beginners. <a href="${LINKS.superEasyFrench}" target="_blank" rel="noopener">Videos ↗</a></li>
        <li><b>Feb – Mar · Easy French</b>: street interviews with French and English subtitles, which is what TCF listening sounds like. Subtitles on, then off. <a href="${LINKS.easyFrench}" target="_blank" rel="noopener">Channel ↗</a></li>
      </ul>
    </section>

    <section class="card">
      <h2>Flashcards: built into this app</h2>
      <ol>
        <li>Open the <a href="#/cards">Cards</a> tab. Once, import <code>french-5000-words.json</code> (the 5,000 most frequent French words, made from your Anki deck and kept in <code>~/projects/french-private/</code>). It stays on your device and in your encrypted sync, never on this website.</li>
        <li>Scheduling uses <b>FSRS</b>, the same algorithm Anki uses, aiming for 90% recall. Answer honestly: Again, Hard, Good or Easy.</li>
        <li>New words per day follow the plan: 25 until February, 20 in March, 15 in April–May. On vocabulary-book evenings and Sundays there are no new deck words; add your own cards from the book instead.</li>
        <li>Your own cards come from the grammar book (rules, example sentences), the vocabulary book (whole phrases) and every mistake. The "Add a card" buttons on those tasks take you straight there.</li>
        <li>Tap 🔊 to hear the word in your device's French voice.</li>
        <li>Never skip reviews. If short on time, skip the new words instead.</li>
      </ol>
      <div class="acts"><a class="act" href="#/cards">Open Cards →</a></div>
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
          <tr><td><b>Morning</b><br />~90 min</td><td>Flashcard reviews → new book chapter → new flashcards → short writing</td><td>Recalling right after sleep locks in yesterday's work. The hardest new material goes where attention peaks.</td></tr>
          <tr><td><b>Afternoon</b><br />~90 min</td><td>TV5MONDE → YouTube + shadowing → speaking</td><td>Input and output once the heavy learning is done.</td></tr>
          <tr><td><b>Evening</b><br />~60 min</td><td>New flashcard words → re-tests → error log</td><td>Things learned shortly before sleep consolidate overnight. Finish 30 min before bed.</td></tr>
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
        <li>Make 2–3 flashcards (the rule + example sentences). Every mistake becomes a card too.</li>
      </ol>
    </section>

    <section class="card">
      <h2>When things come back</h2>
      <table class="tbl">
        <thead><tr><th>Day 0</th><th>+1 day</th><th>+7 days</th><th>+30 days</th><th>Exam month</th></tr></thead>
        <tbody><tr><td>Learn (morning)</td><td>Re-test (evening)</td><td>Re-test (evening) + Sunday</td><td>Last Sunday of the month</td><td>Only what the error log flags</td></tr></tbody>
      </table>
      <p class="sub">Testing yourself beats re-reading by a wide margin, and mixing old topics with new ones beats studying one at a time. For an exam ~6 months away, the best final review gap is about 10–20% of the time left (Cepeda et al., 2008), hence the monthly review. The flashcards handle the timing of words, rules and your own mistakes automatically.</p>
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
          <tr><td>5 Dec</td><td>Débutant finished · ~700 words · 2-min self-intro, no notes</td></tr>
          <tr><td>5 Jan</td><td>Half of Intermédiaire · ~1,400 words · 10-min conversation</td></tr>
          <tr><td>5 Feb</td><td>Intermédiaire finished · ~2,100 words · first listening/reading mock (250–330 is normal)</td></tr>
          <tr><td>5 Mar</td><td>Half of Avancé · subjonctif, conditionnel, relatives · mocks ≥ 400</td></tr>
          <tr><td>5 Apr</td><td>Avancé finished · ~3,300 words · mocks ≥ 440 · writing/speaking ~10/20</td></tr>
          <tr><td>May</td><td>Two full mocks in a row at NCLC 7+ in all four skills → sit the exam</td></tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>B1–B2 grammar checklist</h2>
      <ul class="tasks">${GRAMMAR.map((g, i) => {
        const on = S.grammarOn(state, i);
        return `<li class="task${on ? ' done' : ''}"><button class="check" type="button" role="checkbox" aria-checked="${on}" data-grammar="${i}" aria-label="Covered: ${esc(g)}"></button><div class="task-body"><p class="task-title">${esc(g)}</p></div></li>`;
      }).join('')}</ul>
    </section>`;
}

// ---------- routing ----------

const cardsCtx = () => ({
  state,
  deck,
  newLimit: todaysNewLimit(),
  sentLimit: todaysSentLimit(),
  sayLimit: todaysSayLimit(),
  save,
  rerender,
  setDeck: async (d, { upload } = {}) => {
    if (upload) {
      d.importedAt = Date.now();
      S.setSetting(state, 'deckAt', d.importedAt);
      save();
    }
    deck = d;
    await idbSet('deck', d);
    if (upload && sync.enabled) sync.syncNow();
  },
});

function route() {
  const h = location.hash || '#/today';
  const [, name, arg, arg2] = h.split('/');
  if (name === 'pair' && arg) {
    history.replaceState(null, '', '#/mistakes');
    sync
      .pair(arg)
      .then(() => {
        rerender();
        flash('#sync-msg', 'Paired ✓ This device now syncs with your other one.');
      })
      .catch((err) => {
        rerender();
        flash('#sync-msg', err.message);
      });
    return route();
  }
  let html;
  let tab = name;
  if (name === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(arg || '')) {
    html = viewDay(clampDate(arg, plan.start, plan.end));
    tab = arg === localISO(new Date()) ? 'today' : 'plan';
  } else if (name === 'plan') html = viewPlan();
  else if (name === 'cards') html = renderCards(cardsCtx(), arg === 'add' ? arg2 : null);
  else if (name === 'mistakes') html = viewMistakes();
  else if (name === 'materials') html = viewMaterials();
  else if (name === 'audio') {
    html = viewAudio();
    tab = 'materials';
  } else if (name === 'method') html = viewMethod();
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
  } else if (name === 'cards' && arg === 'add') {
    document.getElementById('add')?.scrollIntoView({ block: 'start' });
    document.querySelector('#add-card [name=front]')?.focus({ preventScroll: true });
  } else window.scrollTo(0, 0);
}

function flash(sel, text) {
  const el = document.querySelector(sel);
  if (el) el.textContent = text;
}

/** Re-render the current view, optionally keeping the scroll position, focusing a field, or showing a message. */
function rerender({ keepScroll = true, focus, msg } = {}) {
  // A sync landing in the background must not cut off the recording being played.
  if ([...document.querySelectorAll('audio')].some((a) => !a.paused)) return;
  const y = window.scrollY;
  const h = location.hash;
  if (h.startsWith('#/cards/add')) history.replaceState(null, '', '#/cards');
  route();
  if (keepScroll) window.scrollTo(0, y);
  if (focus) document.querySelector(focus)?.focus({ preventScroll: true });
  if (msg) flash(msg[0], msg[1]);
}

// ---------- events ----------

app.addEventListener('click', async (e) => {
  if (location.hash.startsWith('#/cards') && (await cardsClick(e, cardsCtx()))) return;
  const check = e.target.closest('.check');
  if (check && check.dataset.task) {
    const { date, task } = check.dataset;
    S.setDone(state, date, task, !S.doneIds(state, date).includes(task));
    save();
    rerender();
    return;
  }
  if (check && check.dataset.grammar !== undefined) {
    const i = Number(check.dataset.grammar);
    S.setGrammar(state, i, !S.grammarOn(state, i));
    save();
    rerender();
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
  const id = e.target.closest('button')?.id;
  if (id === 'export') {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `french-plan-backup-${localISO(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (id === 'sync-on') {
    await sync.enable();
    showPair = true;
    rerender();
  } else if (id === 'sync-now') {
    await sync.syncNow({ full: true });
  } else if (id === 'sync-pair') {
    showPair = !showPair;
    rerender();
  } else if (id === 'sync-off') {
    sync.disable();
    showPair = false;
    rerender();
  }
});

app.addEventListener('submit', async (e) => {
  if (cardsSubmit(e, cardsCtx())) return;
  if (e.target.id === 'pair-form') {
    e.preventDefault();
    try {
      await sync.pair(new FormData(e.target).get('code'));
      rerender();
      flash('#sync-msg', 'Paired ✓ This device now syncs with your other one.');
    } catch (err) {
      flash('#sync-msg', err.message);
    }
  }
});

let noteTimer;
app.addEventListener('input', (e) => {
  if (e.target.id !== 'notes') return;
  const { date } = e.target.dataset;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    S.setNote(state, date, e.target.value);
    save();
  }, 300);
});

app.addEventListener('change', async (e) => {
  if (await cardsChange(e, cardsCtx())) return;
  if (e.target.id !== 'import' || !e.target.files[0]) return;
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (!data || typeof data !== 'object' || typeof data.done !== 'object') throw new Error('shape');
    state = applyPlanReset(S.merge(state, S.migrate(data)));
    save();
    resetReview();
    rerender({ msg: ['#backup-msg', 'Backup restored (merged with this device).'] });
  } catch {
    flash('#backup-msg', 'That file is not a backup from this plan.');
  }
});

// Only one recording plays at a time. "play" doesn't bubble, so listen in the capture phase.
document.addEventListener(
  'play',
  (e) => {
    for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause();
  },
  true,
);

document.addEventListener('keydown', (e) => {
  if (location.hash.startsWith('#/cards')) cardsKey(e, cardsCtx());
});

document.addEventListener('visibilitychange', () => {
  if (!sync.enabled) return;
  if (document.visibilityState === 'hidden') sync.flush();
  else sync.syncNow();
});

window.addEventListener('hashchange', route);

Promise.all([
  fetch('data/schedule.json', { cache: 'no-cache' }).then((r) => r.json()),
  idbGet('deck').catch(() => null),
])
  .then(([data, savedDeck]) => {
    plan = data;
    byDate = new Map(plan.days.map((d) => [d.date, d]));
    deck = savedDeck || null;
    const before = JSON.stringify(state);
    const after = applyPlanReset(state);
    if (JSON.stringify(after) !== before) {
      // Keep this device's old progress privately, so the reset can be undone by hand if ever needed.
      if (!localStorage.getItem(`${KEY}:before-reset`)) localStorage.setItem(`${KEY}:before-reset`, before);
      state = after;
      persist();
    }
    route();
    if (sync.enabled) sync.syncNow({ full: !deck });
  })
  .catch(() => {
    app.innerHTML = '<p class="loading">Could not load the plan. Check your connection and reload.</p>';
  });
