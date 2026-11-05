// Speaking: record yourself, keep every recording by date, compare with your first one, and a rough speech check.
// Recordings stay on this device: they are never uploaded or synced.
import { esc } from './logic.js';
import { clipPut, clipAll, clipDel } from './db.js';

const MAX_SECONDS = 10 * 60;
const MIC_ICON =
  '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
const STOP_ICON = '<span class="rec-stop" aria-hidden="true"></span>';

let rec = null; // { recorder, stream, chunks, startedAt, date, title, tick }
let listening = null;
let clips = [];
let queue = [];
let playingUrl = null;
let confirmDelete = null;

const pad = (n) => String(n).padStart(2, '0');
const clock = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
const shortDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const speechApi = () => window.SpeechRecognition || window.webkitSpeechRecognition;

/** A recording or a speech check is running, so the page must not be redrawn underneath it. */
export const isBusy = () => !!rec || !!listening;

function bestMime() {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

const say = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

function micErrorText(err) {
  if (err?.name === 'NotAllowedError')
    return "The microphone is blocked. Allow it in the browser's site settings, then try again.";
  if (err?.name === 'NotFoundError') return 'No microphone found on this device.';
  return `Couldn't start recording (${err?.name || 'error'}).`;
}

/** The recorder, the speech check and the list. `task` names what today's recording is for. */
export function recorderHtml(task) {
  const canRecord = 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia;
  const canHear = !!speechApi();
  return `
    <section class="card recorder" id="recorder" data-date="${esc(task.date)}" data-title="${esc(task.title)}">
      <h2>Record yourself</h2>
      ${
        canRecord
          ? `<div class="rec-main">
              <button class="rec-btn" type="button" id="rec-toggle" aria-label="Start recording">${MIC_ICON}</button>
              <div>
                <span class="rec-clock" id="rec-clock" role="timer">00:00</span>
                <p class="sub" id="rec-hint">Tap to record. It stays on this device.</p>
              </div>
            </div>`
          : '<p class="sub">This browser cannot record. Use Chrome on your phone.</p>'
      }
    </section>
    <section class="card">
      <h2>My recordings</h2>
      <div id="clip-list"><p class="sub">Loading…</p></div>
    </section>
    <section class="card">
      <h2>Speaking check</h2>
      ${
        canHear
          ? `<p class="sub">Say one French sentence and see what the phone understood. This is a rough check, not a pronunciation score. It uses Google's speech service, so it needs internet, and it can't run during a recording.</p>
             <div class="acts"><button class="act" type="button" id="hear-toggle">Say a sentence</button></div>
             <p class="heard" id="heard" lang="fr" role="status"></p>`
          : '<p class="sub">This browser has no speech check. It works in Chrome on your phone.</p>'
      }
    </section>`;
}

function listHtml() {
  if (!clips.length) return '<p class="sub">Nothing yet. Your first recording becomes the one you compare against.</p>';
  const rows = [...clips]
    .reverse()
    .map(
      (c) => `
      <li class="clip">
        <button class="act" type="button" data-clip-play="${esc(c.id)}" aria-label="Play the recording from ${esc(shortDate(c.date))}">Play</button>
        <div class="clip-text">
          <p class="task-title">${esc(shortDate(c.date))} · ${esc(c.title)}</p>
          <p class="sub">${clock(c.seconds)}${c === clips[0] ? ' · your first recording' : ''}</p>
        </div>
        <button class="act danger" type="button" data-clip-del="${esc(c.id)}">${confirmDelete === c.id ? 'Sure?' : 'Delete'}</button>
      </li>`,
    )
    .join('');
  return `
    ${clips.length > 1 ? '<div class="acts"><button class="act" type="button" id="clip-compare">Compare: my first, then my latest</button></div>' : ''}
    <p class="audio-label" id="clip-now" hidden></p>
    <audio class="book-audio" id="clip-player" controls hidden></audio>
    <ul class="plain clips">${rows}</ul>`;
}

/** Fill in the list once the page is on screen. */
export async function mountRecorder() {
  if (!document.getElementById('clip-list')) return;
  try {
    clips = (await clipAll()).sort((a, b) => a.at - b.at);
  } catch {
    clips = [];
  }
  const el = document.getElementById('clip-list');
  if (el) el.innerHTML = listHtml();
}

async function startRecording(box) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mimeType = bestMime();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    rec = {
      recorder,
      stream,
      chunks: [],
      startedAt: Date.now(),
      date: box.dataset.date,
      title: box.dataset.title,
    };
    recorder.ondataavailable = (ev) => {
      if (ev.data.size) rec.chunks.push(ev.data);
    };
    recorder.onstop = finishRecording;
    recorder.start(1000);
    rec.tick = setInterval(() => {
      const secs = (Date.now() - rec.startedAt) / 1000;
      say('rec-clock', clock(secs));
      if (secs >= MAX_SECONDS) stopRecording();
    }, 250);
    navigator.storage?.persist?.().catch(() => {});
    const btn = document.getElementById('rec-toggle');
    btn.innerHTML = STOP_ICON;
    btn.setAttribute('aria-label', 'Stop recording');
    say('rec-hint', 'Recording… tap to stop.');
  } catch (err) {
    rec = null;
    say('rec-hint', micErrorText(err));
  }
}

