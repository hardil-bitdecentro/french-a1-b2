// Reads the text on a photographed page with Tesseract, entirely on this device: the photo never leaves it.
// The library loads on first use, so the page pays nothing for it until someone actually takes a photo.

const FOLDER = 'vendor/ocr/';

export const OCR_FILES = [
  'tesseract.min.js',
  'worker.min.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'fra.traineddata',
  'LICENSE',
  'NOTICE',
  'tesseract.min.js.LICENSE.txt',
  'worker.min.js.LICENSE.txt',
].map((file) => FOLDER + file);

const LOAD_LIMIT_MS = 3 * 60 * 1000;
const PAGE_LIMIT_MS = 5 * 60 * 1000;

// These numbers come from measuring real phone photos of textbook pages, dim and tilted.
const LONGEST_SIDE = 3000; // Small print needs the pixels: about twice the words of 2000.
const PAPER_CELLS = 75; // Light is evened out per cell, this many along the longest side.
const BLACK_POINT = 0.5; // Of the paper's brightness; anything darker prints as solid black.
// Words below these came out misread far more often. Dropping them costs about one real word in eight.
const MIN_WORD_CONFIDENCE = 65;
const MIN_SHORT_WORD_CONFIDENCE = 75;
const LAYOUT_OPTIONS = {
  tessedit_pageseg_mode: '3',
  thresholding_method: '2', // Sauvola. Tesseract's default finds next to nothing on a dim photo.
};
const READ_OPTIONS = { ...LAYOUT_OPTIONS, rotateAuto: true }; // Straightens a tilted page.
const WHOLE_WORDS = { text: false, blocks: true };

// The orientation check reads a small crop and counts the words Tesseract is sure of.
const PROBE_CONFIDENCE = 70;
const PROBE_ENOUGH_WORDS = 8;

/** Plain gray from canvas pixels. */
export function grayscale(rgba) {
  const gray = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    gray[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return gray;
}

/** How bright the paper is in each cell of a coarse grid, ignoring the print on it. */
function paperGrid(gray, w, h) {
  const cell = Math.max(8, Math.round(Math.max(w, h) / PAPER_CELLS));
  const cols = Math.max(2, Math.ceil(w / cell));
  const rows = Math.max(2, Math.ceil(h / cell));
  const tops = new Float32Array(cols * rows);
  const counts = new Uint32Array(256);
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * h) / rows);
    const y1 = Math.floor(((r + 1) * h) / rows);
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols);
      const x1 = Math.floor(((c + 1) * w) / cols);
      counts.fill(0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) counts[gray[y * w + x]]++;
      const wanted = (x1 - x0) * (y1 - y0) * 0.9;
      let value = 0;
      for (let seen = counts[0]; seen < wanted && value < 255; seen += counts[++value]);
      tops[r * cols + c] = value;
    }
  }
  const eachNeighbour = (r, c, visit) => {
    for (let rr = Math.max(0, r - 1); rr <= Math.min(rows - 1, r + 1); rr++) {
      for (let cc = Math.max(0, c - 1); cc <= Math.min(cols - 1, c + 1); cc++) visit(rr * cols + cc);
    }
  };
  // A cell full of bold print is not dark paper, so take the brightest neighbour, then smooth the steps away.
  const brightest = tops.map((_, i) => {
    let top = 0;
    eachNeighbour(Math.floor(i / cols), i % cols, (n) => (top = Math.max(top, tops[n])));
    return top;
  });
  const paper = brightest.map((_, i) => {
    let sum = 0;
    let count = 0;
    eachNeighbour(Math.floor(i / cols), i % cols, (n) => {
      sum += brightest[n];
      count++;
    });
    return sum / count;
  });
  return { paper, cols, rows };
}

/** Evens out the light across the page, so a dim corner or a shadow reads like the rest. */
export function evenLight(gray, w, h) {
  const { paper, cols, rows } = paperGrid(gray, w, h);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(rows - 1.001, Math.max(0, ((y + 0.5) * rows) / h - 0.5));
    const r = Math.floor(fy);
    const ry = fy - r;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(cols - 1.001, Math.max(0, ((x + 0.5) * cols) / w - 0.5));
      const c = Math.floor(fx);
      const rx = fx - c;
      const top = paper[r * cols + c] + (paper[r * cols + c + 1] - paper[r * cols + c]) * rx;
      const bottom = paper[(r + 1) * cols + c] + (paper[(r + 1) * cols + c + 1] - paper[(r + 1) * cols + c]) * rx;
      const here = Math.max(1, top + (bottom - top) * ry);
      out[y * w + x] = (255 * (gray[y * w + x] / here - BLACK_POINT)) / (1 - BLACK_POINT);
    }
  }
  return out;
}

