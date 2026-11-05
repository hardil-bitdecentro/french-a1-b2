import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { findWords, lookupPhrase } from '../site/ocr-words.js';
import { OCR_FILES, grayscale, evenLight, turned, readPixels } from '../site/photo.js';

const SITE = fileURLToPath(new URL('../site/', import.meta.url));

// A tiny made-up deck. Ranks below 100 are the grammar words every learner already meets.
const DECK = {
  words: [
    { r: 3, w: 'parler', a: 'parler', g: '', pos: 'v', m: 'to speak' },
    { r: 7, w: 'mais', a: 'mais', g: '', pos: 'conj', m: 'but' },
    { r: 40, w: 'être', a: 'être', g: '', pos: 'v', m: 'to be' },
    { r: 120, w: 'école', a: "l'école (f)", g: 'f', pos: 'n', m: 'school' },
    { r: 121, w: 'chat', a: 'le chat', g: 'm', pos: 'n', m: 'cat' },
    { r: 122, w: 'cheval', a: 'le cheval', g: 'm', pos: 'n', m: 'horse' },
    { r: 123, w: 'gâteau', a: 'le gâteau', g: 'm', pos: 'n', m: 'cake' },
    { r: 124, w: 'petit', a: 'petit', g: '', pos: 'adj', m: 'small' },
    { r: 125, w: 'bon', a: 'bon', g: '', pos: 'adj', m: 'good' },
    { r: 126, w: 'heureux', a: 'heureux', g: '', pos: 'adj', m: 'happy' },
    { r: 127, w: 'premier', a: 'premier', g: '', pos: 'adj', m: 'first' },
    { r: 128, w: 'ferme', a: 'la ferme', g: 'f', pos: 'n', m: 'farm' },
    { r: 129, w: 'fermer', a: 'fermer', g: '', pos: 'v', m: 'to close' },
    { r: 130, w: 'chant', a: 'le chant', g: 'm', pos: 'n', m: 'song' },
    { r: 131, w: 'chanter', a: 'chanter', g: '', pos: 'v', m: 'to sing' },
    { r: 132, w: 'finir', a: 'finir', g: '', pos: 'v', m: 'to finish' },
    { r: 133, w: 'vendre', a: 'vendre', g: '', pos: 'v', m: 'to sell' },
    { r: 134, w: 'préférer', a: 'préférer', g: '', pos: 'v', m: 'to prefer' },
    { r: 135, w: 'manger', a: 'manger', g: '', pos: 'v', m: 'to eat' },
    { r: 136, w: 'prendre', a: 'prendre', g: '', pos: 'v', m: 'to take' },
    { r: 137, w: 'an', a: "l'an (m)", g: 'm', pos: 'n', m: 'year' },
    { r: 138, w: 'week-end', a: 'le week-end', g: 'm', pos: 'n', m: 'weekend' },
    { r: 139, w: 'portable', a: 'le portable', g: 'm', pos: 'n', m: 'mobile phone' },
    { r: 140, w: 'très', a: 'très', g: '', pos: 'adv', m: 'very' },
    { r: 141, w: 'mère', a: 'la mère', g: 'f', pos: 'n', m: 'mother' },
    { r: 142, w: 'est', a: "l'est (m)", g: 'm', pos: 'n', m: 'east' },
    { r: 143, w: 'accord', a: "d'accord (m)", g: 'm', pos: 'n', m: 'agreement' },
    { r: 144, w: 'marier', a: 'marier', g: '', pos: 'v', m: 'to marry' },
    { r: 145, w: 'pierre', a: 'la pierre', g: 'f', pos: 'n', m: 'stone' },
    { r: 146, w: 'parent', a: 'le parent', g: 'm', pos: 'n', m: 'parent' },
    { r: 147, w: 'parer', a: 'parer', g: '', pos: 'v', m: 'to adorn' },
    { r: 148, w: 'hiver', a: "l'hiver (m)", g: 'm', pos: 'n', m: 'winter' },
    { r: 149, w: 'tomber', a: 'tomber', g: '', pos: 'n', m: 'not really a verb, for the test' },
  ],
};

