// Transport Remote: DOM wiring. Connects to LUNA, follows the focused
// session, and renders what logic.js computes. Every listener returned by onChange is kept
// so it can be released when the session changes.

const $ = (id) => document.getElementById(id);
let luna;
let session;
let releases = [];
let mode = 'bars';
let repaint = () => {};
let rate = 48000;
const KEY = 'com.example.transport_remote.counter_mode';
try { const m = localStorage.getItem(KEY); if (AddOnLogic.MODES.includes(m)) mode = m; } catch {}

const keep = (u) => releases.push(u);
const release = () => {
  for (const u of releases) u();
  releases = [];
};

async function bindSession() {
  release();
  session = luna.sessions.current();
  if (!session) {
    $('status').textContent = 'no session open';
    return;
  }
  await session.ready();
  $('status').textContent = session.name.value ?? session.uid;

  const t = session.transport;
  const paint = () => {
    const s = AddOnLogic.state(t);
    $('location').textContent = AddOnLogic.locationText(session, mode, rate);
    $('tempo').textContent = AddOnLogic.tempoText(t);
    $('play').classList.toggle('on', s.playing);
    $('record').classList.toggle('on', s.recording);
    $('loop').classList.toggle('on', s.looping);
    for (const [id, text] of [['start', AddOnLogic.startText(session, mode, rate)], ['stop', AddOnLogic.stopText(session, mode, rate)], ['length', AddOnLogic.lengthText(session, mode, rate)]]) {
      if (document.activeElement !== $(id)) $(id).value = text;
    }
    for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('on', b.dataset.mode === mode);
  };
  repaint = paint;
  paint();
  for (const p of [t.location, t.playing, t.recordEnabled, t.looping, t.loopStart, t.loopStop]) keep(p.onChange(paint));
  $('play').onclick = () => AddOnLogic.toggle(t);
  $('record').onclick = () => AddOnLogic.toggleRecord(t);
  $('loop').onclick = () => AddOnLogic.toggleLoop(t);
  // Start / Stop / Length: type a bar|beat|tick and press Enter; Escape or a bad entry reverts.
  const field = (id, apply) => {
    const el = $(id);
    el.onkeydown = async (e) => {
      if (e.key === 'Escape') { el.blur(); paint(); }
      else if (e.key === 'Enter') { await apply(session, el.value, mode, rate); el.blur(); paint(); }
      e.stopPropagation(); // typing must not trigger LUNA's transport shortcuts
    };
    el.onblur = paint;
    el.onfocus = () => el.select();
  };
  field('start', AddOnLogic.setStart);
  field('stop', AddOnLogic.setStop);
  field('length', AddOnLogic.setLength);
  $('rewind').onclick = () => AddOnLogic.rewind(t);
}

function wireModes() {
  for (const b of document.querySelectorAll('#modes button')) {
    b.onclick = () => {
      mode = b.dataset.mode;
      try { localStorage.setItem(KEY, mode); } catch {}
      repaint();
    };
  }
}

async function readSampleRate() {
  try {
    const r = await luna.raw.get('/');
    const v = r?.properties?.sample_rate?.value;
    if (typeof v === 'number' && v > 0) rate = v;
  } catch {}
}

async function connect() {
  for (;;) {
    try {
      // Inside LUNA the page URL carries ?port=; in a browser this falls back to LUNA on
      // localhost.
      luna = await Luna.connect();
      break;
    } catch (e) {
      $('status').textContent = e instanceof Luna.NotRunning ? 'waiting for LUNA...' : e.message;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  // LUNA's standard undo, redo, play and record keys, for any key this page does not handle.
  // To take a key over, handle it here and call preventDefault(); to change one, pass
  // { bindings }. They act on the focused session, so there is nothing to rebind.
  Luna.bindShortcuts(luna);
  wireModes();
  await readSampleRate();
  await luna.sessions.ready();
  luna.sessions.focused.onChange(bindSession);
  luna.sessions.items.onChange(bindSession);
  luna.status.onChange(() => {
    if (luna.status.value === 'disconnected') $('status').textContent = 'reconnecting...';
  });
  await bindSession();
}

connect();
