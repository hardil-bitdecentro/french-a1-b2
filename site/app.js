import {
  PHASE_NAMES,
  LINKS,
  answersFor,
  timerLeft,
  formatClock,
  taskMinutes,
  splitTitle,
  detailParts,
  mistakeLines,
  repeatedMistakes,
  addNoteLine,
  removeNoteLine,
  WORD_SETS,
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
import { queueStats, newLimitFor, sentLimitFor, sayLimitFor, newOwnCard } from './cards.js';
import { renderCards, cardsClick, cardsKey, cardsSubmit, cardsChange, resetReview, prefillCard } from './cards-view.js';
import { createSync } from './syncctl.js';
import { createReminders } from './reminders.js';
import { recorderHtml, mountRecorder, speakClick, isBusy } from './speak.js';
import { photoHtml, photoClick, photoChange } from './photo-view.js';
import { viewBookWords, viewAudio, viewMaterials, viewMethod } from './pages.js';
import { idbGet, idbSet } from './db.js';
import { SYNC_URL, TUTOR_URL } from './config.js';
import qrcode from './vendor/qrcode.mjs';

const KEY = 'fr-a1-b2:v1';
const app = document.getElementById('app');
let plan = null;
let byDate = new Map();
let deck = null;
let state = load();
let syncStatus = { state: 'off', lastOk: null };
let showPair = false;
let installPrompt = null;
let timerTick = null;
let wakeLock = null;

const TIMER_KEY = `${KEY}:timer`;
let timer = (() => {
  try {
    return JSON.parse(localStorage.getItem(TIMER_KEY) || 'null');
  } catch {
    return null;
  }
})();

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
  updateQuiet();
}

/** The plan-wide reset (plan.resetAt): keeps older progress from coming back from any source. */
const applyPlanReset = (s) => (plan && plan.resetAt ? S.applyReset(s, plan.resetAt) : s);

/** Someone is typing or recording, so a background sync must not redraw the page under them. */
const isEditing = () => isBusy() || !!document.activeElement?.closest?.('#app input, #app textarea, #app select');

const sync = createSync({
  url: SYNC_URL,
  storage: localStorage,
  getState: () => state,
  setState: (s) => {
    state = s;
    persist();
    resetReview();
    if (plan && !isEditing()) rerender({ keepScroll: true });
  },
  getDeck: async () => deck,
  setDeck: async (d) => {
    deck = d;
    await idbSet('deck', d);
    if (plan && !isEditing()) rerender({ keepScroll: true });
  },
  prune: (s) => applyPlanReset(s),
  onStatus: (s) => {
    syncStatus = s;
    const el = document.getElementById('sync-status');
    if (el) el.textContent = statusText();
  },
});

const reminders = createReminders({ url: SYNC_URL, getAuth: () => sync.auth(), storage: localStorage });

function statusText() {
  if (!sync.configured) return 'The sync server is not set up yet.';
  if (!sync.enabled) return 'Sync is off on this device.';
  if (syncStatus.state === 'syncing') return 'Syncing…';
  if (syncStatus.state === 'error') return `Couldn't sync (${syncStatus.error}). It will retry.`;
  if (syncStatus.lastOk) return `Synced at ${new Date(syncStatus.lastOk).toLocaleTimeString('en-GB')}.`;
  return 'Sync is on.';
}

const todayISO = () => clampDate(localISO(new Date()), plan.start, plan.end);
const dayTitle = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/** The plan's new-word limit for today (before the start: day 1's; after the end: the last day's). */
const todaysNewLimit = () => newLimitFor(byDate.get(todayISO()));
const todaysSentLimit = () => sentLimitFor(byDate.get(todayISO()));
const todaysSayLimit = () => sayLimitFor(byDate.get(todayISO()));

const statsFor = (iso) =>
  iso === todayISO()
    ? queueStats(state, deck, todaysNewLimit(), new Date(), 20, todaysSentLimit(), todaysSayLimit())
    : null;

// ---------- today ----------

function streakText(day, doneToday) {
  const real = localISO(new Date());
  if (real < plan.start || real > plan.end) return '';
  const doneMap = Object.fromEntries(plan.days.map((d) => [d.date, S.doneIds(state, d.date)]));
  const st = streaks(plan.days, doneMap, real);
  const need = Math.max(0, streakTarget(day) - doneToday);
  const hint = st.todayCounts
    ? 'today counts'
    : `${need} more task${need === 1 ? '' : 's'} to ${st.current ? 'keep it going' : 'start it'}`;
  const best = st.best > st.current ? ` (best ${st.best})` : '';
  return `Streak: ${st.current} day${st.current === 1 ? '' : 's'}${best} · ${hint}`;
}