const ranks = (text, deck = DECK, isKnown) => findWords(text, deck, isKnown).inDeck.map((w) => w.rank);

describe('findWords: the shape of the result', () => {
  it('reports the word as printed, with the deck display and meaning', () => {
    const { inDeck, other } = findWords('Les chats dorment.', DECK);
    expect(inDeck).toEqual([{ word: 'chats', fr: 'le chat', en: 'cat', rank: 121 }]);
    expect(other).toEqual(['dorment']);
  });

  it('works with no deck, and with no text', () => {
    expect(findWords('Une grande maison blanche', null)).toEqual({
      inDeck: [],
      other: ['grande', 'maison', 'blanche'],
    });
    expect(findWords('', DECK)).toEqual({ inDeck: [], other: [] });
    expect(findWords(null, DECK)).toEqual({ inDeck: [], other: [] });
  });

  it('assumes nothing is known when isKnown is left out', () => {
    expect(findWords('le chat', DECK).inDeck).toHaveLength(1);
  });
});

describe('findWords: tokens', () => {
  it('matches decomposed accents after normalising', () => {
    expect(ranks('une école')).toEqual([120]);
  });

  it('lower-cases but keeps accents', () => {
    expect(ranks('ÉCOLE')).toEqual([120]);
    expect(ranks('ecole')).toEqual([]);
  });

  it.each([
    ["l'école", 120],
    ['l’école', 120],
    ["d'école", 120],
    ["qu'école", 120],
    ['L’ÉCOLE', 120],
    ["j'ai mangé", 135],
    ["n'ai", null],
    ["s'école", 120],
    ["m'école", 120],
    ["t'école", 120],
    ["c'école", 120],
  ])('handles the elision in %s', (text, rank) => {
    expect(ranks(text)).toEqual(rank === null ? [] : [rank]);
  });

  it('keeps a compound the deck has and splits one it does not', () => {
    expect(ranks('un week-end')).toEqual([138]);
    expect(ranks('chat-gâteau')).toEqual([121, 123]);
    expect(findWords('dis-moi', DECK).other).toEqual([]);
  });

  it('rejoins a word broken across a line end', () => {
    expect(ranks('mon por-\ntable')).toEqual([139]);
    expect(ranks('week-\nend')).toEqual([138]);
  });

  it('splits at a line-end hyphen when the joined word is not in the deck', () => {
    expect(ranks('chat-\nécole')).toEqual([121, 120]);
  });

  it('drops numbers, punctuation and short tokens, unless the deck has them', () => {
    const { inDeck, other } = findWords('12 3,5 8h10 !? « xy » zz un an', DECK);
    expect(inDeck.map((w) => w.rank)).toEqual([137]);
    expect(other).toEqual([]);
  });
});

