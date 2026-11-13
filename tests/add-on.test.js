// Runs against Luna.MockEngine: no LUNA needed. `npm test`.
import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';

globalThis.Luna = Luna; // logic.js is a classic script that reads the Luna global
await import('../logic.js');
const logic = globalThis.AddOnLogic;

async function connected() {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { name: 'Demo', tracks: ['Vocal'] });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  return { engine, luna, session, t: session.transport };
}

describe('Transport Remote', () => {
  it('formats the transport location', async () => {
    const { engine, session } = await connected();
    expect(logic.locationText(session)).toBe('1|1|000');
    engine.setValue('/sessions/abc', 'location', { tick: Luna.TICKS_PER_BEAT * 5, bar_beat: { bar: 2, beat: 2, tick: 0 } });
    await engine.settled();
    expect(logic.locationText(session)).toBe('2|2|000');
  });

  it('toggles play and stop', async () => {
    const { engine, t } = await connected();
    await logic.toggle(t);
    await engine.settled();
    expect(logic.state(t).playing).toBe(true);
    await logic.stop(t);
    await engine.settled();
    expect(logic.state(t).playing).toBe(false);
  });

  it('toggles loop', async () => {
    const { engine, t } = await connected();
    await logic.toggleLoop(t);
    await engine.settled();
    expect(logic.state(t).looping).toBe(true);
  });

  it('toggles record', async () => {
    const { engine, t } = await connected();
    await logic.toggleRecord(t);
    await engine.settled();
    expect(logic.state(t).recording).toBe(true);
  });

  it('sets start, stop and length from typed bar|beat|tick', async () => {
    const { engine, session, t } = await connected();
    await logic.setStart(session, '2|1|0');
    await logic.setStop(session, '6|1|0');
    await engine.settled();
    expect(logic.startText(session)).toBe('2|1|000');
    expect(logic.stopText(session)).toBe('6|1|000');
    expect(logic.lengthText(session)).toBe('4|0|000');
    // the timeline selection follows the loop region
    expect(session.context.selectionStart.value).toBe(session.transport.loopStart.value);
    expect(session.context.selectionStop.value).toBe(session.transport.loopStop.value);
    await logic.setLength(session, '2|2|0');
    await engine.settled();
    expect(logic.stopText(session)).toBe('4|3|000');
    expect(await logic.setLength(session, 'abc')).toBe(false);
  });

  it('shows positions as min:sec and samples, and parses them back', async () => {
    const { engine, session } = await connected();
    // bar 3 at 120 BPM in 4/4 is 4 s in
    await logic.setStart(session, '3|1|0');
    await logic.setStop(session, '5|1|0');
    await engine.settled();
    const tempo = session.transport.tempo.value ?? 120;
    const secs = Luna.formatMinSec(session.musical.timeline.seconds(session.transport.loopStart.value), { fraction: 3 });
    expect(logic.startText(session, 'time')).toBe(secs);
    const samples = Math.round(session.musical.timeline.seconds(session.transport.loopStart.value) * 44100);
    expect(logic.startText(session, 'samples', 44100)).toBe(String(samples));
    expect(tempo).toBeGreaterThan(0);
    // typing a time sets the start; the same time reads back
    await logic.setStart(session, '0:04.000', 'time');
    await engine.settled();
    expect(logic.startText(session, 'time')).toBe('00:04.000');
    await logic.setLength(session, '2.5', 'time');
    await engine.settled();
    expect(logic.lengthText(session, 'time')).toBe('00:02.500');
    await logic.setStop(session, '441000', 'samples', 44100); // 10 s
    await engine.settled();
    expect(logic.stopText(session, 'time')).toBe('00:10.000');
    expect(logic.parse('abc', 'time')).toBeUndefined();
    expect(logic.parse('12.5', 'samples')).toBeUndefined();
    expect(await logic.setStart(session, 'x', 'samples')).toBe(false);
  });

  it("runs LUNA's standard shortcuts on the focused session", async () => {
    const { engine, luna } = await connected();
    const shortcuts = new Luna.Shortcuts(luna);
    await shortcuts.run('togglePlayback');
    await engine.settled();
    expect(engine.value('/sessions/abc', 'playing')).toBe(true);
  });
});