function viewDay(iso) {
  const day = byDate.get(iso);
  if (!day) return viewDay(todayISO());
  const real = localISO(new Date());
  const done = S.doneIds(state, iso);
  const prog = dayProgress(day, done);
  const cardStats = statsFor(iso);
  const sessions = sessionsFor(day);
  const next = sessions.flatMap((x) => x.tasks).find((t) => !done.includes(t.id));
  let notice = '';
  if (real < plan.start) notice = `<p class="notice">Your plan starts on ${esc(dayTitle(plan.start))}.</p>`;
  if (real > plan.end) notice = '<p class="notice">The 182 days are over. Time for the exam.</p>';
  const streak = iso === real ? streakText(day, prog.done) : '';
  const section = (x) => {
    const minutes = x.tasks.reduce((sum, t) => sum + (t.minutes || 0), 0);
    return `<section class="session">
      <h2>${esc(x.title)}${minutes ? `<span>${minutes} min</span>` : ''}</h2>
      <ul class="rows">${x.tasks.map((t) => taskRow(iso, t, done, cardStats, next)).join('')}</ul>
    </section>`;
  };
  return `
    ${notice}
    <div class="page-head">
      <div>
        <h1>${esc(dayTitle(iso))}</h1>
        <p class="sub">Day ${dayNumber(iso, plan.start)} of ${plan.days.length} · ${esc(PHASE_NAMES[day.phase])}</p>
      </div>
      <div class="day-nav">
        ${iso > plan.start ? `<a class="icon-btn" href="#/day/${addDays(iso, -1)}" aria-label="Previous day">←</a>` : '<span class="icon-btn disabled" aria-hidden="true">←</span>'}
        ${iso < plan.end ? `<a class="icon-btn" href="#/day/${addDays(iso, 1)}" aria-label="Next day">→</a>` : '<span class="icon-btn disabled" aria-hidden="true">→</span>'}
      </div>
    </div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${prog.total}" aria-valuenow="${prog.done}" aria-label="Tasks done"><div style="width:${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%"></div></div>
    <p class="sub">${prog.done} of ${prog.total} done${streak ? ` · ${esc(streak)}` : ''}${navigator.onLine === false ? ' · Offline: everything is saved on this device' : ''}</p>
    ${sessions.map(section).join('')}`;
}

/** What to show under a task: live counts for flashcards, otherwise the task's own detail. */
function taskDetail(t, cardStats) {
  if (cardStats && t.id === 'anki-review') return `${cardStats.due} cards to review`;
  if (cardStats && t.id === 'anki-new' && !t.detail)
    return deck
      ? `${cardStats.newLeft} new words${t.title.includes('sentences') ? `, ${cardStats.sentLeft} sentences` : ''}${
          t.title.includes('to say') ? `, ${cardStats.sayLeft} to say` : ''
        } left today`
      : 'Import your word deck in Cards first';
  return t.detail || '';
}

function rowMeta(t, cardStats) {
  const { tail } = splitTitle(t.title);
  if (tail) return tail;
  const videos = t.links?.length;
  if (videos && !t.notes) return `${videos} video${videos > 1 ? 's' : ''} · needs internet`;
  if (t.players?.length) return `${t.players.length} recording${t.players.length > 1 ? 's' : ''} · needs internet`;
  if (t.notes?.length) return `English note${videos ? ` + ${videos} video${videos > 1 ? 's' : ''}` : ''}`;
  if (t.link) return 'Needs internet';
  return detailParts(taskDetail(t, cardStats)).intro;
}

/** Flashcard tasks go straight to the cards. Everything else opens its own page. */
function taskHref(iso, t) {
  if (t.id === 'anki-review' || (t.id === 'anki-new' && !t.detail)) return '#/cards/review';
  if (t.id === 'cards') return '#/cards/add/book';
  return `#/task/${iso}/${esc(t.id)}`;
}

function taskRow(iso, t, done, cardStats, next) {
  const isDone = done.includes(t.id);
  const meta = rowMeta(t, cardStats);
  const classes = ['row', isDone ? 'done' : '', next && next.id === t.id ? 'next' : ''].filter(Boolean).join(' ');
  return `
    <li class="${classes}">
      <button class="check" type="button" role="checkbox" aria-checked="${isDone}" data-task="${esc(t.id)}" data-date="${iso}" aria-label="Mark done: ${esc(t.title)}"></button>
      <a class="row-link" href="${taskHref(iso, t)}">
        <span class="row-title">${esc(splitTitle(t.title).head)}</span>
        ${meta ? `<span class="row-meta">${esc(meta)}</span>` : ''}
      </a>
      ${t.minutes ? `<span class="row-min">${t.minutes} min</span>` : ''}
    </li>`;
}

