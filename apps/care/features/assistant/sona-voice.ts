import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { client } from "@/utils/orpc";
import { partsOf, wordEnd } from "./voices";

/**
 * Sona's own voice (care.speak: VoxCPM2 fine-tuned on a Malaysian nurse's voice, docs/tts-training.md). An
 * answer is read part by part (see partsOf), the next part made on the server while this one plays. Each part
 * is kept in the phone's cache, so an answer heard once replays at once. The voice takes longer to make than
 * to hear (1.3–1.7× on box ②'s L4, compiled; 2.0–2.8× before, measured 1 Oct), so a long answer pauses between parts. When the voice is
 * asleep, slow to start or fails, `fallback` hands the rest of the answer back for the phone's voice to read;
 * when it was only slow, the rest is still made in the background, so asking again plays it in Sona's voice.
 */
// A first part not ready by then goes to the phone's voice, so the patient isn't left waiting in silence.
// ponytail: a first sentence takes 5–7 s to make on the L4 (8–11 s before it was compiled); a faster GPU lifts this.
export const FIRST_MS = 8000;
// Bump when the voice model changes, so a part made by an older voice is never played for the new one.
const VERSION = "sona-voxcpm2-malaysian-r4-anchored";

type Said = { uri?: string; waking?: number; slow?: true };
export type SonaVoiceEvents = { start(): void; upto(index: number): void; done(): void; fallback(from: number, waking?: number): void };

/** The part as audio in the phone's cache, made by Sona's voice the first time; no file while the voice is unavailable. */
async function recording(text: string): Promise<Said> {
  const name = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${VERSION}\n${text}`);
  // The box sends MP3 (WAV before 1 Oct); the player goes by the file's extension, so it names what was sent.
  const [mp3, wav] = ["mp3", "wav"].map(ext => new File(Paths.cache, `sona-voice-${name}.${ext}`));
  const cached = [mp3!, wav!].find(f => f.exists);
  if (cached) return { uri: cached.uri };
  const said = await client.care.speak({ text });
  if (said.source !== "model") return { waking: said.waking };
  const file = said.audio.startsWith("UklGR") ? wav! : mp3!; // "RIFF", base64
  file.write(said.audio, { encoding: "base64" });
  return { uri: file.uri };
}

/** Plays one recording to its end (or until `playing.stop`), telling `at` the share played so far. */
function play(uri: string, at: (share: number) => void, playing: { stop?: () => void }) {
  return new Promise<void>(resolve => {
    const player = createAudioPlayer({ uri }, { updateInterval: 100 });
    const end = () => { sub.remove(); player.remove(); playing.stop = undefined; resolve(); };
    const sub = player.addListener("playbackStatusUpdate", s => {
      if (s.duration > 0) at(Math.min(1, s.currentTime / s.duration));
      if (s.didJustFinish) end();
    });
    playing.stop = end;
    player.play();
  });
}

/**
 * Reads `text` in Sona's voice; returns stop. The words light up by each part's share played (an estimate: no
 * word timings). `firstMs`: how long the first part may take before the phone reads instead (none: wait for it).
 */
export function sayInSonaVoice(text: string, on: SonaVoiceEvents, firstMs?: number) {
  let stopped = false;
  const playing: { stop?: () => void } = {};
  const parts = partsOf(text);
  const make = (i: number) => recording(text.slice(parts[i]!.start, parts[i]!.end)).catch((): Said => ({}));
  void (async () => {
    if (!parts.length) return on.done();
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    let next = make(0);
    for (const [i, part] of parts.entries()) {
      const said = await (i === 0 && firstMs ? Promise.race([next, new Promise<Said>(r => setTimeout(() => r({ slow: true }), firstMs))]) : next);
      if (stopped) return;
      if (!said.uri) {
        // One part at a time (the voice box reads one request at a time anyway), and none once the patient moves
        // on, so making these never holds up their next answer.
        if (said.slow) void parts.slice(i + 1).reduce((made, _, j) => made.then(() => stopped ? {} : make(i + 1 + j)), next);
        return on.fallback(part.start, said.waking);
      }
      if (i + 1 < parts.length) next = make(i + 1);
      if (i === 0) on.start();
      await play(said.uri, share => on.upto(wordEnd(text, part.start + Math.round((part.end - part.start) * share), part.end)), playing);
      if (stopped) return;
    }
    on.done();
  })();
  return () => { stopped = true; playing.stop?.(); };
}
