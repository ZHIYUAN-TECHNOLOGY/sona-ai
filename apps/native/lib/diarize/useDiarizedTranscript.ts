import { useMemo, useRef } from "react";

import type { RawSegment } from "../pipeline/mockStt";
import { diarize } from "./diarize";
import { mockVoiceprint } from "./mock";
import type { DiarTurn, Voiceprint } from "./types";

// Live diarization for the recording screen. As STT segments stream in, embed each once
// (cached by index — append-only) and re-run diarization over the whole set, so the
// DR/PT chips come from the REAL cluster+role pipeline, not the scripted speaker tags.
// Cheap: ~12 tiny voiceprints. Enrollment isn't used on the live path (pure-linguistic
// role assignment already recovers doctor/patient); it strengthens the acoustic side once
// the clinician enrolls. All on-device.

export function useDiarizedTranscript(segments: RawSegment[]): DiarTurn[] {
  const cache = useRef<Voiceprint[]>([]);
  return useMemo(() => {
    if (segments.length < cache.current.length) cache.current = []; // consult restarted
    const utterances = segments.map((s, i) => {
      // voiceId = the real speaker, standing in for that speaker's audio (mock only).
      // The diarizer never sees it — it works from the voiceprint + text.
      if (!cache.current[i]) cache.current[i] = mockVoiceprint(s.speaker, s.text);
      return { text: s.text, lang: s.lang, embedding: cache.current[i] };
    });
    return diarize(utterances);
  }, [segments]);
}
