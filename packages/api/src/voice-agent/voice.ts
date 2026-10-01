import { answered, boxes, starting, wakingOf, type Baseten } from "../baseten-models";

/**
 * Sona's own voice in a live call (VoxCPM2 fine-tuned on a Malaysian nurse's voice, box ②). withVoice hands it each
 * checked sentence of an answer and sends the MP3 on to the phone, one frame per sentence. When the voice is starting,
 * failing, or slower than 8 s for the first sentence (the patient hears nothing meanwhile), that sentence and the rest of
 * the answer go to `onText` instead and reach the phone with no audio, so Sona Care reads the answer in the phone's own
 * voice, as its turn-by-turn voice mode does; the next answer tries Sona's voice again. Later sentences are made while
 * the one before plays, so they may take twice as long. It has the Agents SDK's TTSProvider shape; the SDK aborts `turn`
 * when the patient interrupts, which cancels the request in flight.
 */
export const VOICE_BUDGET_MS = 8000;

/** Sona's voice for one sentence: MP3 bytes, or none (`waking` minutes while box ② starts). */
export type Spoken = { audio?: Uint8Array; waking?: number };
export type Speak = (text: string, signal: AbortSignal) => Promise<Spoken>;
/** A sentence for the phone's voice, and why: Sona's voice is starting (about `waking` minutes), slow, or unavailable. */
export type PhoneVoice = { text: string; reason: "starting" | "slow" | "unavailable"; waking?: number };

const hungUp = (signal: AbortSignal) => new Promise<Spoken>(resolve => signal.addEventListener("abort", () => resolve({}), { once: true }));

export class SonaVoice {
  /** Per turn (the SDK gives each turn its own signal): the sentences asked so far and, once one falls back, why. */
  readonly #turns = new WeakMap<AbortSignal, { asked: number; fellBack?: Omit<PhoneVoice, "text"> }>();

  constructor(private readonly speak: Speak, private readonly onText: (said: PhoneVoice, turn?: AbortSignal) => void, private readonly budgetMs = VOICE_BUDGET_MS) {}

  async synthesize(text: string, turn?: AbortSignal): Promise<ArrayBuffer | null> {
    if (turn?.aborted) return null;
    const state = turn ? this.#turns.get(turn) ?? { asked: 0 } : { asked: 0 };
    if (turn) this.#turns.set(turn, state);
    let why = state.fellBack;
    if (!why) {
      const budget = AbortSignal.timeout(state.asked++ ? 2 * this.budgetMs : this.budgetMs), signal = turn ? AbortSignal.any([turn, budget]) : budget;
      // The race keeps the budget even if a slow box ignores the abort.
      const said = await Promise.race([this.speak(text, signal).catch((): Spoken => ({})), hungUp(signal)]);
      if (turn?.aborted) return null; // interrupted: nothing to play or read
      if (said.audio?.length) return said.audio.slice().buffer as ArrayBuffer;
      why = state.fellBack = said.waking ? { reason: "starting", waking: said.waking } : { reason: budget.aborted ? "slow" : "unavailable" };
    }
    this.onText({ text, ...why }, turn);
    return null;
  }
}

/**
 * On picking up a call: the boxes a call needs (② hears and speaks, ① answers) that are still starting, with their
 * minutes. A cold one is woken now, so it is warming while the patient says their first sentence.
 */
export async function startingBoxes(options: Baseten): Promise<{ voice?: number; brain?: number }> {
  const { up, wake } = boxes(options);
  const minutes = await Promise.all((["voice", "brain"] as const).map(async box => {
    if (await up(box)) return undefined;
    starting(box);
    await wake(box);
    return wakingOf(box).waking;
  }));
  return { voice: minutes[0], brain: minutes[1] };
}

/** Box ②'s /v1/tts as `Speak`: a cold box is woken and not waited for, so the phone reads while it starts. */
export function basetenSpeak(options: Baseten): Speak {
  const { send } = boxes(options);
  return async (text, signal) => {
    try {
      const res = await send("voice", "/v1/tts", JSON.stringify({ text }), "application/json", 30_000, signal);
      const audio = new Uint8Array(await res.arrayBuffer());
      answered("voice");
      return audio.length > 44 ? { audio } : {};
    } catch {
      return wakingOf("voice");
    }
  };
}