// ---------- one task ----------

const COPY_LABELS = {
  write: 'Copy correction prompt',
  speak: 'Copy examiner prompt',
  explain: 'Copy explain prompt',
};

/** The private answers for a task, closed until tapped. Shows only once they've been imported with the deck. */
function answersBlock(t) {
  const found = answersFor(deck?.answers, t.answerPages);
  if (!found.length) return '';
  const exercise = (e) => {
    const items = (e.items || []).map(([label, answer]) => `${esc(label)}. ${esc(answer)}`).join(' · ');
    const body = e.free ? 'Free answer: use Check my answers.' : items;
    return `<p><b>Ex. ${esc(e.n)}</b> ${body}${e.note ? ` <span class="sub">(${esc(e.note)})</span>` : ''}</p>`;
  };
  return `
    <details class="answers">
      <summary>Show answers</summary>
      <p class="sub">Written by Claude, not the publisher, so they can contain mistakes. If one looks wrong, use Check my answers.</p>
      ${found.map(({ page, ex }) => `<h4>p. ${page}</h4>${ex.map(exercise).join('')}`).join('')}
    </details>`;
}

const tutorLink = (section, label) =>
  `<a class="act" href="${TUTOR_URL}#${section}" target="_blank" rel="noopener">${label} ↗</a>`;

function taskActions(iso, t) {
  const actions = [];
  if (t.kind === 'explain') {
    actions.push(tutorLink('explain', 'Explain in English'));
    if (t.check) actions.push(tutorLink('mark', 'Mark my work'));
  }
  if (t.kind === 'write')
    actions.push(
      iso >= '2027-02-01' ? tutorLink('exam', 'Mark it like the exam') : tutorLink('write', 'Correct my writing'),
    );
  if (t.action) actions.push(`<a class="act" href="${esc(t.action.href)}">${esc(t.action.label)} →</a>`);
  if (t.link) actions.push(`<a class="act" href="${esc(t.link)}" target="_blank" rel="noopener">Open ↗</a>`);
  if (t.kind === 'speak') {
    actions.push(`<button class="act" type="button" data-copy="${esc(t.copy)}">${COPY_LABELS.speak}</button>`);
    actions.push(`<a class="act" href="${LINKS.claude}" target="_blank" rel="noopener">Open Claude ↗</a>`);
  }
  if (t.addWords)
    actions.push(
      S.setting(state, `wordset:${t.addWords}`, false)
        ? '<span class="sub">Added to your flashcards ✓</span>'
        : `<button class="act" type="button" data-add-words="${esc(t.addWords)}">Add ${WORD_SETS[t.addWords].words.length} flashcards</button>`,
    );
  return actions;
}

/** The older route: a ready-made prompt to paste into Claude, in case the tutor page can't be used. */
function copyPrompts(t) {
  if (t.kind !== 'explain' && t.kind !== 'write') return '';
  const check = t.check
    ? `<button class="act" type="button" data-copy="${esc(t.check)}">Check my answers</button>`
    : '';
  return `<details>
    <summary>Or copy a prompt for Claude</summary>
    <div class="acts">
      <button class="act" type="button" data-copy="${esc(t.copy)}">${COPY_LABELS[t.kind]}</button>
      ${check}
      <a class="act" href="${LINKS.claude}" target="_blank" rel="noopener">Open Claude ↗</a>
    </div>
  </details>`;
}

/** Videos for a task, each with its own tick so you can stop halfway and see where you were. */
function videoRows(iso, t, done) {
  if (!t.links?.length) return '';
  const rows = t.links.map((l, i) => {
    const id = `v:${t.id}:${i}`;
    const on = done.includes(id);
    return `<li class="row${on ? ' done' : ''}">
      <button class="check" type="button" role="checkbox" aria-checked="${on}" data-task="${esc(id)}" data-date="${iso}" data-parent="${esc(t.id)}" data-siblings="${t.links.length}" aria-label="Watched: ${esc(l.label)}"></button>
      <span class="row-title">${esc(l.label)}</span>
      <a class="act" href="${esc(l.url)}" target="_blank" rel="noopener">Watch ↗</a>
    </li>`;
  });
  return `<ul class="rows videos">${rows.join('')}</ul>`;
}

