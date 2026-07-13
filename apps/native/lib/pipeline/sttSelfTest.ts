import { Asset } from "expo-asset";
import { File } from "expo-file-system";

import { getSttAccuracy } from "./sttMode";
import { transcribeWaveform, whisperModelFor } from "./whisperStt";

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
    const t0 = Date.now();
    const tr = await transcribeWaveform(wave, { model: whisperModelFor(getSttAccuracy()), language: "auto" });
    console.log(
      `[STT-SELFTEST] done in ${Date.now() - t0}ms · lang=${tr.language} · chars=${tr.text.length}`,
    );
    console.log(`[STT-SELFTEST] raw: ${JSON.stringify((tr.raw ?? "").slice(0, 200))}`);
    console.log(`[STT-SELFTEST] text: ${JSON.stringify(tr.text.slice(0, 200))}`);
  } catch (e) {
    console.log(`[STT-SELFTEST] ERROR: ${String(e)}`);
  }
}
