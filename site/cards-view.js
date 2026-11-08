// The Cards screens: home, review (FSRS), add a card, and importing the word deck.
import { esc } from './logic.js';
import { putCard, deleteCard, liveCards, setting, setSetting } from './store.js';
import {
  RATINGS,
  newDeckCard,
  newSentenceCard,
  newSpeakCard,
  newOwnCard,
  review,
  preview,
  nextCard,
  queueStats,
  reviewedToday,
  deckNewToday,
  sentNewToday,
  sayNewToday,
  deckWord,
  sentence,
  validDeck,
} from './cards.js';

const SOURCES = { book: 'Grammar book', vocab: 'Vocabulary book', mistake: 'Mistake', other: 'Other' };
let current = null; // { id, revealed }
let lastSrc = 'book';
let prefill = null; // a shared or corrected phrase waiting in the add-card form

/** Open the add-card form with these fields already filled in. */
export function prefillCard(fields) {
  prefill = fields;
}

/** Text to speak for a card: the French side without "(f)/(m)" markers. */
function frenchOf(card, deck) {
  if (card.kind === 'deck') {
    const w = deckWord(deck, card.rank);
    return w ? w.a.replace(/\s*\((m|f|mf|m\/f)\)\s*/g, ' ').trim() : '';
  }
  if (card.kind === 'sent' || card.kind === 'say') return sentence(deck, card.idx)?.fr || '';
  return card.front;
}

export function speak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  const voice =
    speechSynthesis.getVoices().find((v) => /^fr(-|_)FR/i.test(v.lang)) ||
    speechSynthesis.getVoices().find((v) => /^fr/i.test(v.lang));
  if (voice) u.voice = voice;
  u.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function frontHtml(card, deck) {
  if (card.kind === 'deck') {
    const w = deckWord(deck, card.rank);
    if (!w) return '<p class="flash-word">(word missing from deck)</p>';
    return `<p class="flash-meta">#${w.r + 1} · ${esc(w.pos || '')}</p>
      <p class="flash-word g-${esc(w.g || 'x')}" lang="fr">${esc(w.a)}</p>`;
  }
  if (card.kind === 'sent') {
    const t = sentence(deck, card.idx);
    if (!t) return '<p class="flash-word">(sentence missing from deck)</p>';
    return `<p class="flash-meta">Sentence ${t.i + 1} · ${t.level === 'i' ? 'intermediate' : 'basic'} · read it aloud, then translate</p>
      <p class="flash-word flash-sentence" lang="fr">${esc(t.fr)}</p>`;
  }
  if (card.kind === 'say') {
    const t = sentence(deck, card.idx);
    if (!t) return '<p class="flash-word">(sentence missing from deck)</p>';
    return `<p class="flash-meta">Say it in French · out loud, then check</p>
      <p class="flash-word flash-sentence">${esc(t.en)}</p>`;
  }
  return `<p class="flash-meta">${esc(SOURCES[card.src] || 'My card')}</p><p class="flash-word" lang="fr">${esc(card.front)}</p>`;
}

function backHtml(card, deck) {
  if (card.kind === 'deck') {
    const w = deckWord(deck, card.rank);
    if (!w) return '';
    const ex = (w.ex || [])
      .map(
        ([fr, en]) => `<li><span class="ex-fr" lang="fr">${esc(fr)}</span><span class="ex-en">${esc(en)}</span></li>`,
      )
      .join('');
    return `<p class="flash-answer">${esc(w.m)}</p>
      <p class="sub">${esc(w.ipa || '')}${w.d ? ` · ${esc(w.d)}` : ''}</p>
      ${ex ? `<ul class="examples">${ex}</ul>` : ''}`;
  }
  if (card.kind === 'sent') return `<p class="flash-answer">${esc(sentence(deck, card.idx)?.en || '')}</p>`;
  if (card.kind === 'say') return `<p class="flash-answer" lang="fr">${esc(sentence(deck, card.idx)?.fr || '')}</p>`;
  return `<p class="flash-answer">${esc(card.back)}</p>`;
}