describe('findWords: inflection', () => {
  it.each([
    ['chats', 121],
    ['gâteaux', 123],
    ['chevaux', 122],
    ['petite', 124],
    ['petites', 124],
    ['petits', 124],
    ['bonne', 125],
    ['bonnes', 125],
    ['heureuse', 126],
    ['première', 127],
    ['premières', 127],
  ])('finds the base of %s', (form, rank) => {
    expect(ranks(form)).toEqual([rank]);
  });

  it.each([
    ['fermez', 129],
    ['fermons', 129],
    ['fermé', 129],
    ['fermée', 129],
    ['fermaient', 129],
    ['fermera', 129],
    ['finissons', 132],
    ['finit', 132],
    ['vendons', 133],
    ['vendu', 133],
    ['vend', 133],
    ['préfère', 134],
    ['mangeons', 135],
    ['prennent', 136],
    ['pris', 136],
  ])('maps the verb form %s to the infinitive', (form, rank) => {
    expect(ranks(form)).toEqual([rank]);
  });

  it('leaves a verb form alone when the infinitive is not in the deck', () => {
    const { inDeck, other } = findWords('nous dansons', DECK);
    expect(inDeck).toEqual([]);
    expect(other).toEqual(['dansons']);
  });

  it('only maps verb endings to words that really are verbs', () => {
    expect(ranks('tombons')).toEqual([]);
  });

  it('an exact headword wins over any other reading', () => {
    expect(ranks('ferme')).toEqual([128]); // la ferme, even though it is also a form of fermer
    expect(ranks('parent')).toEqual([146]); // not parer
    expect(ranks('hiver')).toEqual([148]);
  });

  it('prefers the verb to an -e on a noun when both exist', () => {
    expect(ranks('je chante')).toEqual([131]);
    expect(ranks('chants')).toEqual([130]);
  });

  it('does not strip down to a stem too short to mean anything', () => {
    expect(ranks('ans')).toEqual([]);
    expect(ranks('ane')).toEqual([]);
  });

  it('corrects a grave accent the camera read as acute', () => {
    expect(ranks('trés mére')).toEqual([140, 141]);
    expect(findWords('trés', DECK).inDeck[0].word).toBe('trés');
  });
});

describe('findWords: what gets left out', () => {
  it('skips the 100 most frequent ranks, and forms of them', () => {
    expect(ranks('parler parlons mais')).toEqual([]);
  });

  it('skips what the learner already has', () => {
    expect(ranks('le chat et le cheval', DECK, (rank) => rank === 121)).toEqual([122]);
  });

  it('dedupes by rank, keeping first-seen page order and form', () => {
    const { inDeck } = findWords('Le cheval, les chats, les chevaux, le chat', DECK);
    expect(inDeck.map((w) => [w.word, w.rank])).toEqual([
      ['cheval', 122],
      ['chats', 121],
    ]);
  });

  it('never takes a form of a grammar verb for a rare homograph', () => {
    expect(ranks("c'est, il est, est-ce")).toEqual([]);
    expect(findWords('est', DECK).other).toEqual([]);
  });

  it('takes a capital in mid-sentence or a speaker label for a name, not a word', () => {
    expect(ranks('Bonjour chez Pierre')).toEqual([]);
    expect(ranks('Pierre : bonjour')).toEqual([]);
    expect(ranks('Anne Martin arrive')).toEqual([]);
    expect(findWords('On voit Odile. Odile : salut', DECK).other).not.toContain('odile');
  });

  it('still takes a capitalised word when the page also prints it in lower case', () => {
    expect(ranks('Une pierre. Voici Pierre')).toEqual([145]);
  });

  it('still takes a word capitalised only because it starts the sentence', () => {
    expect(ranks('Pierre lourde')).toEqual([145]);
    expect(ranks('Ah. Pierre lourde')).toEqual([145]);
  });
});

describe('findWords: other words', () => {
  const others = (text, deck = DECK) => findWords(text, deck).other;

  it('keeps plausible French words, once each, in page order', () => {
    expect(others('Une grande maison, une grande fenêtre', null)).toEqual(['grande', 'maison', 'fenêtre']);
  });

  it.each([
    ['digits among letters', 'bonj0ur'],
    ['no vowels', 'trtrqs'],
    ['the same letter three times', 'merrrci'],
    ['the same few letters over and over', 'ililililo'],
    ['long runs of consonants', 'garsktdin'],
    ['long runs of vowels', 'maiouaine'],
    ['a capital inside', 'maiSon'],
    ['letters French does not use', 'maßona'],
    ['too short', 'nuit'],
  ])('drops garbage: %s', (_, word) => {
    expect(others(word, null)).toEqual([]);
  });

  it('uses a big enough deck as a sample of French spelling, and ignores a small one', () => {
    const parts = ['cha', 'ton', 'ma', 'son', 're', 'li', 'ne', 'pa'];
    const words = parts.flatMap((a) => parts.flatMap((b) => parts.flatMap((c) => parts.map((d) => a + b + c + d))));
    const big = { words: words.map((w, r) => ({ r: r + 100, w, a: w, g: '', pos: 'n', m: 'made up' })) };
    expect(others('chatons', big)).toEqual(['chatons']);
    expect(others('tiont', big)).toEqual([]);
    expect(others('tiont', DECK)).toEqual(['tiont']);
  });

  it('caps the list at 40', () => {
    const many = Array.from({ length: 60 }, (_, i) => `mot${'abcdefghij'[i % 10]}${'klmnoprstu'[Math.floor(i / 10)]}e`);
    expect(others(many.join(' '), null)).toHaveLength(40);
  });
});

