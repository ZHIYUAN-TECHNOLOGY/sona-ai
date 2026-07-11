import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";

import type { RawSegment } from "../pipeline/mockStt";
import { diarize } from "./diarize";
import { loadDoctorVoiceprint } from "./enroll";
import { mockVoiceprint } from "./mock";
import type { DiarTurn, Voiceprint } from "./types";

// Live diarization for the recording screen. As STT segments stream in, embed each once
// (cached by index — append-only) and re-run diarization over the whole set, so the
// DR/PT chips come from the REAL cluster+role pipeline, not the scripted speaker tags.
// Cheap: ~12 tiny voiceprints. If the clinician has enrolled (Settings → Speaker ID) their
// voiceprint is loaded and blended in — the diarizer then identifies the doctor acoustically,
// not only by language cues. All on-device; voiceprints never leave memory here.

export function useDiarizedTranscript(segments: RawSegment[]): DiarTurn[] {
  const cache = useRef<Voiceprint[]>([]);
  const [doctorVp, setDoctorVp] = useState<Voiceprint | null>(null);

  // Load the enrolled clinician voiceprint (null if not enrolled / model changed). Reloads
  // on refocus, so enrolling in Settings takes effect without remounting this screen.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadDoctorVoiceprint().then((vp) => alive && setDoctorVp(vp));
      return () => {
        alive = false;
      };
    }, []),
  );

  return useMemo(() => {
    if (segments.length < cache.current.length) cache.current = []; // consult restarted
    const utterances = segments.map((s, i) => {
      // voiceId = the real speaker, standing in for that speaker's audio (mock only).
      // The diarizer never sees it — it works from the voiceprint + text.
      if (!cache.current[i]) cache.current[i] = mockVoiceprint(s.speaker, s.text);
      return { text: s.text, lang: s.lang, embedding: cache.current[i] };
    });
    return diarize(utterances, doctorVp ? { doctorVoiceprint: doctorVp, voiceprintWeight: 0.6 } : undefined);
  }, [segments, doctorVp]);
}