/** One task: everything needed to do it, with the focus timer at the bottom. */
function viewTask(iso, id) {
  const day = byDate.get(iso);
  const sessions = day ? sessionsFor(day) : [];
  const tasks = sessions.flatMap((x) => x.tasks);
  const t = tasks.find((x) => x.id === id);
  if (!t) return viewDay(iso);
  const session = sessions.find((x) => x.tasks.includes(t));
  const index = tasks.indexOf(t);
  const after = tasks[index + 1];
  const done = S.doneIds(state, iso);
  const mine = timer && timer.date === iso && timer.id === id;
  const full = taskMinutes(t) * 60;
  const left = mine ? timerLeft(timer) : full;
  const running = mine && !!timer.endsAt;
  const { head, tail } = splitTitle(t.title);
  const { intro, steps } = detailParts(taskDetail(t, statsFor(iso)));
  const actions = taskActions(iso, t);
  const startLabel = running
    ? 'Pause'
    : !mine || left === full || left === 0
      ? `Start · ${taskMinutes(t)} min`
      : 'Resume';
  return `
    <div class="task-top">
      <a href="#/day/${iso}">← ${iso === todayISO() ? 'Today' : esc(shortDay(iso))}</a>
      <span>${esc(session.title)} · task ${index + 1} of ${tasks.length}</span>
    </div>
    <h1>${esc(head)}</h1>
    ${tail ? `<p class="task-intro" lang="fr">${esc(tail)}</p>` : ''}
    ${intro ? `<p class="task-intro">${esc(intro)}</p>` : ''}
    ${steps.length ? `<ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${(t.notes || []).map((n) => `<p class="chapter-note"><b>Ch. ${esc(n.ch)}</b> ${esc(n.note)}</p>`).join('')}
    ${videoRows(iso, t, done)}
    ${(t.players || [])
      .map(
        (a) => `
      <p class="audio-label">${esc(a.label)}</p>
      <audio class="book-audio" controls preload="none" src="${esc(a.url)}" aria-label="${esc(a.label)}"></audio>`,
      )
      .join('')}
    ${actions.length ? `<div class="acts">${actions.join('')}</div>` : ''}
    ${copyPrompts(t)}
    ${answersBlock(t)}
    ${t.id === 'errorlog' ? todaysMistakes(iso) : ''}
    ${t.kind === 'speak' ? `<div style="margin-top:0.9rem">${recorderHtml({ date: iso, title: head.replace(/^Speak:\s*/, '') })}</div>` : ''}
    <div class="dock-space"></div>
    <section class="dock" aria-label="Focus timer">
      <div class="dock-inner">
        ${after ? `<p class="dock-next">Next: <b>${esc(splitTitle(after.title).head)}</b></p>` : ''}
        <div class="timer-row">
          <span class="clock" id="clock" role="timer">${formatClock(left)}</span>
          <button class="btn primary" type="button" id="timer-toggle" data-date="${iso}" data-id="${esc(t.id)}">${startLabel}</button>
          <button class="btn" type="button" id="timer-done" data-date="${iso}" data-id="${esc(t.id)}">${done.includes(t.id) ? 'Done ✓' : 'Done'}</button>
        </div>
      </div>
    </section>`;
}

function todaysMistakes(iso) {
  return `
    <section class="card" style="margin-top:0.9rem">
      <h2>This day's mistakes</h2>
      <p class="sub">One per line: what you wrote → correct version → rule. Read every correct version aloud 3 times. All of them are in <a href="#/mistakes">Mistakes</a>.</p>
      <textarea id="notes" data-date="${iso}" rows="5" lang="fr" placeholder="j'ai allé → je suis allé → aller takes être">${esc(S.noteText(state, iso))}</textarea>
    </section>`;
}

// ---------- focus timer ----------

function saveTimer() {
  if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  else localStorage.removeItem(TIMER_KEY);
}

async function holdScreen() {
  if (!timer?.endsAt || !S.setting(state, 'keepAwake', true) || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    wakeLock = null; // not allowed right now, for example on low battery
  }
}
function releaseScreen() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function ring() {
  navigator.vibrate?.([300, 150, 300, 150, 500]);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((at) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    });
  } catch {
    // no sound available: the vibration and the notification still fire
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && timer) {
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification("Time's up", { body: timer.title, icon: 'icon-512.png', tag: 'timer' }))
      .catch(() => {});
  }
}

function stopTicking() {
  clearInterval(timerTick);
  timerTick = null;
}

/** Keep the clock and the strip at the top up to date. */
function paintTimer() {
  const pill = document.getElementById('timer-pill');
  const left = timerLeft(timer);
  const taskHash = timer ? `#/task/${timer.date}/${timer.id}` : '';
  const onPage = timer && location.hash === taskHash;
  const clock = document.getElementById('clock');
  if (clock && onPage) clock.textContent = formatClock(left);
  if (pill) {
    pill.hidden = !timer?.endsAt || onPage;
    if (timer?.endsAt) {
      pill.href = taskHash;
      pill.innerHTML = `<span>${esc(splitTitle(timer.title).head)}</span><b>${formatClock(left)}</b>`;
    }
  }
  if (timer?.endsAt && left <= 0) {
    ring();
    timer = { ...timer, endsAt: null, left: 0 };
    saveTimer();
    stopTicking();
    releaseScreen();
    if (onPage && !isEditing()) rerender();
    else paintTimer();
  }
}