/** Quarter turns clockwise. */
export function turned(gray, w, h, degrees) {
  if (!degrees) return { gray, w, h };
  const nw = degrees === 180 ? w : h;
  const nh = degrees === 180 ? h : w;
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      if (degrees === 90) out[x * nw + (nw - 1 - y)] = v;
      else if (degrees === 270) out[(nh - 1 - x) * nw + y] = v;
      else out[(nh - 1 - y) * nw + (nw - 1 - x)] = v;
    }
  }
  return { gray: out, w: nw, h: nh };
}

/** The middle of the picture at half size: a cheap sample of the page. */
function middleSample(gray, w, h) {
  const nw = w >> 2;
  const nh = h >> 2;
  const x0 = w >> 2;
  const y0 = h >> 2;
  const out = new Uint8ClampedArray(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const at = (y0 + y * 2) * w + x0 + x * 2;
      out[y * nw + x] = (gray[at] + gray[at + 1] + gray[at + w] + gray[at + w + 1]) >> 2;
    }
  }
  return { gray: out, w: nw, h: nh };
}

function allWords(data) {
  return (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
}

/** The quarter turn that stands the page upright. A phone lying flat over a book often saves it the wrong way. */
async function uprightTurn(worker, lit, w, h, encode) {
  const sample = middleSample(lit, w, h);
  const probe = async (degrees) => {
    const view = turned(sample.gray, sample.w, sample.h, degrees);
    const { data } = await worker.recognize(await encode(view.gray, view.w, view.h), LAYOUT_OPTIONS, WHOLE_WORDS);
    const sure = allWords(data).filter((word) => word.confidence >= PROBE_CONFIDENCE && /\p{L}{3}/u.test(word.text));
    const tall = sure.filter((word) => word.bbox.y1 - word.bbox.y0 > word.bbox.x1 - word.bbox.x0);
    return { sure: sure.length, tall: tall.length };
  };
  const upright = await probe(0);
  // Tesseract reads text running down the page by itself; words taller than wide give that away.
  if (upright.sure >= PROBE_ENOUGH_WORDS) return upright.tall * 2 > upright.sure ? 270 : 0;
  let best = 0;
  let bestSure = upright.sure;
  for (const degrees of [90, 180, 270]) {
    const { sure } = await probe(degrees);
    if (sure >= PROBE_ENOUGH_WORDS && sure > bestSure * 2) {
      best = degrees;
      bestSure = sure;
    }
  }
  return best;
}

function sureEnough(word) {
  const letters = word.text.match(/\p{L}/gu)?.length ?? 0;
  return word.confidence >= (letters <= 3 ? MIN_SHORT_WORD_CONFIDENCE : MIN_WORD_CONFIDENCE);
}

/** The words Tesseract is reasonably sure of, keeping its line breaks. */
function confidentText(data) {
  const lines = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const words = line.words.filter(sureEnough).map((word) => word.text);
        if (words.length) lines.push(words.join(' '));
      }
    }
  }
  return lines.join('\n');
}

/**
 * Everything after the photo is decoded, so it can also run on test photos outside a browser.
 * `encode(gray, w, h)` makes an image file from gray pixels. `onStep` says which reading step Tesseract's progress is for.
 */
export async function readPixels(worker, rgba, width, height, encode, onStep = () => {}) {
  const lit = evenLight(grayscale(rgba), width, height);
  onStep('checking');
  const degrees = await uprightTurn(worker, lit, width, height, encode);
  const page = turned(lit, width, height, degrees);
  onStep('reading');
  const { data } = await worker.recognize(await encode(page.gray, page.w, page.h), READ_OPTIONS, WHOLE_WORDS);
  return confidentText(data).trim();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

const STOPPED = new Error('Reading the page was stopped.');

let scriptLoaded = null;
let workerReady = null;
let stopWaiting = null;
let report = () => {};
let queue = Promise.resolve();

/** Waits for a promise, but not forever and not past closeOcr. */
function waitFor(promise, limitMs) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out')), limitMs);
  });
  const stopped = new Promise((_, reject) => {
    stopWaiting = () => reject(STOPPED);
  });
  return Promise.race([promise, limit, stopped]).finally(() => {
    clearTimeout(timer);
    stopWaiting = null;
  });
}

