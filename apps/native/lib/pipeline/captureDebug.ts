import { AudioContext, AudioManager } from "react-native-audio-api";
import { File, Paths } from "expo-file-system";

// Capture-debugging rig. Whisper decodes bundled file audio perfectly on this device, but the
// MIC waveform produces "<|0.0|><|0.5|>" (energy, no speech structure) — so the waveform itself
// is the suspect. This makes the captured audio a first-class artifact:
//   - saveLastCaptureWav(): writes the exact PCM fed to whisper as Documents/last-capture.wav
//     (sandbox-only, overwritten each consult, DEV debugging — remove before release). It can be
//     pulled off the device (devicectl) and inspected on a Mac: listened to, spectrogrammed, and
//     run through whisper-cli. Ground truth in one artifact.
//   - playLastCapture(): plays the same PCM in-app so a human can HEAR what the recorder
//     delivered (garbled = capture bug; clear speech = engine-input bug).

const RATE = 16000;

let lastWave: Float32Array | null = null;

export function setLastCapture(w: Float32Array): void {
  lastWave = w;
}

export function hasLastCapture(): boolean {
  return !!lastWave && lastWave.length > 0;
}

/** Encode float32 [-1,1] mono PCM as a 16-bit WAV. */
export function floatToWavBytes(w: Float32Array, rate = RATE): Uint8Array {
  const n = w.length;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits
  ascii(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = w[i] < -1 ? -1 : w[i] > 1 ? 1 : w[i];
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Persist the last capture as Documents/last-capture.wav (debug artifact). Returns the uri. */
export function saveLastCaptureWav(w: Float32Array): string | null {
  try {
    const f = new File(Paths.document, "last-capture.wav");
    f.write(floatToWavBytes(w));
    console.log(`[CAPTURE] saved ${Math.round((w.length / RATE) * 10) / 10}s wav → ${f.uri}`);
    return f.uri;
  } catch (e) {
    console.log(`[CAPTURE] wav save failed: ${String(e)}`);
    return null;
  }
}

/** Play the last captured waveform aloud (debug). Returns false if none / playback failed. */
export function playLastCapture(onEnded?: () => void): boolean {
  const w = lastWave;
  if (!w || w.length === 0) return false;
  try {
    // Mic left the session in "record" (routes no output) — force playback first.
    AudioManager.setAudioSessionOptions({ iosCategory: "playback", iosMode: "default", iosOptions: [] });
    void AudioManager.setAudioSessionActivity(true).catch(() => {});
    const ctx = new AudioContext({ sampleRate: RATE });
    const buf = ctx.createBuffer(1, w.length, RATE);
    buf.copyToChannel(new Float32Array(w) as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onEnded = () => {
      onEnded?.();
      void ctx.close().catch(() => {});
    };
    src.start();
    return true;
  } catch (e) {
    console.log(`[CAPTURE] play failed: ${String(e)}`);
    return false;
  }
}