function startTicking() {
  stopTicking();
  timerTick = setInterval(paintTimer, 1000);
  paintTimer();
}

function toggleTimer(date, id) {
  const t = sessionsFor(byDate.get(date))
    .flatMap((x) => x.tasks)
    .find((x) => x.id === id);
  if (!t) return;
  const mine = timer && timer.date === date && timer.id === id;
  if (mine && timer.endsAt) {
    timer = { ...timer, endsAt: null, left: timerLeft(timer) };
    stopTicking();
    releaseScreen();
    reminders.clearTimer().catch(() => {});
  } else {
    const left = mine && timer.left > 0 ? timer.left : taskMinutes(t) * 60;
    const endsAt = Date.now() + left * 1000;
    timer = { date, id, title: t.title, endsAt };
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
    holdScreen();
    startTicking();
    // If the phone goes to sleep, the server sends the alert instead.
    if (reminders.isOn())
      reminders.setTimer({ at: endsAt, title: t.title, url: `./#/task/${date}/${id}` }).catch(() => {});
  }
  saveTimer();
  rerender();
}

function finishTask(date, id) {
  S.setDone(state, date, id, true);
  if (timer && timer.date === date && timer.id === id) {
    timer = null;
    saveTimer();
    stopTicking();
    releaseScreen();
    reminders.clearTimer().catch(() => {});
  }
  save();
  location.hash = `#/day/${date}`;
}

// ---------- plan ----------

function viewPlan() {
  const doneMap = Object.fromEntries(plan.days.map((d) => [d.date, S.doneIds(state, d.date)]));
  const overall = overallProgress(plan.days, doneMap);
  const real = localISO(new Date());
  const st = streaks(plan.days, doneMap, real);
  const weeks = groupByWeek(plan.days)
    .map(({ week, days }) => {
      const rows = days
        .map((d) => {
          const p = dayProgress(d, doneMap[d.date]);
          const status = p.complete
            ? '<span class="pd-status complete" role="img" aria-label="Complete">✓</span>'
            : `<span class="pd-status">${p.done ? `${p.done}/${p.total}` : ''}</span>`;
          return `<li><a class="plan-day${d.date === real ? ' is-today' : ''}" href="#/day/${d.date}">
            <span class="pd-date">${esc(shortDay(d.date))}</span><span class="pd-what">${esc(d.sunday ? 'Review day' : d.book)}</span>${status}</a></li>`;
        })
        .join('');
      return `<section class="week" id="w${week}"><h2>Week ${week}</h2><ul class="plan-days">${rows}</ul></section>`;
    })
    .join('');
  const phaseNow = (byDate.get(todayISO()) || {}).phase;
  const stage = (ph, name, when) =>
    `<div class="stage${phaseNow === ph ? ' now' : ''}"><span>${name}</span><span>${when}</span></div>`;
  return `
    <h1>Plan</h1>
    <p class="sub">6 Nov → 6 May · ${overall.complete} of ${overall.total} days complete · streak ${st.current}${st.best > st.current ? ` (best ${st.best})` : ''}</p>
    <section class="card stages">
      ${stage(1, 'Débutant (A1)', '6 Nov – 5 Dec')}
      ${stage(2, 'Intermédiaire (A2–B1)', '7 Dec – 4 Feb')}
      ${stage(3, 'Avancé (B1–B2)', '5 Feb – 3 Apr')}
      ${stage(4, 'TCF preparation', '5 Apr – 6 May')}
    </section>
    ${weeks}`;
}

// ---------- mistakes ----------

