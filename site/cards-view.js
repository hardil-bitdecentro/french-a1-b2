// The Cards screen: review (FSRS), add your own cards, browse them, import the word deck.
import { esc } from './logic.js';
import { putCard, deleteCard, liveCards, setting, setSetting } from './store.js';
import {
  RATINGS,
  newDeckCard,
  newOwnCard,
  review,
  preview,
  nextCard,
  queueStats,
  reviewedToday,
  deckNewToday,
  deckWord,
  validDeck,
} from './cards.js';

const SOURCES = { book: 'Grammar book', vocab: 'Vocabulary book', mistake: 'Mistake', other: 'Other' };
let current = null; // { id, revealed }
let lastSrc = 'book';

/** Text to speak for a card: the French side without "(f)/(m)" markers. */
function frenchOf(card, deck) {
  if (card.kind === 'deck') {
    const w = deckWord(deck, card.rank);
    return w ? w.a.replace(/\s*\((m|f|mf|m\/f)\)\s*/g, ' ').trim() : '';
  }
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
      <p class="flash-word g-${esc(w.g || 'x')}">${esc(w.a)}</p>`;
  }
  return `<p class="flash-meta">${esc(SOURCES[card.src] || 'My card')}</p><p class="flash-word">${esc(card.front)}</p>`;
}

function backHtml(card, deck) {
  if (card.kind === 'deck') {
    const w = deckWord(deck, card.rank);
    if (!w) return '';
    const ex = (w.ex || [])
      .map(([fr, en]) => `<li><span class="ex-fr">${esc(fr)}</span><span class="ex-en">${esc(en)}</span></li>`)
      .join('');
    return `<p class="flash-answer">${esc(w.m)}</p>
      <p class="sub">${esc(w.ipa || '')}${w.d ? ` · ${esc(w.d)}` : ''}</p>
      ${ex ? `<ul class="examples">${ex}</ul>` : ''}`;
  }
  return `<p class="flash-answer">${esc(card.back)}</p>`;
}

function reviewHtml(ctx) {
  const { state, deck, newLimit } = ctx;
  const now = new Date();
  if (!current || !state.cards[current.id] || state.cards[current.id].del) {
    const next = nextCard(state, deck, newLimit, now);
    if (!next) {
      current = null;
      const st = queueStats(state, deck, newLimit, now);
      const soon = st.nextSoon ? Math.max(1, Math.round((st.nextSoon - now) / 60000)) : null;
      const empty = !deck && !liveCards(state).length;
      return `<section class="card flash flash-done">
        <h2>${empty ? 'No cards yet' : 'All done for now'}</h2>
        <p class="sub">${
          empty
            ? 'Import your word deck below, or add your own cards from the grammar book, the vocabulary book and your mistakes.'
            : soon
              ? `A card you're still learning comes back in ${soon} min.`
              : 'Come back tomorrow: the next cards are scheduled for later.'
        }</p>
      </section>`;
    }
    let card = next.card;
    if (!card) {
      card = newDeckCard(next.rank, now);
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
      <button class="act speak" type="button" data-speak aria-label="Pronounce">🔊 Listen</button>
    </div>
    ${
      current.revealed
        ? `<div class="flash-back">${backHtml(card, deck)}</div>
      <div class="rate">${RATINGS.map(
        (r) =>
          `<button type="button" class="rate-btn r${r.value}" data-rate="${r.value}"><b>${r.label}</b><span>${labels[r.value]}</span></button>`,
      ).join('')}</div>
      <p class="sub kbd">Keys: 1 Again · 2 Hard · 3 Good · 4 Easy</p>`
        : `<button type="button" class="btn reveal" id="reveal">Show answer</button><p class="sub kbd">Key: Space</p>`
    }
  </section>`;
}

export function renderCards(ctx, sub) {
  const { state, deck, newLimit } = ctx;
  const now = new Date();
  const reviewBlock = reviewHtml(ctx); // may start a new deck word, so count after it
  const st = queueStats(state, deck, newLimit, now);
  const mine = liveCards(state)
    .filter((c) => c.kind === 'mine')
    .sort((a, b) => (a.created < b.created ? 1 : -1));
  const started = liveCards(state).filter((c) => c.kind === 'deck').length;
  const autoplay = setting(state, 'autoplay', true);
  if (sub && SOURCES[sub]) lastSrc = sub;
  const src = lastSrc;
  return `
    <h1>Flashcards</h1>
    <p class="sub"><b>${st.due}</b> due now · <b>${deckNewToday(state, now)}</b> of ${newLimit} new words started today · <b>${reviewedToday(state, now)}</b> reviewed today</p>
    ${reviewBlock}

    <section class="card" id="add">
      <h2>Add a card</h2>
      <p class="sub">French on the front, the meaning on the back. Whole phrases work better than single words (<i>louer un appartement</i>, not <i>louer</i>).</p>
      <form id="add-card" class="form" autocomplete="off">
        <label>French (front)<input name="front" required maxlength="300" placeholder="payer le loyer" /></label>
        <label>Meaning (back)<input name="back" required maxlength="300" placeholder="to pay the rent" /></label>
        <label>From<select name="src">${Object.entries(SOURCES)
          .map(([k, v]) => `<option value="${k}"${k === src ? ' selected' : ''}>${v}</option>`)
          .join('')}</select></label>
        <button class="btn primary" type="submit">Add card</button>
        <p class="sub" id="add-msg" role="status"></p>
      </form>
    </section>

    <section class="card">
      <h2>Your cards <span class="sub">· ${mine.length}</span></h2>
      ${
        mine.length
          ? `<ul class="plain mycards">${mine
              .slice(0, 100)
              .map(
                (c) =>
                  `<li><div><p class="task-title">${esc(c.front)}</p><p class="sub">${esc(c.back)} · ${esc(SOURCES[c.src] || '')}</p></div><button class="act danger" type="button" data-del="${esc(c.id)}">Delete</button></li>`,
              )
              .join('')}</ul>${mine.length > 100 ? `<p class="sub">Showing the newest 100.</p>` : ''}`
          : '<p class="sub">None yet. The "Add a card" buttons on the book and vocabulary tasks bring you here.</p>'
      }
    </section>

    <section class="card">
      <h2>Word deck</h2>
      ${
        deck
          ? `<p>${esc(deck.name || 'Word deck')}: <b>${deck.words.length.toLocaleString('en')}</b> words, <b>${started}</b> started.</p>
             <p class="sub">New words come in frequency order, ${newLimit} a day on plan days (none on Sundays and vocabulary-book evenings).</p>`
          : `<p class="sub">Import <code>french-5000-words.json</code> (made from your Anki deck, in <code>~/projects/french-private/</code>). It stays on your device and in your encrypted sync, never on the website.</p>`
      }
      <label class="act file">${deck ? 'Replace deck' : 'Import word deck'}<input type="file" id="deck-file" accept="application/json,.json" /></label>
      <p class="sub" id="deck-msg" role="status"></p>
    </section>

    <section class="card">
      <h2>Settings</h2>
      <label class="toggle"><input type="checkbox" id="autoplay"${autoplay ? ' checked' : ''} /> Pronounce the French automatically when the answer is shown</label>
    </section>`;
}

/** Click handling for the Cards screen. Returns true if handled. */
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
  ctx.rerender();
}

export function cardsKey(e, ctx) {
  if (e.target.closest('input, textarea, select')) return false;
  if (!current) return false;
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