function reviewHtml(ctx) {
  const { state, deck, newLimit, sentLimit = 0, sayLimit = 0 } = ctx;
  const now = new Date();
  if (!current || !state.cards[current.id] || state.cards[current.id].del) {
    const next = nextCard(state, deck, newLimit, now, sentLimit, sayLimit);
    if (!next) {
      current = null;
      const st = queueStats(state, deck, newLimit, now);
      const soon = st.nextSoon ? Math.max(1, Math.round((st.nextSoon - now) / 60000)) : null;
      const empty = !deck && !liveCards(state).length;
      return `<section class="card flash flash-done">
        <h2>${empty ? 'No cards yet' : 'All done for now'}</h2>
        <p class="sub">${
          empty
            ? 'Import your word deck in Cards, or add your own cards.'
            : soon
              ? `A card you're still learning comes back in ${soon} min.`
              : 'Come back tomorrow: the next cards are scheduled for later.'
        }</p>
        <div class="acts" style="justify-content:center"><a class="act" href="#/today">Back to today</a></div>
      </section>`;
    }
    let card = next.card;
    if (!card) {
      card =
        next.say !== undefined
          ? newSpeakCard(next.say, now)
          : next.sentence !== undefined
            ? newSentenceCard(next.sentence, now)
            : newDeckCard(next.rank, now);
      putCard(state, card);
      ctx.save();
    }
    current = { id: card.id, revealed: false };
  }
  const card = state.cards[current.id];
  const isNew = card.s.state === 0;
  const labels = current.revealed ? preview(card, now) : null;
  return `<section class="card flash" aria-live="polite">
      ${isNew ? '<p class="flash-badge">New</p>' : ''}
      <div class="flash-front">${frontHtml(card, deck)}
        ${
          card.kind === 'say' && !current.revealed
            ? '' // the audio would give away the answer on a speaking card
            : '<button class="act" type="button" data-speak>Listen</button>'
        }
      </div>
      ${current.revealed ? `<div class="flash-back">${backHtml(card, deck)}</div>` : ''}
    </section>
    <div class="dock-space"></div>
    <section class="dock" aria-label="${current.revealed ? 'How well did you know it?' : 'Show the answer'}">
      <div class="dock-inner">
        ${
          current.revealed
            ? `<div class="rate">${RATINGS.map(
                (r) =>
                  `<button type="button" class="rate-btn r${r.value}" data-rate="${r.value}"><b>${esc(r.label)}</b><span>${labels[r.value]}</span></button>`,
              ).join('')}</div>
              <p class="sub kbd">Keys: 1 Again · 2 Hard · 3 Good · 4 Easy</p>`
            : `<button type="button" class="btn primary big" id="reveal">Show answer</button>
              <p class="sub kbd">Key: Space</p>`
        }
      </div>
    </section>`;
}

function reviewPage(ctx) {
  const { state, deck, newLimit, sentLimit = 0, sayLimit = 0 } = ctx;
  const now = new Date();
  const block = reviewHtml(ctx); // may start a new deck word, so count after it
  const st = queueStats(state, deck, newLimit, now, 20, sentLimit, sayLimit);
  return `
    <div class="task-top">
      <a href="#/cards">← Cards</a>
      <span>${st.due} to review · ${reviewedToday(state, now)} done today</span>
    </div>
    ${block}`;
}

function addPage(sub) {
  if (sub && SOURCES[sub]) lastSrc = sub;
  const fill = prefill || {};
  return `
    <p class="crumb"><a href="#/cards">← Cards</a></p>
    <h1>Add a card</h1>
    <p class="sub">French on the front, the meaning on the back. Whole phrases work better than single words. From any app, you can also select text, tap Share and choose this app.</p>
    <section class="card">
      <form id="add-card" class="form" autocomplete="off">
        <label>French<input name="front" required maxlength="300" lang="fr" placeholder="payer le loyer" value="${esc(fill.front || '')}" /></label>
        <label>Meaning<input name="back" required maxlength="300" placeholder="to pay the rent" value="${esc(fill.back || '')}" /></label>
        <label>From<select name="src">${Object.entries(SOURCES)
          .map(([k, v]) => `<option value="${k}"${k === lastSrc ? ' selected' : ''}>${v}</option>`)
          .join('')}</select></label>
        <button class="btn primary big" type="submit">Add card</button>
        <div class="acts"><button class="act" type="button" id="look-up">Look up the meaning ↗</button></div>
        <p class="sub" id="add-msg" role="status"></p>
      </form>
    </section>`;
}

function homePage(ctx) {
  const { state, deck, newLimit, sentLimit = 0, sayLimit = 0 } = ctx;
  const now = new Date();
  prefill = null;
  const st = queueStats(state, deck, newLimit, now, 20, sentLimit, sayLimit);
  const all = liveCards(state);
  const count = (kind) => all.filter((c) => c.kind === kind).length;
  const mine = all.filter((c) => c.kind === 'mine').sort((a, b) => (a.created < b.created ? 1 : -1));
  const autoplay = setting(state, 'autoplay', true);
  const fresh = st.newLeft + (st.sentLeft || 0) + (st.sayLeft || 0);
  const canStart = st.due > 0 || (deck && fresh > 0) || (st.nextSoon && st.nextSoon - now < 30 * 60000);
  return `
    <h1>Cards</h1>
    <p class="sub">${reviewedToday(state, now)} done today · ${deckNewToday(state, now)} of ${newLimit} new words${
      sentLimit ? ` · ${sentNewToday(state, now)} of ${sentLimit} sentences` : ''
    }${sayLimit ? ` · ${sayNewToday(state, now)} of ${sayLimit} to say` : ''}</p>

    <section class="card">
      <div class="cards-nums">
        <div><b>${st.due}</b><span>to review</span></div>
        <div><b>${deck ? fresh : 0}</b><span>new today</span></div>
      </div>
      ${
        canStart
          ? '<a class="btn primary big" href="#/cards/review">Start</a>'
          : `<p class="sub">${deck ? 'All done. Nothing else is due today.' : 'Import your word deck below to begin.'}</p>`
      }
    </section>

    <div class="btn-pair">
      <a class="btn" href="#/cards/add/other">Add a card</a>
      <a class="btn" href="#/cards/photo">Photo of a page</a>
    </div>

    <section class="card">
      <h2>My decks</h2>
      <ul class="plain packets">
        <li><div><p class="task-title">Words</p><p class="sub">${deck ? `${deck.words.length.toLocaleString('en')} most frequent words, in order` : 'Import the deck below'}</p></div><b class="count">${count('deck')}</b></li>
        <li><div><p class="task-title">Sentences to read</p><p class="sub">${deck?.sentences ? `${deck.sentences.length.toLocaleString('en')} sentences. Starts 7 Jan, 8 a day` : 'Not in this deck'}</p></div><b class="count">${count('sent')}</b></li>
        <li><div><p class="task-title">Sentences to say</p><p class="sub">See the English, say the French. Starts 14 Jan, 6 a day</p></div><b class="count">${count('say')}</b></li>
        <li><div><p class="task-title">My cards</p><p class="sub">From the books and your mistakes</p></div><b class="count">${mine.length}</b></li>
      </ul>
    </section>

    <section class="card">
      <h2>My cards</h2>
      ${
        mine.length
          ? `<ul class="plain mycards">${mine
              .slice(0, 100)
              .map(
                (c) =>
                  `<li><div><p class="task-title" lang="fr">${esc(c.front)}</p><p class="sub">${esc(c.back)} · ${esc(SOURCES[c.src] || '')}</p></div><button class="act danger" type="button" data-del="${esc(c.id)}">Delete</button></li>`,
              )
              .join('')}</ul>${mine.length > 100 ? `<p class="sub">Showing the newest 100.</p>` : ''}`
          : '<p class="sub">None yet. Add one above, or from a book task.</p>'
      }
    </section>

    <section class="card">
      <h2>Word deck</h2>
      ${
        deck
          ? `<p>${esc(deck.name || 'Word deck')}: <b>${deck.words.length.toLocaleString('en')}</b> words.${deck.answers ? ' Book answers included.' : ''}</p>
             <p class="sub">New words come in frequency order, 25 → 15 a day on plan days (none on Sundays and vocabulary-book evenings).</p>`
          : `<p class="sub">Import <code>french-deck-with-answers.json</code> from <code>~/projects/french-private/</code>. It stays on your device and in your encrypted sync, never on the website.</p>`
      }
      <div class="acts"><label class="act file">${deck ? 'Replace deck' : 'Import word deck'}<input type="file" id="deck-file" accept="application/json,.json" /></label></div>
      <p class="sub" id="deck-msg" role="status"></p>
      <label class="toggle"><input type="checkbox" id="autoplay"${autoplay ? ' checked' : ''} /> Say the French aloud when the answer shows</label>
    </section>`;
}

/** mode: 'review', 'add' (sub = where the card comes from), or the Cards home. */
export function renderCards(ctx, sub, mode) {
  if (mode === 'review') return reviewPage(ctx);
  if (mode === 'add') return addPage(sub);
  return homePage(ctx);
}

/** Click handling for the Cards screens. Returns true if handled. */
export async function cardsClick(e, ctx) {
  if (e.target.closest('#reveal')) {
    if (!current) return true;
    current.revealed = true;
    ctx.rerender();
    if (setting(ctx.state, 'autoplay', true)) speak(frenchOf(ctx.state.cards[current.id], ctx.deck));
    return true;
  }
  const rate = e.target.closest('[data-rate]');
  if (rate && current) {
    rateCurrent(Number(rate.dataset.rate), ctx);
    return true;
  }
  if (e.target.closest('[data-speak]') && current) {
    speak(frenchOf(ctx.state.cards[current.id], ctx.deck));
    return true;
  }
  if (e.target.closest('#look-up')) {
    const front = document.querySelector('#add-card [name=front]')?.value.trim();
    const msg = document.getElementById('add-msg');
    if (!front) {
      if (msg) msg.textContent = 'Type the French first.';
      return true;
    }
    window.open(`https://translate.google.com/?sl=fr&tl=en&text=${encodeURIComponent(front)}`, '_blank', 'noopener');
    return true;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    deleteCard(ctx.state, del.dataset.del);
    if (current && current.id === del.dataset.del) current = null;
    ctx.save();
    ctx.rerender();
    return true;
  }
  return false;
}