function viewMistakes() {
  const lines = mistakeLines(state.notes);
  const repeats = repeatedMistakes(lines);
  const repeatRows = repeats
    .map(
      (r) => `<div class="repeat">
        <span><b>${r.count} times:</b> ${esc(r.label)}</span>
        <a class="act danger" href="#/task/${r.firstDate}/book">Redo chapter</a>
      </div>`,
    )
    .join('');
  const item = (m) => {
    const del = `<button class="act danger" type="button" data-note-del="${m.date}" data-note-line="${m.index}">Delete</button>`;
    if (m.plain !== undefined)
      return `<article class="mistake">
        <span class="m-date">${esc(shortDay(m.date))}</span>
        <p class="m-plain">${esc(m.plain)}</p>
        <div class="m-acts">${del}</div>
      </article>`;
    return `<article class="mistake">
      <span class="m-date">${esc(shortDay(m.date))}</span>
      <span class="m-wrong" lang="fr">${esc(m.wrong)}</span>
      <span class="m-right" lang="fr">${esc(m.right)}</span>
      ${m.rule ? `<span class="m-rule">${esc(m.rule)}</span>` : ''}
      <div class="m-acts">
        <button class="act" type="button" data-card-front="${esc(m.right)}" data-card-back="${esc(m.rule || m.wrong)}">Make a card</button>
        ${del}
      </div>
    </article>`;
  };
  return `
    <h1>Mistakes</h1>
    <p class="sub">Review them on Sunday. Three times means redo the chapter.</p>
    ${repeatRows}
    <section class="card">
      <form id="mistake-form" autocomplete="off">
        <label for="new-mistake"><b>New mistake</b></label>
        <textarea id="new-mistake" name="line" rows="2" lang="fr" required placeholder="what you wrote → correct version → rule"></textarea>
        <div class="acts"><button class="btn primary" type="submit">Add</button></div>
      </form>
    </section>
    ${
      lines.length
        ? `<section class="card">${lines.map(item).join('')}</section>`
        : '<p class="sub">Nothing yet. Every mistake you log turns into something you can review and make a card from.</p>'
    }`;
}

// ---------- more ----------

function remindersSection() {
  const support = reminders.support();
  if (!reminders.isOn()) {
    return `<section class="card">
      <h2>Reminders</h2>
      <p class="sub">${esc(support.ok ? 'A notification at the start of each session, one in the evening if your streak is at risk, and one when a focus timer ends. Your phone needs internet to receive them.' : support.why)}</p>
      ${support.ok ? '<div class="acts"><button class="btn primary" type="button" id="rem-on">Turn on reminders</button></div>' : ''}
      <p class="sub" id="rem-msg" role="status"></p>
    </section>`;
  }
  const rows = reminders
    .slots()
    .map(
      (r) => `<div class="slot">
        <input type="checkbox" id="slot-${esc(r.id)}" data-slot-on="${esc(r.id)}"${r.on ? ' checked' : ''} />
        <label for="slot-${esc(r.id)}">${esc(r.label)}</label>
        <input type="time" data-slot-time="${esc(r.id)}" value="${esc(r.time)}" aria-label="${esc(r.label)}, time" />
      </div>`,
    )
    .join('');
  return `<section class="card">
    <h2>Reminders</h2>
    ${rows}
    <div class="acts">
      <button class="act" type="button" id="rem-test">Send a test</button>
      <button class="act danger" type="button" id="rem-off">Turn off</button>
    </div>
    <p class="sub" id="rem-msg" role="status"></p>
  </section>`;
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

function viewMore() {
  const standalone = matchMedia('(display-mode: standalone)').matches;
  return `
    <h1>More</h1>
    ${
      standalone
        ? ''
        : `<section class="card">
      <h2>Install the app</h2>
      <p class="sub">Puts it on your home screen, opens without browser bars, works offline, and lets you share text into it from other apps.</p>
      ${
        installPrompt
          ? '<div class="acts"><button class="btn primary" type="button" id="install-app">Install</button></div>'
          : '<p class="sub">In Chrome on Android: open the menu (⋮), then <b>Add to Home screen</b> or <b>Install app</b>.</p>'
      }
    </section>`
    }
    ${remindersSection()}
    ${syncSection()}
    <section class="card">
      <h2>Study</h2>
      <ul class="links-list">
        <li><a href="${TUTOR_URL}" target="_blank" rel="noopener">AI tutor ↗ <span>Explains, marks and quizzes, on claude.ai</span></a></li>
        <li><a href="#/recordings">My recordings <span>Your voice, by date</span></a></li>
        <li><a href="#/audio">Book audio <span>28 dialogues, 10 songs</span></a></li>
        <li><a href="#/book-words">French words in the book <span>The ones it uses constantly</span></a></li>
      </ul>
    </section>
    <section class="card">
      <h2>Settings</h2>
      <label class="toggle"><input type="checkbox" id="keep-awake"${S.setting(state, 'keepAwake', true) ? ' checked' : ''} /> Keep the screen on while a timer runs</label>
    </section>
    <section class="card">
      <h2>Backup</h2>
      <p class="sub">A file copy of your ticks, notes and flashcards (not the word deck or recordings). Restoring merges with what's here.</p>
      <div class="acts">
        <button class="act" type="button" id="export">Download backup</button>
        <label class="act file">Restore from backup<input type="file" id="import" accept="application/json" /></label>
      </div>
      <p class="sub" id="backup-msg" role="status"></p>
    </section>`;
}

function viewRecordings() {
  return `
    <p class="crumb"><a href="#/more">← More</a></p>
    <h1>My recordings</h1>
    <p class="sub">Your voice over time. They stay on this device: not uploaded, not synced, not in backups.</p>
    ${recorderHtml({ date: localISO(new Date()), title: 'Free practice' })}`;
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
    history.replaceState(null, '', '#/more');
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
    tab = 'today';
  } else if (name === 'plan') html = viewPlan();
  else if (name === 'task' && arg && arg2) {
    html = viewTask(clampDate(arg, plan.start, plan.end), arg2);
    tab = 'today';
  } else if (name === 'cards' && arg === 'photo') html = photoHtml();
  else if (name === 'cards') html = renderCards(cardsCtx(), arg2, arg);
  else if (name === 'mistakes') html = viewMistakes();
  else if (name === 'more') html = viewMore();
  else if (name === 'recordings') {
    html = viewRecordings();
    tab = 'more';
  } else if (name === 'materials') html = viewMaterials();
  else if (name === 'method') html = viewMethod(state);
  else if (name === 'audio') {
    html = viewAudio(plan);
    tab = 'materials';
  } else if (name === 'book-words') {
    html = viewBookWords();
    tab = 'today';
  } else {
    html = viewDay(todayISO());
    tab = 'today';
  }
  app.innerHTML = html;
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) {
      a.setAttribute('aria-current', 'page');
      // On a narrow screen the tab row scrolls sideways: keep the current one visible.
      a.parentElement.scrollLeft = a.offsetLeft - a.parentElement.offsetLeft - 16;
    } else a.removeAttribute('aria-current');
  });
  if (name === 'plan') {
    const cur = document.querySelector('.plan-day.is-today');
    if (cur) cur.closest('.week').scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  } else if (name === 'cards' && arg === 'add') {
    window.scrollTo(0, 0);
    document.querySelector('#add-card [name=front]')?.focus({ preventScroll: true });
  } else window.scrollTo(0, 0);
  mountRecorder();
  paintTimer();
}