function stopRecording() {
  if (rec?.recorder.state === 'recording') rec.recorder.stop();
}

async function finishRecording() {
  const done = rec;
  rec = null;
  clearInterval(done.tick);
  done.stream.getTracks().forEach((t) => t.stop());
  const seconds = Math.max(1, Math.round((Date.now() - done.startedAt) / 1000));
  const blob = new Blob(done.chunks, { type: done.recorder.mimeType || 'audio/webm' });
  const btn = document.getElementById('rec-toggle');
  if (btn) {
    btn.innerHTML = MIC_ICON;
    btn.setAttribute('aria-label', 'Start recording');
  }
  try {
    await clipPut({ id: crypto.randomUUID(), date: done.date, title: done.title, seconds, at: Date.now(), blob });
    say('rec-hint', `Saved (${clock(seconds)}). Listen back once.`);
  } catch {
    say('rec-hint', "Couldn't save that recording: this device may be out of storage.");
  }
  say('rec-clock', '00:00');
  await mountRecorder();
}

function playClip(clip, label) {
  const player = document.getElementById('clip-player');
  const now = document.getElementById('clip-now');
  if (!player || !clip) return;
  if (playingUrl) URL.revokeObjectURL(playingUrl);
  playingUrl = URL.createObjectURL(clip.blob);
  player.src = playingUrl;
  player.hidden = false;
  now.hidden = false;
  now.textContent = label;
  player.play().catch(() => {});
}

function compare() {
  const first = clips[0];
  const latest = clips[clips.length - 1];
  const player = document.getElementById('clip-player');
  queue = [[latest, `Your latest: ${shortDate(latest.date)}`]];
  player.onended = () => {
    const next = queue.shift();
    if (next) playClip(...next);
  };
  playClip(first, `Your first: ${shortDate(first.date)}`);
}

function toggleListening() {
  if (listening) {
    listening.stop();
    return;
  }
  const Api = speechApi();
  const r = new Api();
  r.lang = 'fr-FR';
  r.interimResults = true;
  r.onresult = (ev) => say('heard', [...ev.results].map((x) => x[0].transcript).join(' '));
  r.onerror = (ev) => {
    const why = {
      'not-allowed': "The microphone is blocked. Allow it in the browser's site settings.",
      network: 'The speech check needs internet.',
      'no-speech': "It didn't hear anything. Try again, a little closer.",
    };
    say('heard', why[ev.error] || `The speech check stopped (${ev.error}).`);
  };
  r.onend = () => {
    listening = null;
    say('hear-toggle', 'Say a sentence');
  };
  say('heard', '');
  say('hear-toggle', 'Listening… tap to stop');
  listening = r;
  r.start();
}

/** Clicks on the speaking screen. Returns true if handled. */
export async function speakClick(e) {
  if (e.target.closest('#rec-toggle')) {
    if (rec) stopRecording();
    else await startRecording(document.getElementById('recorder'));
    return true;
  }
  if (e.target.closest('#hear-toggle')) {
    toggleListening();
    return true;
  }
  if (e.target.closest('#clip-compare')) {
    compare();
    return true;
  }
  const play = e.target.closest('[data-clip-play]');
  if (play) {
    const clip = clips.find((c) => c.id === play.dataset.clipPlay);
    const player = document.getElementById('clip-player');
    if (player) player.onended = null;
    queue = [];
    if (clip) playClip(clip, `${shortDate(clip.date)} · ${clip.title}`);
    return true;
  }
  const del = e.target.closest('[data-clip-del]');
  if (del) {
    const { clipDel: id } = del.dataset;
    if (confirmDelete === id) {
      confirmDelete = null;
      await clipDel(id);
    } else confirmDelete = id;
    await mountRecorder();
    return true;
  }
  return false;
}
