/**
 * Talking over Sona, and keeping her from hearing herself. While she is audible (and for TAIL_MS after, while the room
 * still rings) the agent hears silence in place of the mic: react-native-audio-api 0.13 has no switch for iOS echo
 * cancellation, so her own voice coming back through the mic would reach the agent's speech recognition as the patient.
 * Meanwhile the mic is watched: louder than her echo for INTERRUPT_MS is the patient talking, so the gate opens
 * (`interrupt`: the caller stops her if she still has something to say) and the agent gets their words from just before
 * they started. Pure, so bun can test it.
 */
// Tuning, on the phone: INTERRUPT_RMS is the quietest speech that can stop her (VoiceClient's interruptThreshold) and
// INTERRUPT_MS how long it must last (its interruptChunks, 2 × 100 ms). Her echo raises that bar: it follows the loudest
// recent echo (fading by ECHO_DECAY every 100 ms) times ECHO_MARGIN, learnt over her first WARM_MS, when nothing stops her.
// HOLD_MS of silenced mic is kept, so the start of the patient's words isn't lost. SILENCE_RMS and SILENCE_MS mark where
// speech starts and ends in what the agent hears, as VoiceClient does.
// ponytail: a peak follower, not echo cancellation. On the speaker her echo is loud, so stopping her by voice takes a
// raised voice there (tapping the orb always works); on headphones the bar is INTERRUPT_RMS. iOS voice processing
// (react-native-audio-api 1.0's iosVoiceProcessing, nightly today) would take the echo out on the speaker too.
export const INTERRUPT_RMS = 0.05, INTERRUPT_MS = 200, ECHO_MARGIN = 1.6, ECHO_DECAY = 0.97, WARM_MS = 300, TAIL_MS = 800, HOLD_MS = 500;
export const SILENCE_RMS = 0.04, SILENCE_MS = 500;

export type Frame = { pcm: ArrayBuffer; rms: number; ms: number };
/** `tail`: ms the gate stays shut after her; `warm`: ms she has been audible; `echo`: her echo's recent peak; `loud`: ms over the bar. */
export type Gate = { tail: number; warm: number; echo: number; loud: number; held: Frame[]; speech: boolean; quiet: number };
export const gate = (): Gate => ({ tail: 0, warm: 0, echo: 0, loud: 0, held: [], speech: false, quiet: 0 });
export type Step = { gate: Gate; send: ArrayBuffer[]; interrupt: boolean; mark?: "start_of_speech" | "end_of_speech" };

/** One mic frame through the gate. `talking`: Sona is audible (her voice, or the phone's reading in her place). */
export function step(g: Gate, f: Frame, talking: boolean): Step {
  const open = { ...gate(), speech: g.speech, quiet: g.quiet };
  if (!talking && g.tail <= 0) return marked(open, [f.pcm], f.rms, f.ms, false);
  const loud = f.rms > Math.max(INTERRUPT_RMS, g.echo * ECHO_MARGIN) && (!talking || g.warm >= WARM_MS) ? g.loud + f.ms : 0;
  const held = [...g.held, f];
  while (held.reduce((ms, h) => ms + h.ms, 0) > HOLD_MS) held.shift();
  if (loud >= INTERRUPT_MS) return marked(open, held.map(h => h.pcm), f.rms, f.ms, true);
  const tail = talking ? TAIL_MS : g.tail - f.ms;
  // The room has settled while the patient is already speaking: they get the held start of their words.
  if (tail <= 0 && f.rms > INTERRUPT_RMS) return marked(open, held.map(h => h.pcm), f.rms, f.ms, false);
  const fade = ECHO_DECAY ** (f.ms / 100);
  const echo = talking && !loud ? Math.max(g.echo * fade, f.rms) : g.echo * fade;
  return marked({ ...g, tail, warm: talking ? g.warm + f.ms : g.warm, echo, loud, held }, [new ArrayBuffer(f.pcm.byteLength)], 0, f.ms, false);
}

/** Marks where speech starts and ends in what the agent hears (VoiceClient's start_of_speech and end_of_speech). */
function marked(g: Gate, send: ArrayBuffer[], level: number, ms: number, interrupt: boolean): Step {
  if (level > SILENCE_RMS) return g.speech ? { gate: { ...g, quiet: 0 }, send, interrupt } : { gate: { ...g, speech: true, quiet: 0 }, send, interrupt, mark: "start_of_speech" };
  if (!g.speech) return { gate: g, send, interrupt };
  const quiet = g.quiet + ms;
  return quiet >= SILENCE_MS ? { gate: { ...g, speech: false, quiet: 0 }, send, interrupt, mark: "end_of_speech" } : { gate: { ...g, quiet }, send, interrupt };
}