function flash(sel, text) {
  const el = document.querySelector(sel);
  if (el) el.textContent = text;
}

/** Re-render the current view, optionally keeping the scroll position, focusing a field, or showing a message. */
function rerender({ keepScroll = true, focus, msg } = {}) {
  // Never cut off a recording being played, or a recording or speech check in progress.
  if (isBusy() || [...document.querySelectorAll('audio')].some((a) => !a.paused)) return;
  const y = window.scrollY;
  route();
  if (keepScroll) window.scrollTo(0, y);
  if (focus) document.querySelector(focus)?.focus({ preventScroll: true });
  if (msg) flash(msg[0], msg[1]);
}

/** Tell the server not to send the streak reminder once today already counts. */
function updateQuiet() {
  if (!plan || !reminders.isOn()) return;
  const real = localISO(new Date());
  const day = byDate.get(real);
  if (!day) return;
  const st = streaks([day], { [real]: S.doneIds(state, real) }, real);
  if (st.todayCounts) reminders.setQuiet(real).catch(() => {});
}

// ---------- events ----------

async function remindersClick(id) {
  const msg = (text) => flash('#rem-msg', text);
  try {
    if (id === 'rem-on') {
      await reminders.enable();
      updateQuiet();
      rerender({ msg: ['#rem-msg', 'Reminders are on.'] });
    } else if (id === 'rem-off') {
      await reminders.disable();
      rerender();
    } else if (id === 'rem-test') {
      await reminders.test();
      msg('Sent. It should arrive in a few seconds.');
    }
  } catch (err) {
    msg(err?.message || "Couldn't reach the reminder server. Try again when you're online.");
  }
}

