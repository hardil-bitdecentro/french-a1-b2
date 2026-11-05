// Turns the text read from a photographed page into flashcard candidates.
// Pure functions: the caller passes the text, the deck and what the learner already has.

const GRAMMAR_RANKS = 100; // The most frequent words are grammar the learner already meets every day.
const MAX_OTHER = 40;
const MIN_OTHER_LETTERS = 5; // Shorter leftovers on real pages were mostly fragments of misread words.
const ELIDED = new Set(['l', 'd', 'j', 'qu', 'n', 's', 'm', 't', 'c', 'jusqu', 'lorsqu', 'puisqu', 'quoiqu']);
const VOWELS = 'aeiouyàâäæéèêëîïôöœùûüÿ';
const FRENCH_WORD = new RegExp(`^[a-zç${VOWELS}]+$`);
const NO_VOWEL = new RegExp(`^[^${VOWELS}]+$`);
const TOO_MANY_VOWELS = new RegExp(`[${VOWELS}]{5}`);
const TOO_MANY_CONSONANTS = new RegExp(`[^${VOWELS}]{5}`);
const REPEATED_JUNK = /(.{1,3})\1\1/;
const TOKEN = /[\p{L}\p{N}]+(?:['\-­][\p{L}\p{N}]+)*/gu;

// Forms of the commonest verbs and small words that only exist as a form of another word, plus the same words
// with the apostrophe the camera lost, and what it keeps making of "parle" and "Mais". Never a card or an unknown word.
const GRAMMAR_FORMS = new Set(
  `est es suis sont êtes sommes été étais était étions étiez étaient sera seras serai serons serez seront serait
  ai as a ont avez avons eu eue eus eues avais avait avions aviez avaient aura auras aurai aurons aurez auront aurait
  vais vas va vont allez allons allé allée allés allées allais allait irai ira iras irons irez iront irait
  fais fait font faites faisons faisais faisait fera feras ferai ferons ferez feront ferait
  dis dit disent disons dites disait dira vois voit voient voyez voyons vu vue vus vues verra verrai
  des du au aux une ces cet cette ma ta sa mes tes ses nos vos leurs tous toute toutes
  eux elles celle celles ceux soi aujourd hui quelqu parce etc
  cest jai nest quil quon sest dun dune parie maïs`.split(/\s+/),
);

// Common verbs whose forms don't follow the endings below. Only used if the infinitive is in the deck.
const IRREGULAR = Object.fromEntries(
  Object.entries({
    prendre: 'prend prends prenons prenez prennent pris prise prises prenait prenais prendra',
    apprendre: 'apprend apprends apprenons apprenez apprennent appris apprise',
    comprendre: 'comprend comprends comprenons comprenez comprennent compris comprise',
    venir: 'viens vient venons venez viennent venu venue venus venues venait venais viendra',
    revenir: 'reviens revient revenons revenez reviennent revenu revenue',
    devenir: 'deviens devient devenons devenez deviennent devenu devenue',
    tenir: 'tiens tient tenons tenez tiennent tenu tenue',
    mettre: 'mets met mettons mettez mettent mis mise mises',
    pouvoir: 'peux peut pouvons pouvez peuvent pu pouvait pourra pourrait',
    vouloir: 'veux veut voulons voulez veulent voulu voulait voudrais voudrait voudra',
    devoir: 'dois doit devons devez doivent dû devait devrait devra',
    savoir: 'sais sait savons savez savent su savait saura',
    partir: 'pars partons partez partent parti partie partis parties partait partira',
    sortir: 'sors sortons sortez sortent sorti sortie sortis sorties sortait sortira',
    dormir: 'dors dort dormons dormez dorment dormi',
    boire: 'bois boit buvons buvez boivent bu buvait',
    lire: 'lis lit lisons lisez lisent lu lue lisait',
    écrire: 'écris écrit écrivons écrivez écrivent écrite écrits écrites',
    croire: 'crois croit croyons croyez croient cru',
    connaître: 'connais connaît connaissons connaissez connaissent connu connue',
    ouvrir: 'ouvre ouvres ouvrons ouvrez ouvrent ouvert ouverte ouverts ouvertes',
    vivre: 'vis vit vivons vivez vivent vécu',
    suivre: 'suit suivons suivez suivent suivi suivie',
    recevoir: 'reçois reçoit recevons recevez reçoivent reçu reçue',
    envoyer: 'envoie envoies envoient envoyé envoyée',
    payer: 'paie paies paient',
  }).flatMap(([verb, forms]) => forms.split(' ').map((form) => [form, verb])),
);

const VERB_ENDINGS = [
  [
    'er',
    'erions eriez erons erez eront erais erait erai eras era aient ions iez ons ent ais ait ant ées és ée ez es é e',
  ],
  [
    'ir',
    'issaient issions issiez issons issez issent issais issait issant irons irez iront irais irait irai iras ira ies is it ie i',
  ],
  ['re', 'aient ions iez ons ent ais ait ant ez ues us ue u s'],
].map(([suffix, endings]) => [suffix, endings.split(' ')]);
const MIN_VERB_STEM = 3;
const MIN_BASE = 3;
const MIN_SPELLING_SAMPLE = 1000; // A deck smaller than this says too little about how French is spelled.

// One lookup per deck: findWords runs once per photo, but the deck has thousands of words.
const lookups = new WeakMap();
const EMPTY_LOOKUP = { byWord: new Map(), gramSets: null };

function lookupFor(deck) {
  if (!deck || !Array.isArray(deck.words)) return EMPTY_LOOKUP;
  let lookup = lookups.get(deck);
  if (!lookup) {
    const byWord = new Map();
    const gramSets = { any: new Set(), starts: new Set(), ends: new Set() };
    for (const entry of deck.words) {
      const word = normalise(entry.w);
      if (!byWord.has(word)) byWord.set(word, entry);
      for (const gram of grams(word)) gramSets.any.add(gram);
      gramSets.starts.add(word.slice(0, 3));
      gramSets.ends.add(word.slice(-3));
    }
    lookup = { byWord, gramSets: deck.words.length >= MIN_SPELLING_SAMPLE ? gramSets : null };
    lookups.set(deck, lookup);
  }
  return lookup;
}

function normalise(text) {
  return straightApostrophes(String(text ?? '').normalize('NFC'))
    .trim()
    .toLowerCase();
}

function straightApostrophes(text) {
  return text.replace(/[’ʼ‘`´′]/g, "'");
}

function grams(word) {
  const out = [];
  for (let i = 0; i + 3 <= word.length; i++) out.push(word.slice(i, i + 3));
  return out;
}

function isVerb(entry) {
  return !entry.pos || /^v\b/.test(entry.pos);
}

function longEnough(base) {
  return base.length >= MIN_BASE;
}

/** chevaux → cheval, chats → chat, journaux → journal. */
function singulars(word) {
  const out = [];
  if (word.endsWith('aux')) out.push(`${word.slice(0, -3)}al`);
  if (word.endsWith('s') || word.endsWith('x')) out.push(word.slice(0, -1));
  return out.filter(longEnough);
}

/** petites → petit, bonne → bon, heureuse → heureux, active → actif, première → premier. */
function masculines(word) {
  const one = word.endsWith('s') ? word.slice(0, -1) : word;
  if (!one.endsWith('e')) return [];
  const stem = one.slice(0, -1);
  const out = [stem];
  if (/([lnst])\1$/.test(stem)) out.push(stem.slice(0, -1));
  if (stem.endsWith('eus')) out.push(`${stem.slice(0, -1)}x`);
  if (stem.endsWith('iv')) out.push(`${stem.slice(0, -1)}f`);
  if (stem.endsWith('èr')) out.push(`${stem.slice(0, -2)}er`);
  return out.filter(longEnough);
}

/** Spelling changes inside regular verbs: préfère → préfér-, achète → achet-, appelle → appel-, mangeons → mang-. */
function stemSpellings(stem) {
  const out = [stem];
  if (stem.endsWith('ge')) out.push(stem.slice(0, -1));
  if (stem.endsWith('ç')) out.push(`${stem.slice(0, -1)}c`);
  const grave = stem.lastIndexOf('è');
  if (grave >= 0) {
    out.push(`${stem.slice(0, grave)}é${stem.slice(grave + 1)}`, `${stem.slice(0, grave)}e${stem.slice(grave + 1)}`);
  }
  if (/([lt])\1$/.test(stem)) out.push(stem.slice(0, -1));
  return out;
}

function infinitives(word) {
  const out = [];
  for (const [suffix, endings] of VERB_ENDINGS) {
    for (const ending of endings) {
      if (!word.endsWith(ending)) continue;
      const stem = word.slice(0, -ending.length);
      if (stem.length < MIN_VERB_STEM) continue;
      for (const spelling of stemSpellings(stem)) out.push(spelling + suffix);
    }
  }
  if (word.endsWith('d') && word.length > MIN_VERB_STEM) out.push(`${word}re`); // vend → vendre
  return out;
}

/** Low-resolution photos often turn è into é: trés, aprés, mére. */
function accentSlips(word) {
  const out = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] === 'é') out.push(`${word.slice(0, i)}è${word.slice(i + 1)}`);
  }
  return out;
}

function firstKnown(forms, byWord, accept = () => true) {
  for (const form of forms) {
    const entry = byWord.get(form);
    if (entry && accept(entry)) return entry;
  }
  return null;
}

/**
 * The deck entry a page word stands for, or null. An exact headword always wins, so a word never drifts to another
 * meaning. Verbs come before feminines: "chante" is chanter when the deck has it, not "le chant" with an -e.
 */
function entryFor(word, byWord) {
  return (
    byWord.get(word) ||
    firstKnown(accentSlips(word), byWord) ||
    firstKnown(singulars(word), byWord) ||
    firstKnown([IRREGULAR[word], ...infinitives(word)], byWord, isVerb) ||
    firstKnown(masculines(word), byWord) ||
    null
  );
}

/** Splits one printed token (l'école, est-ce, week-end) into the words to look up. */
function wordsIn(token, byWord) {
  const lower = normalise(token);
  const unbroken = lower.replace(/­/g, ''); // por-table broken across a line end
  if (lower !== unbroken && byWord.has(unbroken)) return [unbroken];
  const whole = lower.replace(/­/g, '-');
  if (byWord.has(whole)) return [whole];
  const pieces = whole.split(/['-]/).filter(Boolean);
  while (pieces.length > 1 && ELIDED.has(pieces[0])) {
    pieces.shift();
    if (byWord.has(pieces.join('-'))) return [pieces.join('-')];
  }
  return pieces;
}

/** Does this read like a French word rather than something the camera made up? */
function plausible(word, gramSets) {
  if (word.length < MIN_OTHER_LETTERS || word.length > 24) return false;
  if (!FRENCH_WORD.test(word) || NO_VOWEL.test(word)) return false;
  if (REPEATED_JUNK.test(word) || TOO_MANY_VOWELS.test(word) || TOO_MANY_CONSONANTS.test(word)) return false;
  if (!gramSets) return true;
  // The deck is a sample of French spelling: fragments like "tion" start or end in ways it never does.
  const singular = word.replace(/(?<=.{3})[sx]$/, '');
  if (!gramSets.starts.has(word.slice(0, 3)) || !gramSets.ends.has(singular.slice(-3))) return false;
  const parts = grams(word);
  return parts.filter((gram) => gramSets.any.has(gram)).length / parts.length >= 0.75;
}

/** Tokens in page order, each with whether its capital marks it as a name: Odile : … or chez Léon or Anne Martin. */
function readTokens(text) {
  const clean = straightApostrophes(String(text ?? '').normalize('NFC'))
    .replace(/[­‐‑]/g, '-')
    .replace(/(\p{L})-[ \t]*\r?\n\s*(\p{Ll})/gu, '$1­$2');
  const tokens = [...clean.matchAll(TOKEN)].map((match) => {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;
    const capital = /^\p{Lu}\p{Ll}/u.test(raw);
    const midSentence = /[\p{L},][ \t]+$/u.test(clean.slice(Math.max(0, start - 3), start));
    const beforeName = /^[ \t]+\p{Lu}\p{Ll}/u.test(clean.slice(end, end + 4));
    const speaker = /^[ \t]*:/.test(clean.slice(end, end + 3));
    return { raw, nameLike: capital && (midSentence || beforeName || speaker), lower: !/^\p{Lu}/u.test(raw) };
  });
  const seenLower = new Set(tokens.filter((token) => token.lower).map((token) => normalise(token.raw)));
  for (const token of tokens) token.name = token.nameLike && !seenLower.has(normalise(token.raw));
  return tokens;
}

/** Words read off a page: deck words the learner doesn't have yet, and other French-looking words. */
export function findWords(text, deck, isKnown = () => false) {
  const { byWord, gramSets } = lookupFor(deck);
  const inDeck = [];
  const other = [];
  const ranks = new Set();
  const others = new Set();
  for (const { raw, name } of readTokens(text)) {
    if (name) continue; // Pierre is a person here, not "la pierre".
    if (/\p{N}/u.test(raw)) continue; // Numbers, and the camera's mix of digits and letters.
    if (/\p{L}\p{Lu}\p{Ll}/u.test(raw)) continue; // A capital inside a word is the camera's mistake too.
    for (const word of wordsIn(raw, byWord)) {
      if (GRAMMAR_FORMS.has(word)) continue;
      const entry = entryFor(word, byWord);
      if (entry) {
        if (entry.r < GRAMMAR_RANKS || ranks.has(entry.r) || isKnown(entry.r)) continue;
        ranks.add(entry.r);
        inDeck.push({ word, fr: entry.a, en: entry.m, rank: entry.r });
      } else if (!others.has(word) && other.length < MAX_OTHER && plausible(word, gramSets)) {
        others.add(word);
        other.push(word);
      }
    }
  }
  return { inDeck, other };
}

/** The deck's meaning when the whole phrase is a deck word, with or without its article; otherwise ''. */
export function lookupPhrase(text, deck) {
  const { byWord } = lookupFor(deck);
  const phrase = normalise(text).replace(/\s+/g, ' ');
  if (!phrase) return '';
  const exact = byWord.get(phrase);
  if (exact) return exact.m || '';
  const match = /^(le |la |l'|un |une |d')(.+)$/.exec(phrase);
  const entry = match && byWord.get(match[2]);
  if (!entry) return '';
  const own = normalise(entry.a).replace(/\s*\(.*\)$/, '');
  if (own === phrase) return entry.m || '';
  const article = match[1].trim();
  const fits =
    ((article === 'le' || article === 'un') && entry.g !== 'f') ||
    ((article === 'la' || article === 'une') && entry.g !== 'm') ||
    (article === "l'" && /^[aeiouyhàâäæéèêëîïôöœùûüÿ]/.test(match[2]));
  return fits ? entry.m || '' : '';
}