describe('lookupPhrase', () => {
  it.each([
    ['chat', 'cat'],
    ['  chat  ', 'cat'],
    ['le chat', 'cat'],
    ['Le Chat', 'cat'],
    ['un chat', 'cat'],
    ['la ferme', 'farm'],
    ['une ferme', 'farm'],
    ["l'école", 'school'],
    ['l’école', 'school'],
    ['école', 'school'],
    ["d'accord", 'agreement'],
    ['accord', 'agreement'],
    ['week-end', 'weekend'],
  ])('finds %s', (phrase, meaning) => {
    expect(lookupPhrase(phrase, DECK)).toBe(meaning);
  });

  it.each([['la chat'], ['le ferme'], ['les chats'], ['chats'], ['le chat noir'], ['un'], [''], ['   ']])(
    'finds nothing for "%s"',
    (phrase) => {
      expect(lookupPhrase(phrase, DECK)).toBe('');
    },
  );

  it('finds nothing without a deck', () => {
    expect(lookupPhrase('le chat', null)).toBe('');
  });
});

describe('photo.js: the parts that need no browser', () => {
  it('lists every vendored file, and only files that exist', () => {
    for (const path of OCR_FILES) expect(existsSync(SITE + path), path).toBe(true);
    const onDisk = readdirSync(`${SITE}vendor/ocr`).map((file) => `vendor/ocr/${file}`);
    expect([...OCR_FILES].sort()).toEqual(onDisk.sort());
  });

  it('vendors the three LSTM cores the library chooses between, and no others', () => {
    const cores = OCR_FILES.filter((path) => path.includes('tesseract-core')).sort();
    expect(cores).toEqual([
      'vendor/ocr/tesseract-core-lstm.wasm.js',
      'vendor/ocr/tesseract-core-relaxedsimd-lstm.wasm.js',
      'vendor/ocr/tesseract-core-simd-lstm.wasm.js',
    ]);
  });

  it('grays pixels by how bright they look', () => {
    const gray = grayscale(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0, 255]));
    expect([...gray]).toEqual([255, 0, 150]);
  });

  it('turns by quarter turns, and four turns return the page', () => {
    const page = new Uint8ClampedArray([1, 2, 3, 4, 5, 6]); // 3 wide, 2 high
    const right = turned(page, 3, 2, 90);
    expect([right.w, right.h, [...right.gray]]).toEqual([2, 3, [4, 1, 5, 2, 6, 3]]);
    const left = turned(page, 3, 2, 270);
    expect([left.w, left.h, [...left.gray]]).toEqual([2, 3, [3, 6, 2, 5, 1, 4]]);
    expect([...turned(page, 3, 2, 180).gray]).toEqual([6, 5, 4, 3, 2, 1]);
    expect(turned(page, 3, 2, 0).gray).toBe(page);
  });

  it('evens out the light: paper reads white in the dim half as well, print stays dark', () => {
    const w = 200;
    const h = 200;
    const gray = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const paper = 90 + (120 * x) / w; // Dim on the left, bright on the right.
        const print = y % 20 < 3 && x % 7 < 3; // Thin dark marks all over.
        gray[y * w + x] = print ? paper * 0.3 : paper;
      }
    }
    const lit = evenLight(gray, w, h);
    const at = (x, y) => lit[y * w + x];
    expect(at(10, 10)).toBeGreaterThan(200);
    expect(at(190, 10)).toBeGreaterThan(200);
    expect(at(14, 21)).toBe(0);
    expect(at(189, 21)).toBe(0);
  });
});

