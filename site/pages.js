// The longer reference pages: materials, method, book audio, and the French words the book uses.
import { LINKS, BOOK_AUDIO, BOOK_WORDS, WRITING_PROMPT, SPEAKING_PROMPT, EXPLAIN_PROMPT, esc } from './logic.js';
import * as S from './store.js';

export function viewBookWords() {
  return `
    <p class="crumb"><a href="#/today">← Today</a></p>
    <h1>French words in the book</h1>
    <p class="sub">The book uses these constantly. Learn them in your first week and the left pages get much easier. For any other word, look up just that word, not the whole page.</p>
    ${BOOK_WORDS.map(
      ([title, words]) => `
      <section class="card">
        <h2>${esc(title)}</h2>
        <table class="tbl"><tbody>
          ${words.map(([fr, en]) => `<tr><td lang="fr"><b>${esc(fr)}</b></td><td>${esc(en)}</td></tr>`).join('')}
        </tbody></table>
      </section>`,
    ).join('')}`;
}

export function viewAudio(plan) {
  const planned = {};
  for (const d of plan.days) for (const n of d.book_audio?.items || []) planned[n] = d;
  const rows = (kind) =>
    BOOK_AUDIO.filter((a) => a.kind === kind)
      .map(
        (a) => `
        <li>
          <p class="task-title">${esc(a.title)} <span class="sub">p. ${a.page} · in your plan on <a href="#/day/${planned[a.n].date}">${esc(planned[a.n].day)}</a></span></p>
          <audio class="book-audio" controls preload="none" src="${esc(a.url)}" aria-label="${esc(a.title)}, page ${a.page}"></audio>
        </li>`,
      )
      .join('');
  return `
    <p class="crumb"><a href="#/materials">← Materials</a></p>
    <h1>Book audio</h1>
    <p class="sub">The Débutant book's recordings. Each one is in your plan once you've done the grammar it uses, going by the book's own labels. Open the page, listen once with the text covered, once following it, then repeat aloud. They play from CLE International's site, so they need internet.</p>
    <section class="card">
      <h2>Dialogues</h2>
      <ul class="plain">${rows('dialogue')}</ul>
    </section>
    <section class="card">
      <h2>Songs: La grammaire en chantant</h2>
      <ul class="plain">${rows('song')}</ul>
    </section>`;
}

export function viewMaterials() {
  const isbn = (n) =>
    `<a href="https://www.amazon.fr/s?k=${n}" target="_blank" rel="noopener">Amazon.fr</a> · <a href="https://www.fnac.com/SearchResult/ResultList.aspx?Search=${n}" target="_blank" rel="noopener">Fnac</a>`;
  return `
    <h1>Materials</h1>
    <p class="sub">Everything the plan uses, and nothing else.</p>

    <section class="card">
      <h2>The book: Grammaire progressive du français (CLE International)</h2>
      <p>The grammar workbook FLE teachers recommend most for self-study: the rule on the left page, exercises on the right. Three volumes take you from A1 to B2. <b>Always buy the matching Corrigés (answer key)</b>, or you can't check your own work.</p>
      <ul class="plain volumes">
        <li><p class="vol-when">Buy now · used 9 Nov – 9 Dec · A1</p><p class="task-title">Niveau débutant, 3e éd. (2025 "+ appli" printing), 60 chapters + Corrigés</p><p class="sub">ISBN 9782090398502 · ${isbn('9782090398502')} · Corrigés 9782090381023</p></li>
        <li><p class="vol-when">Buy late Nov · used 10 Dec – 8 Feb · A2–B1</p><p class="task-title">Niveau intermédiaire, 4e éd. + Corrigés</p><p class="sub">ISBN 9782090381030 · ${isbn('9782090381030')} · Corrigés 9782090381047</p></li>
        <li><p class="vol-when">Buy late Jan · used 9 Feb – 7 Apr · B1–B2</p><p class="task-title">Niveau avancé, 3e éd., 72 chapters + Corrigés</p><p class="sub">ISBN 9782090381979 · ${isbn('9782090381979')} · Corrigés 9782090381986</p></li>
      </ul>
      <div class="acts"><a class="act" href="#/audio">Débutant audio: 28 dialogues + 10 songs →</a></div>
      <p class="sub">Also at Gibert Joseph, Decitre and Cultura, or borrow them free from your médiathèque. The plan assumes 52 chapters in Intermédiaire; if your copy has a different number, keep about one a day and let the dates slide.</p>
    </section>

    <section class="card">
      <h2>The vocabulary book: Vocabulaire progressif du français (CLE International)</h2>
      <p>Same publisher and layout as the grammar books: a themed lesson on the left page, exercises on the right. It teaches words <b>by topic</b> (housing, work, health, travel…), which is what the TCF writing and speaking tasks are about. A frequency deck alone teaches words one at a time.</p>
      <ul class="plain volumes">
        <li><p class="vol-when">Buy late Nov · used 10 Dec – 3 Apr · A2–B1</p><p class="task-title">Niveau intermédiaire + appli, 3e éd. (2025 printing), 25 chapters + Corrigés</p><p class="sub">ISBN 9782090398571 · ${isbn('9782090398571')} · Corrigés 9782090380163</p></li>
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
        <li><p class="vol-when">Vocabulary answer key · €13.50 · 32 pages</p><p class="task-title">Corrigés vocabulaire progressif, niveau intermédiaire, 3e éd.</p><p class="sub"><b>Only at Forum des Halles</b>, limited, so buy or reserve it early even though you only need the book from 10 Dec. <a href="https://www.fnac.com/a11187087/Claire-Miquel-Corriges-vocabulaire-progressif-niveau-intermediaire-3e-edition" target="_blank" rel="noopener">Fnac page ↗</a></p></li>
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
        <li><b>9 Nov – 9 Dec · Vincent, "Learn French in 5 Days" (Legacy Version)</b>, matched to the book: Vincent's original course, explained in English, with slow pronunciation drills. That makes it the English companion to the French-only Débutant book, so each afternoon you watch his lessons on that morning's chapters, in the book's order, and Super Easy French fills the rest of the hour. Each link starts on the lesson and tells you where to stop. His advanced lessons (conditional, subjunctive, passive and more) then carry on through December to April, so you watch the whole series. Skip the paid french4me site advertised in the description; you don't need it. <a href="${LINKS.vincent}" target="_blank" rel="noopener">Playlist ↗</a></li>
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
        <li>Tap Listen to hear the word in your device's French voice.</li>
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

export function viewMethod(state) {
  return `
    <h1>The method</h1>
    <p class="sub">Why the day is built the way it is.</p>

    <section class="card">
      <h2>Your 4 hours, timed for memory</h2>
      <p>4 hours is the minimum, not the limit. The goal is B2 by May, so if the book or your flashcard reviews need longer, give them longer. Never rush or skip them to fit the clock.</p>
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
          <tr><td>9 Dec</td><td>Débutant finished · ~700 words · 2-min self-intro, no notes</td></tr>
          <tr><td>9 Jan</td><td>Half of Intermédiaire · ~1,400 words · 10-min conversation</td></tr>
          <tr><td>8 Feb</td><td>Intermédiaire finished · ~2,100 words · first listening/reading mock (250–330 is normal)</td></tr>
          <tr><td>9 Mar</td><td>Half of Avancé · subjonctif, conditionnel, relatives · mocks ≥ 400</td></tr>
          <tr><td>7 Apr</td><td>Avancé finished · ~3,300 words · mocks ≥ 440 · writing/speaking ~10/20</td></tr>
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