app.addEventListener('click', async (e) => {
  if (await speakClick(e)) return;
  if (location.hash.startsWith('#/cards/photo') && photoClick(e, cardsCtx())) return;
  if (location.hash.startsWith('#/cards') && (await cardsClick(e, cardsCtx()))) return;
  const check = e.target.closest('.check');
  if (check && check.dataset.task) {
    const { date, task, parent, siblings } = check.dataset;
    const on = !S.doneIds(state, date).includes(task);
    S.setDone(state, date, task, on);
    if (on && parent) {
      const done = S.doneIds(state, date);
      const ids = Array.from({ length: Number(siblings) }, (_, i) => `v:${parent}:${i}`);
      if (ids.every((id) => done.includes(id))) S.setDone(state, date, parent, true);
    }
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
  const addWords = e.target.closest('[data-add-words]');
  if (addWords) {
    const name = addWords.dataset.addWords;
    if (!S.setting(state, `wordset:${name}`, false)) {
      for (const [front, back] of WORD_SETS[name].words) S.putCard(state, newOwnCard({ front, back, src: 'vocab' }));
      S.setSetting(state, `wordset:${name}`, true);
      save();
    }
    rerender();
    return;
  }
  const toggle = e.target.closest('#timer-toggle');
  if (toggle) {
    toggleTimer(toggle.dataset.date, toggle.dataset.id);
    return;
  }
  const finish = e.target.closest('#timer-done');
  if (finish) {
    finishTask(finish.dataset.date, finish.dataset.id);
    return;
  }
  const makeCard = e.target.closest('[data-card-front]');
  if (makeCard) {
    prefillCard({ front: makeCard.dataset.cardFront, back: makeCard.dataset.cardBack });
    location.hash = '#/cards/add/mistake';
    return;
  }
  const delLine = e.target.closest('[data-note-del]');
  if (delLine) {
    const date = delLine.dataset.noteDel;
    S.setNote(state, date, removeNoteLine(S.noteText(state, date), Number(delLine.dataset.noteLine)));
    save();
    rerender();
    return;
  }
  if (e.target.closest('#install-app') && installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
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
  } else if (id?.startsWith('rem-')) {
    await remindersClick(id);
  }
});

app.addEventListener('submit', async (e) => {
  if (cardsSubmit(e, cardsCtx())) return;
  if (e.target.id === 'mistake-form') {
    e.preventDefault();
    const line = String(new FormData(e.target).get('line') || '').trim();
    if (!line) return;
    const date = todayISO();
    S.setNote(state, date, addNoteLine(S.noteText(state, date), line));
    save();
    document.activeElement?.blur?.();
    rerender();
    return;
  }
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
  if (location.hash.startsWith('#/cards/photo') && (await photoChange(e, cardsCtx()))) return;
  if (await cardsChange(e, cardsCtx())) return;
  if (e.target.id === 'keep-awake') {
    S.setSetting(state, 'keepAwake', e.target.checked);
    save();
    if (e.target.checked) holdScreen();
    else releaseScreen();
    return;
  }
  const slotOn = e.target.dataset?.slotOn;
  const slotTime = e.target.dataset?.slotTime;
  if (slotOn || slotTime) {
    const change = slotOn ? { on: e.target.checked } : { time: e.target.value };
    try {
      await reminders.setSlot(slotOn || slotTime, change);
      flash('#rem-msg', 'Saved.');
    } catch {
      flash('#rem-msg', "Couldn't save that: you may be offline. Try again when you're online.");
    }
    return;
  }
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

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (location.hash === '#/more') rerender();
});
window.addEventListener('online', () => {
  if (plan && !isEditing()) rerender();
  reminders.refresh().catch(() => {});
});
window.addEventListener('offline', () => plan && !isEditing() && rerender());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  // The screen lock is released whenever the page is hidden, so take it again on return.
  if (document.visibilityState === 'visible') {
    paintTimer();
    holdScreen();
  }
  if (!sync.enabled) return;
  if (document.visibilityState === 'hidden') sync.flush();
  else sync.syncNow();
});

window.addEventListener('hashchange', route);

Promise.all([
  fetch('data/schedule.json', { cache: 'no-cache' }).then((r) => r.json()),
  idbGet('deck').catch(() => null),
])
  .then(async ([data, savedDeck]) => {
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
    // Text shared from another app arrives as ?text=… (see share_target in the manifest).
    const shared = new URLSearchParams(location.search);
    const text = (shared.get('text') || shared.get('title') || '').trim();
    if (text) {
      const front = text.slice(0, 300);
      const { lookupPhrase } = await import('./ocr-words.js');
      prefillCard({ front, back: lookupPhrase(front, deck) });
      history.replaceState(null, '', `${location.pathname}#/cards/add/other`);
    }
    route();
    if (timer?.endsAt) {
      holdScreen();
      startTicking();
    }
    if (sync.enabled) sync.syncNow({ full: !deck });
    reminders.refresh().catch(() => {});
    updateQuiet();
  })
  .catch(() => {
    app.innerHTML = '<p class="loading">Could not open the plan. Check your connection and reload.</p>';
  });
