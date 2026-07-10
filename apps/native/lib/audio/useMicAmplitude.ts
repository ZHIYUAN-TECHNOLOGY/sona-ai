import { AudioManager, AudioRecorder } from "react-native-audio-api";
import { useEffect, useState } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

import { normalizeAmp, rms } from "./waveform";

// Points across the waveform curve (also the amplitude ring size).
export const WAVE_POINTS = 40;
// 512 samples/channel @ 16 kHz ≈ 32 ms → ~31 amplitude updates/sec (lively, cheap).
const SAMPLE_RATE = 16000;
const BUFFER_LENGTH = 512;

export interface MicAmplitude {
  /** Rolling amplitudes (0..1), newest at the end. Read on the UI thread by the curve. */
  amplitudes: SharedValue<number[]>;
  /** True once real mic audio is driving `amplitudes`; false → caller shows a fallback. */
  active: boolean;
}

/**
 * Live microphone amplitude for the record-screen waveform, via
 * react-native-audio-api's standalone AudioRecorder.onAudioReady (no audio graph, no
 * file output). Each PCM buffer is reduced to one RMS value and pushed into a
 * Reanimated shared value — so the SVG curve animates on the UI thread with no React
 * re-render per frame.
 *
 * MOAT: enableFileOutput() and connect() are NEVER called, so audio is never written
 * to disk and never routed anywhere — each Float32 buffer is read for loudness and
 * immediately discarded. Nothing persists or transmits.
 *
 * Degrades gracefully: if permission is denied, the session can't activate, or the
 * native module is unavailable (Expo Go / no mic), `active` stays false and the caller
 * falls back to the decorative animation — the demo never shows a dead box.
 */
export function useMicAmplitude(enabled: boolean): MicAmplitude {
  const amplitudes = useSharedValue<number[]>(new Array(WAVE_POINTS).fill(0));
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let recorder: AudioRecorder | null = null;
    let cancelled = false;

    const push = (amp: number) => {
      // New array ref (drops oldest, appends newest) so useAnimatedProps recomputes.
      const next = amplitudes.value.slice(1);
      next.push(amp);
      amplitudes.value = next;
    };

    void (async () => {
      try {
        // 1) Permission (throws on iOS if Info.plist lacks NSMicrophoneUsageDescription).
        const status = await AudioManager.requestRecordingPermissions();
        if (cancelled || status !== "Granted") return;

        // 2) iOS audio session (no-op on Android). 0.13.1: activity REJECTS on failure.
        AudioManager.setAudioSessionOptions({ iosCategory: "record", iosMode: "default", iosOptions: [] });
        try {
          await AudioManager.setAudioSessionActivity(true);
        } catch {
          return;
        }
        if (cancelled) return;

        // 3) Standalone recorder + amplitude callback (all three options required).
        recorder = new AudioRecorder();
        recorder.onAudioReady(
          { sampleRate: SAMPLE_RATE, bufferLength: BUFFER_LENGTH, channelCount: 1 },
          ({ buffer, numFrames }) => {
            // subarray(0, numFrames) is a zero-copy view — device may deliver a
            // different chunk size than requested, so numFrames is authoritative.
            push(normalizeAmp(rms(buffer.getChannelData(0).subarray(0, numFrames))));
          },
        );
        recorder.onError(() => {});

        // 4) start() is async in 0.13.1 — await + check the Result.
        const res = await recorder.start();
        if (cancelled || res.status === "error") return;
        setActive(true);
      } catch {
        // Native module / API unavailable → stay inactive, caller falls back.
      }
    })();

    return () => {
      cancelled = true;
      setActive(false);
      if (recorder) {
        recorder.clearOnAudioReady();
        recorder.clearOnError();
        recorder.stop().catch(() => {});
      }
      AudioManager.setAudioSessionActivity(false).catch(() => {});
    };
  }, [enabled, amplitudes]);

  return { amplitudes, active };
}
