import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";
import { AudioManager } from "react-native-audio-api";

import { getSttAccuracy } from "./sttMode";
import { transcribeWaveform, unloadWhisper, whisperModelFor } from "./whisperStt";

// DEV-ONLY STT self-test. Transcribes a BUNDLED known-good speech clip (JFK, 16 kHz mono
// 16-bit WAV) through the exact same engine path the consult uses — no microphone involved.
// Splits the fault domain in one shot:
//   - self-test produces real text  → engine + model file GOOD → the bug is in mic capture.
//   - self-test produces garbage    → engine/model-file on the device is the bug.
// Results go to console.log → visible in the Metro terminal. Runs only in __DEV__ builds.

/** Parse a 16-bit PCM mono WAV into float32 [-1,1]. Walks chunks to find "data". */
function wavToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44) throw new Error("wav too short");
  let off = 12; // past RIFF....WAVE
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = view.getUint32(off + 4, true);
    if (id === "data") {
      dataOff = off + 8;
      dataLen = size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error("wav data chunk not found");
  const n = Math.floor(Math.min(dataLen, bytes.length - dataOff) / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(dataOff + i * 2, true) / 32768;
  return out;
}

let ran = false;

/** Run once per app launch (dev only). Logs [STT-SELFTEST] lines to Metro. */
export async function runSttSelfTest(): Promise<void> {
  if (ran) return;
  ran = true;
  try {
    console.log("[STT-SELFTEST] start — loading bundled clip");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = Asset.fromModule(require("../../assets/audio/stt-selftest.wav"));
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error("no localUri for self-test wav");
    const buf = await new File(asset.localUri).arrayBuffer();
    const wave = wavToFloat32(new Uint8Array(buf));
    console.log(`[STT-SELFTEST] clip: ${Math.round((wave.length / 16000) * 10) / 10}s, ${wave.length} samples`);
    const model = whisperModelFor(getSttAccuracy());
    const run = async (label: string) => {
      const t0 = Date.now();
      const tr = await transcribeWaveform(wave, { model, language: "auto" });
      console.log(
        `[STT-SELFTEST] ${label}: ${Date.now() - t0}ms · chars=${tr.text.length} · raw=${JSON.stringify((tr.raw ?? "").slice(0, 80))}`,
      );
      return tr.text.length;
    };
    // The consult always transcribes on a REUSED context (the launch self-test used it first).
    // Run twice on the same context to test the reuse path, then once after a fresh re-init.
    await run("run1 (fresh ctx)");
    await run("run2 (reused ctx)");
    await unloadWhisper();
    await run("run3 (re-init ctx)");

    // run4 — the USER'S OWN last consult recording (saved by the capture rig). The Mac
    // transcribes these exact bytes fine; if the device does too (outside the consult flow),
    // the content is innocent and the consult-moment ENVIRONMENT is the bug.
    const userWav = new File(Paths.document, "last-capture.wav");
    if (userWav.exists) {
      const b = new Uint8Array(await userWav.arrayBuffer());
      const w2 = wavToFloat32(b);
      console.log(`[STT-SELFTEST] user clip: ${Math.round((w2.length / 16000) * 10) / 10}s`);
      const t0 = Date.now();
      const tr = await transcribeWaveform(w2, { model, language: "auto" });
      console.log(
        `[STT-SELFTEST] run4 (user audio): ${Date.now() - t0}ms · chars=${tr.text.length} · raw=${JSON.stringify((tr.raw ?? "").slice(0, 120))}`,
      );
    } else {
      console.log("[STT-SELFTEST] run4 skipped — no last-capture.wav yet");
    }

    // run5 — replicate the consult's audio-session dance (mic session activated then
    // deactivated) before transcribing the KNOWN-GOOD clip. Garbage here → the audio session
    // interaction is the bug.
    try {
      AudioManager.setAudioSessionOptions({ iosCategory: "record", iosMode: "default", iosOptions: [] });
      await AudioManager.setAudioSessionActivity(true);
      await AudioManager.setAudioSessionActivity(false);
    } catch (e) {
      console.log(`[STT-SELFTEST] session dance failed: ${String(e)}`);
    }
    await run("run5 (after mic session)");
  } catch (e) {
    console.log(`[STT-SELFTEST] ERROR: ${String(e)}`);
  }
}