describe('readPixels', () => {
  const word = (text, confidence, tall = false) => ({
    text,
    confidence,
    bbox: tall ? { x0: 0, y0: 0, x1: 10, y1: 40 } : { x0: 0, y0: 0, x1: 40, y1: 10 },
  });
  const blocksOf = (...lines) => [{ paragraphs: [{ lines: lines.map((words) => ({ words })) }] }];
  const manyWords = (tall = false) => Array.from({ length: 10 }, () => word('maison', 95, tall));
  const rgba = (w, h) => new Uint8ClampedArray(w * h * 4).fill(200);
  const encode = (gray, w, h) => ({ w, h });

  /** A stand-in worker: answers the upright check by turn, and the real read with fixed words. */
  function fakeWorker(probeWords, pageWords) {
    const sizes = [];
    let probes = 0;
    return {
      sizes,
      recognize: async (image, options) => {
        sizes.push([image.w, image.h]);
        if (options.rotateAuto) return { data: { blocks: blocksOf(pageWords) } };
        return { data: { blocks: blocksOf(probeWords[probes++] ?? []) } };
      },
    };
  }

  it('keeps sure words and line breaks, drops unsure ones, with a higher bar for short words', async () => {
    const worker = {
      recognize: async (image, options) =>
        options.rotateAuto
          ? {
              data: {
                blocks: blocksOf(
                  [word('Une', 90), word('maison', 70), word('mxzs', 64), word('la', 74)],
                  [word('rue', 75)],
                  [word('qq', 10)],
                ),
              },
            }
          : { data: { blocks: blocksOf(manyWords()) } },
    };
    expect(await readPixels(worker, rgba(40, 20), 40, 20, encode)).toBe('Une maison\nrue');
  });

  it('copes with a page where nothing is found', async () => {
    const worker = { recognize: async () => ({ data: { blocks: null } }) };
    expect(await readPixels(worker, rgba(40, 20), 40, 20, encode)).toBe('');
  });

  it('leaves an upright page alone, and checks only once', async () => {
    const worker = fakeWorker([manyWords()], [word('maison', 90)]);
    await readPixels(worker, rgba(40, 20), 40, 20, encode);
    expect(worker.sizes).toEqual([
      [10, 5],
      [40, 20],
    ]);
  });

  it('turns a page whose print runs down the picture', async () => {
    const worker = fakeWorker([manyWords(true)], [word('maison', 90)]);
    await readPixels(worker, rgba(40, 20), 40, 20, encode);
    expect(worker.sizes.at(-1)).toEqual([20, 40]);
  });

  it('tries the other turns when upright reads nothing, and takes the one that reads', async () => {
    const worker = fakeWorker([[], manyWords(), [], []], [word('maison', 90)]);
    await readPixels(worker, rgba(40, 20), 40, 20, encode);
    expect(worker.sizes).toEqual([
      [10, 5],
      [5, 10],
      [10, 5],
      [5, 10],
      [20, 40],
    ]);
  });

  it('stays upright when no turn clearly reads better', async () => {
    const worker = fakeWorker([[word('maison', 90)], [word('maison', 90)], [], []], [word('maison', 90)]);
    await readPixels(worker, rgba(40, 20), 40, 20, encode);
    expect(worker.sizes.at(-1)).toEqual([40, 20]);
  });

  it('says which step it is on', async () => {
    const steps = [];
    const worker = fakeWorker([manyWords()], []);
    await readPixels(worker, rgba(40, 20), 40, 20, encode, (step) => steps.push(step));
    expect(steps).toEqual(['checking', 'reading']);
  });
});
