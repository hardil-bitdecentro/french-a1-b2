// Photo of a page: read a photographed page on this device and pick the words to learn.
// Nothing is uploaded. The reading engine is only loaded the first time it is used.
import { esc } from './logic.js';
import { putCard } from './store.js';
import { newDeckCard, newOwnCard, deckCardId } from './cards.js';

let result = null; // { text, inDeck, other, on:Set, previewUrl }
let busy = false;
let message = '';

export const photoBusy = () => busy;

function resultsHtml() {
  if (!result) return '';
  const { inDeck, other, on } = result;
  const rows = inDeck
    .map(
      (w) => `
      <label class="word-row">
        <input type="checkbox" data-photo-word="${w.rank}"${on.has(w.rank) ? ' checked' : ''} />
        <span><span class="task-title" lang="fr">${esc(w.fr)}</span><br /><span class="sub">${esc(w.en)}</span></span>
      </label>`,
    )
    .join('');
  const others = other
    .map(
      (w) => `
      <div class="word-row">
        <b lang="fr">${esc(w)}</b>
        <input type="text" data-photo-other="${esc(w)}" maxlength="120" placeholder="meaning, if you want this one" aria-label="Meaning of ${esc(w)}" />
      </div>`,
    )
    .join('');
  const count = on.size;
  return `
    <section class="card">
      <h2>Words found</h2>
      ${
        inDeck.length
          ? `<p class="sub">From your 5,000-word deck, leaving out ones you already have. Tick the ones you want to learn.</p>${rows}`
          : '<p class="sub">No new deck words on this page. Check the text below: a sharper, flatter, well-lit photo usually reads better.</p>'
      }
      ${inDeck.length ? `<div class="acts"><button class="btn primary big" type="button" id="photo-add">Add ${count} card${count === 1 ? '' : 's'}</button></div>` : ''}
    </section>
    ${
      other.length
        ? `<section class="card">
            <details>
              <summary>Other words (${other.length})</summary>
              <p class="sub">Not in your deck, and some may be misread. Type a meaning for any you want, then add them.</p>
              ${others}
              <div class="acts"><button class="act" type="button" id="photo-add-other">Add the ones with a meaning</button></div>
            </details>
          </section>`
        : ''
    }
    <section class="card">
      <details>
        <summary>Text it read</summary>
        <pre class="note" lang="fr">${esc(result.text)}</pre>
      </details>
    </section>`;
}

/** The photo page. */
export function photoHtml() {
  return `
    <p class="crumb"><a href="#/cards">← Cards</a></p>
    <h1>Photo of a page</h1>
    <p class="sub">Take a photo and it finds words you could learn. It finds many of the words, not all of them, so check the list. It reads the page on this device and works offline: nothing is uploaded. Keep the page flat and well lit.</p>
    <div class="btn-pair">
      <label class="btn primary file">Take a photo<input type="file" id="photo-camera" accept="image/*" capture="environment" /></label>
      <label class="btn file">Choose a picture<input type="file" id="photo-file" accept="image/*" /></label>
    </div>
    ${result?.previewUrl ? `<img class="photo-preview" src="${result.previewUrl}" alt="Your photo of the page" />` : ''}
    <div id="photo-status" role="status">
      ${message ? `<p class="sub">${esc(message)}</p>` : ''}
    </div>
    ${resultsHtml()}`;
}

function showProgress(fraction, text) {
  const el = document.getElementById('photo-status');
  if (!el) return;
  el.innerHTML = `<p class="sub">${esc(text)}</p><progress class="photo-progress" max="1" value="${Number(fraction) || 0}"></progress>`;
}

/** Handle a chosen photo. Returns true if this event was for the photo page. */
export async function photoChange(e, ctx) {
  const box = e.target.closest('[data-photo-word]');
  if (box) {
    const rank = Number(box.dataset.photoWord);
    if (box.checked) result.on.add(rank);
    else result.on.delete(rank);
    const count = result.on.size;
    const add = document.getElementById('photo-add');
    if (add) add.textContent = `Add ${count} card${count === 1 ? '' : 's'}`;
    return true;
  }
  if ((e.target.id !== 'photo-camera' && e.target.id !== 'photo-file') || !e.target.files[0]) return false;
  const file = e.target.files[0];
  e.target.value = '';
  if (result?.previewUrl) URL.revokeObjectURL(result.previewUrl);
  result = null;
  message = '';
  busy = true;
  ctx.rerender();
  showProgress(0, 'Getting ready…');
  try {
    const [{ recognise }, { findWords }] = await Promise.all([import('./photo.js'), import('./ocr-words.js')]);
    const text = await recognise(file, showProgress);
    const found = findWords(text, ctx.deck, (rank) => !!ctx.state.cards[deckCardId(rank)]);
    result = { text, ...found, on: new Set(), previewUrl: URL.createObjectURL(file) };
    if (!ctx.deck) message = 'Import your word deck in Cards to see meanings for these words.';
  } catch (err) {
    message = err?.message || "Couldn't read that photo. Try another one.";
  }
  busy = false;
  ctx.rerender();
  return true;
}

/** Add the chosen words. Returns true if handled. */
export function photoClick(e, ctx) {
  if (e.target.closest('#photo-add') && result) {
    const now = new Date();
    const chosen = result.inDeck.filter((w) => result.on.has(w.rank));
    if (!chosen.length) {
      message = 'Tick at least one word first.';
      ctx.rerender();
      return true;
    }
    // Deck cards, so they keep their sound and examples and never come up again as new.
    for (const w of chosen) putCard(ctx.state, { ...newDeckCard(w.rank, now), src: 'photo' });
    ctx.save();
    result.inDeck = result.inDeck.filter((w) => !result.on.has(w.rank));
    result.on = new Set();
    message = `Added ${chosen.length} card${chosen.length === 1 ? '' : 's'}. They're in your reviews now.`;
    ctx.rerender();
    return true;
  }
  if (e.target.closest('#photo-add-other') && result) {
    const filled = [...document.querySelectorAll('[data-photo-other]')].filter((i) => i.value.trim());
    for (const input of filled) {
      putCard(ctx.state, newOwnCard({ front: input.dataset.photoOther, back: input.value.trim(), src: 'other' }));
    }
    ctx.save();
    const added = new Set(filled.map((i) => i.dataset.photoOther));
    result.other = result.other.filter((w) => !added.has(w));
    message = `Added ${filled.length} card${filled.length === 1 ? '' : 's'}.`;
    ctx.rerender();
    return true;
  }
  return false;
}