function startWorker() {
  if (workerReady) return workerReady;
  workerReady = (async () => {
    const base = new URL(FOLDER, document.baseURI).href;
    scriptLoaded ??= loadScript(`${base}tesseract.min.js`).catch((err) => {
      scriptLoaded = null;
      throw err;
    });
    await scriptLoaded;
    // A failed language download only reaches errorHandler: createWorker's own promise would never settle.
    let failed;
    const failure = new Promise((_, reject) => {
      failed = (message) => reject(new Error(String(message)));
    });
    return Promise.race([
      failure,
      window.Tesseract.createWorker('fra', window.Tesseract.OEM.LSTM_ONLY, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base,
        workerBlobURL: false,
        gzip: false, // Pages already gzips .traineddata on the way, and the browser unpacks it before this code sees it.
        cacheMethod: 'none', // The service worker keeps these files. A second copy in IndexedDB would only go stale.
        logger: (message) => report(message),
        errorHandler: failed,
      }),
    ]);
  })();
  workerReady.catch(() => {
    workerReady = null;
  });
  return workerReady;
}

/** Decodes the photo, the right way up, at the size that reads best. */
async function decode(file) {
  try {
    return drawn(await createImageBitmap(file, { imageOrientation: 'from-image' }));
  } catch (err) {
    throw new Error('That photo could not be opened. Try a JPEG or PNG photo.', { cause: err });
  }
}

function drawn(bitmap) {
  const scale = LONGEST_SIDE / Math.max(bitmap.width, bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  // Reducing a lot in one step drops thin print on browsers with simple smoothing, so halve first.
  let source = bitmap;
  for (let sw = bitmap.width, sh = bitmap.height; sw > w * 2; sw >>= 1, sh >>= 1) {
    const half = document.createElement('canvas');
    half.width = sw >> 1;
    half.height = sh >> 1;
    half.getContext('2d').drawImage(source, 0, 0, half.width, half.height);
    source = half;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  bitmap.close();
  return { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
}

/** A PNG file from gray pixels. */
function encodeGray(gray, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    image.data[i] = image.data[i + 1] = image.data[i + 2] = gray[j];
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No image from canvas'))), 'image/png');
  });
}

// Lets the page paint the latest progress before a long stretch of pixel work.
function paint() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const LOADING = 'Loading the text reader';
const LOADING_STEPS = {
  'loading tesseract core': [0, 0.05],
  'initializing tesseract': [0.05, 0.1],
  'loading language traineddata': [0.1, 0.15],
  'initializing api': [0.15, 0.2],
};
const READING_STEPS = {
  checking: [0.25, 0.3, 'Checking which way up the page is'],
  reading: [0.3, 1, 'Reading the page'],
};

async function readFile(file, onProgress) {
  let highest = 0;
  // Never moves backwards: the upright check can run Tesseract several times over.
  const progress = (fraction, stage) => {
    highest = Math.min(1, Math.max(highest, fraction));
    if (onProgress) onProgress(highest, stage);
  };
  let reading = READING_STEPS.checking;
  report = ({ status, progress: part = 0 }) => {
    const [from, to, stage] = status === 'recognizing text' ? reading : (LOADING_STEPS[status] ?? []);
    if (from !== undefined) progress(from + (to - from) * part, stage ?? LOADING);
  };

  progress(0, LOADING);
  let worker;
  try {
    worker = await waitFor(startWorker(), LOAD_LIMIT_MS);
  } catch (err) {
    closeOcr();
    if (err === STOPPED) throw err;
    throw new Error('The text reader could not start. Check your connection and try again.', { cause: err });
  }
  progress(0.2, 'Preparing the photo');
  await paint();
  const { rgba, w, h } = await decode(file);
  await paint();
  const onStep = (step) => {
    reading = READING_STEPS[step];
    progress(reading[0], reading[2]);
  };
  try {
    const text = await waitFor(readPixels(worker, rgba, w, h, encodeGray, onStep), PAGE_LIMIT_MS);
    progress(1, 'Done');
    return text;
  } catch (err) {
    closeOcr();
    if (err === STOPPED) throw err;
    throw new Error('The page could not be read. Try again with a closer, sharper photo.', { cause: err });
  }
}

/** The text on a photographed page. One page at a time, all with the same worker. */
export function recognise(file, onProgress) {
  const job = queue.then(() => readFile(file, onProgress));
  queue = job.catch(() => {});
  return job;
}

/** Frees the reader's memory. It starts again by itself the next time a photo is read. */
export function closeOcr() {
  if (stopWaiting) stopWaiting();
  const closing = workerReady;
  workerReady = null;
  if (closing) closing.then((worker) => worker.terminate()).catch(() => {});
}