function rateCurrent(value, ctx) {
  const card = ctx.state.cards[current.id];
  putCard(ctx.state, review(card, value, new Date()));
  current = null;
  ctx.save();
  ctx.rerender({ keepScroll: false });
}

export function cardsKey(e, ctx) {
  if (e.target.closest('input, textarea, select')) return false;
  if (!current || !location.hash.startsWith('#/cards/review')) return false;
  if ((e.key === ' ' || e.key === 'Enter') && !current.revealed) {
    e.preventDefault();
    document.getElementById('reveal')?.click();
    return true;
  }
  if (current.revealed && ['1', '2', '3', '4'].includes(e.key)) {
    rateCurrent(Number(e.key), ctx);
    return true;
  }
  return false;
}

export function cardsSubmit(e, ctx) {
  if (e.target.id !== 'add-card') return false;
  e.preventDefault();
  const f = new FormData(e.target);
  const front = String(f.get('front') || '').trim();
  const back = String(f.get('back') || '').trim();
  if (!front || !back) return true;
  lastSrc = SOURCES[f.get('src')] ? String(f.get('src')) : 'other';
  putCard(ctx.state, newOwnCard({ front, back, src: lastSrc }));
  prefill = null;
  ctx.save();
  ctx.rerender({ keepScroll: true, focus: '#add-card [name=front]', msg: ['#add-msg', `Added “${front}”.`] });
  return true;
}

export async function cardsChange(e, ctx) {
  if (e.target.id === 'autoplay') {
    setSetting(ctx.state, 'autoplay', e.target.checked);
    ctx.save();
    return true;
  }
  if (e.target.id !== 'deck-file' || !e.target.files[0]) return false;
  const msg = document.getElementById('deck-msg');
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (!validDeck(data)) throw new Error('shape');
    await ctx.setDeck(data, { upload: true });
    current = null;
    ctx.rerender({ msg: ['#deck-msg', `Imported ${data.words.length.toLocaleString('en')} words.`] });
  } catch {
    msg.textContent = 'That file is not a word deck made by parse_apkg.py.';
  }
  return true;
}

/** Forget the card being shown (e.g. after a sync replaced the state). */
export function resetReview() {
  current = null;
}
