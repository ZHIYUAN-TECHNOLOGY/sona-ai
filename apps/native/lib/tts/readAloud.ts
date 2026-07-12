import * as Speech from "expo-speech";

// On-device text-to-speech via expo-speech (the OS speech synthesizer — AVSpeechSynthesizer
// on iOS, TextToSpeech on Android). Fully on-device + multilingual (incl. Malay), no model
// download, no cloud — fits the moat. Guarded: every call swallows errors so a build without
// the native module (or a device with no voices) simply does nothing.

export interface ReadOptions {
  /** BCP-47 language for voice selection (e.g. "en-US", "ms-MY"). */
  language?: string;
  /** Fires when speech finishes naturally. */
  onDone?: () => void;
  /** Fires when speech is stopped or errors. */
  onStopped?: () => void;
}

/** Speak text aloud on-device. Stops any current utterance first. */
export function readAloud(text: string, opts: ReadOptions = {}): void {
  const done = opts.onStopped ?? (() => {});
  try {
    Speech.stop();
    Speech.speak(text, {
      language: opts.language ?? "en-US",
      onDone: opts.onDone,
      onStopped: opts.onStopped,
      onError: done,
    });
  } catch {
    done(); // native TTS unavailable — reflect "not speaking"
  }
}

/** Stop any in-progress speech. */
export function stopReading(): void {
  try {
    Speech.stop();
  } catch {
    // nothing to stop
  }
}

/** Whether speech is currently playing. */
export async function isReading(): Promise<boolean> {
  try {
    return await Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}
