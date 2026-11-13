// Transport Remote: logic that does not touch the DOM, so tests can exercise it against Luna.MockEngine.
//
// Everything here takes SDK objects (a Luna.Session's Transport) and returns plain data or
// performs an engine action. main.js turns the data into DOM.

const AddOnLogic = {
  /** Display modes, in the order the switch shows them. */
  MODES: ['bars', 'time', 'samples'],
  EMPTY: { bars: '-|-|---', time: '--:--.---', samples: '-' },

  /** Ticks in one displayed bar|beat|tick "tick" (LUNA shows 960 per quarter note). */
  displayTick: Luna.TICKS_PER_BEAT / 960,

  /** The session's tempo map (bar|beat and seconds conversion that honour tempo and meter changes). */
  timeline: (session) => session.musical.timeline,

  /** Tempo and meter text, e.g. "120.0 BPM  4/4". */
  tempoText(transport) {
    const bpm = transport.tempo.value;
    const tempo = typeof bpm === 'number' ? `${bpm.toFixed(1)} BPM` : '--- BPM';
    return `${tempo}  ${Luna.formatTimeSignature(transport.timeSignature.value)}`;
  },

  /** Plain snapshot of the buttons' state. */
  state(transport) {
    return {
      playing: transport.playing.value === true,
      recording: transport.recordEnabled.value === true,
      looping: transport.looping.value === true,
    };
  },

  /** A position (ticks) as text in the given mode. `rate` is the engine sample rate. */
  format(session, tick, mode, rate = 48000) {
    if (tick === undefined) return AddOnLogic.EMPTY[mode];
    const tl = AddOnLogic.timeline(session);
    if (mode === 'time') return Luna.formatMinSec(tl.seconds(tick), { fraction: 3 });
    if (mode === 'samples') return String(Math.round(tl.seconds(tick) * rate));
    return tl.formatBarBeat(tick);
  },

  /** The playhead as text in the given mode. */
  locationText(session, mode = 'bars', rate = 48000) {
    const t = session.transport;
    if (mode === 'bars') return Luna.formatBarBeat(t.location.value?.bar_beat);
    return AddOnLogic.format(session, t.tick, mode, rate);
  },

  startText: (session, mode = 'bars', rate) => AddOnLogic.format(session, session.transport.loopStart.value, mode, rate),
  stopText: (session, mode = 'bars', rate) => AddOnLogic.format(session, session.transport.loopStop.value, mode, rate),

  /** Ticks per beat and beats per bar for the meter at the playhead. */
  meter(transport) {
    const ts = transport.timeSignature.value ?? { numerator: 4, denominator: 4 };
    return { beatTicks: (Luna.TICKS_PER_BEAT * 4) / ts.denominator, beatsPerBar: ts.numerator };
  },

  /** Length of the region: bars|beats|ticks (zero-based), or the elapsed time / samples. */
  lengthText(session, mode = 'bars', rate = 48000) {
    const t = session.transport;
    const a = t.loopStart.value;
    const b = t.loopStop.value;
    if (a === undefined || b === undefined) return AddOnLogic.EMPTY[mode];
    if (mode !== 'bars') {
      const tl = AddOnLogic.timeline(session);
      const secs = Math.max(0, tl.seconds(b) - tl.seconds(a));
      return mode === 'time' ? Luna.formatMinSec(secs, { fraction: 3 }) : String(Math.round(secs * rate));
    }
    const { beatTicks, beatsPerBar } = AddOnLogic.meter(t);
    let rest = Math.max(0, b - a);
    const bars = Math.floor(rest / (beatTicks * beatsPerBar));
    rest -= bars * beatTicks * beatsPerBar;
    const beats = Math.floor(rest / beatTicks);
    rest -= beats * beatTicks;
    const ticks = Math.floor(rest / AddOnLogic.displayTick);
    return `${bars}|${beats}|${String(ticks).padStart(3, '0')}`;
  },

  /**
   * Typed text -> a position in seconds (time/samples) or { a, b, c } (bars). Undefined when
   * it does not parse. Time accepts "1:23.456", "83.5" and "1:02:03.5"; samples a whole number.
   */
  parse(text, mode = 'bars', rate = 48000) {
    const s = String(text ?? '').trim();
    if (mode === 'samples') return /^\d+$/.test(s) ? { seconds: Number(s) / rate } : undefined;
    if (mode === 'time') {
      if (!/^\d+(:\d+){0,2}(\.\d+)?$/.test(s)) return undefined;
      return { seconds: s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0) };
    }
    const m = /^(\d+)(?:\s*\|\s*(\d+))?(?:\s*\|\s*(\d+))?$/.exec(s);
    return m ? { a: +m[1], b: +(m[2] ?? 0), c: +(m[3] ?? 0) } : undefined;
  },

  /** A parsed position as a tick. */
  tickFor(session, p) {
    const tl = AddOnLogic.timeline(session);
    if (p.seconds !== undefined) return tl.tickAtSeconds(p.seconds);
    return tl.tickAt({ bar: p.a, beat: p.b || 1, tick: p.c * AddOnLogic.displayTick });
  },

  /** Write a region to LUNA: the loop start/stop and the timeline selection, together. */
  async setRegion(session, start, stop) {
    await Promise.all([session.transport.setLoop(start, stop), session.context.select({ startTick: start, stopTick: stop })]);
  },

  /** Typed start. Keeps the stop unless the start would pass it. */
  async setStart(session, text, mode = 'bars', rate) {
    const p = AddOnLogic.parse(text, mode, rate);
    if (!p) return false;
    const t = session.transport;
    const tick = AddOnLogic.tickFor(session, p);
    await AddOnLogic.setRegion(session, tick, Math.max(tick, t.loopStop.value ?? tick));
    return true;
  },

  /** Typed stop. Pulls the start back if the stop would pass it. */
  async setStop(session, text, mode = 'bars', rate) {
    const p = AddOnLogic.parse(text, mode, rate);
    if (!p) return false;
    const t = session.transport;
    const tick = AddOnLogic.tickFor(session, p);
    await AddOnLogic.setRegion(session, Math.min(tick, t.loopStart.value ?? tick), tick);
    return true;
  },

  /** Typed length: moves the stop, keeps the start. */
  async setLength(session, text, mode = 'bars', rate) {
    const p = AddOnLogic.parse(text, mode, rate);
    if (!p) return false;
    const t = session.transport;
    const start = t.loopStart.value ?? 0;
    let stop;
    if (p.seconds !== undefined) {
      const tl = AddOnLogic.timeline(session);
      stop = tl.tickAtSeconds(tl.seconds(start) + p.seconds);
    } else {
      const { beatTicks, beatsPerBar } = AddOnLogic.meter(t);
      stop = start + (p.a * beatsPerBar + p.b) * beatTicks + p.c * AddOnLogic.displayTick;
    }
    await AddOnLogic.setRegion(session, start, stop);
    return true;
  },

  /** Play when stopped, stop when playing. */
  toggle: (transport) => transport.toggle(),
  stop: (transport) => transport.stop(),
  toggleRecord: (transport) => transport.toggleRecord(),
  toggleLoop: (transport) => transport.looping.set(transport.looping.value !== true),
  /** Jump to the arrangement start. */
  rewind: (transport) => transport.returnToZero(),
};

globalThis.AddOnLogic = AddOnLogic;
