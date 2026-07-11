import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RawSegment } from "../pipeline/mockStt";
import { diarize } from "./diarize";
import { getSpeakerEmbedder } from "./embedder";
import { loadDoctorVoiceprint } from "./enroll";
import { synthUtterancePcm } from "./mockAudio";
import type { DiarTurn, Voiceprint } from "./types";

// Live diarization for the recording screen. As STT segments stream in, embed each with the
// ACTIVE speaker embedder (the mock band-energy one, or the real ExecuTorch ECAPA once a
// model is configured) and re-run diarization over the set, so the DR/PT/OTHER chips come
// from the real cluster+role pipeline. Embedding is async (real models run off-thread), so
// voiceprints are computed in an effect and cached by index (append-only). If the clinician
// has enrolled (Settings → Speaker ID), their voiceprint is blended in for acoustic doctor
// ID. All on-device; voiceprints never leave memory here.
//
// SEAM: the audio fed to the embedder here is a mock synth window keyed to the speaker. The
// real mic path (Stage 2) slices the recorder buffer by VAD segment (see vad.ts) — the
// embedder and everything downstream are already real.

export function useDiarizedTranscript(segments: RawSegment[]): DiarTurn[] {
  const vps = useRef<Voiceprint[]>([]);
  const [ready, setReady] = useState(0); // bumps when new voiceprints land → re-diarize
  const [doctorVp, setDoctorVp] = useState<Voiceprint | null>(null);

  // Enrolled clinician voiceprint (reloads on refocus, so enrolling in Settings takes hold).
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadDoctorVoiceprint().then((vp) => alive && setDoctorVp(vp));
      return () => {
        alive = false;
      };
    }, []),
  );

  // Embed newly-arrived segments with the active embedder (async).
  useEffect(() => {
    let alive = true;
    if (segments.length < vps.current.length) vps.current = []; // consult restarted
    const start = vps.current.length;
    if (segments.length <= start) return;
    (async () => {
      const embedder = getSpeakerEmbedder();
      for (let i = start; i < segments.length; i++) {
        const pcm = synthUtterancePcm(segments[i].speaker, segments[i].text); // SEAM: mic slice in prod
        const vp = await embedder.embed(pcm);
        if (!alive) return;
        vps.current[i] = vp;
      }
      if (alive) setReady((r) => r + 1);
    })();
    return () => {
      alive = false;
    };
  }, [segments]);

  return useMemo(() => {
    const n = Math.min(segments.length, vps.current.length);
    const utterances = segments.slice(0, n).map((s, i) => ({
      text: s.text,
      lang: s.lang,
      embedding: vps.current[i],
    }));
    return diarize(utterances, doctorVp ? { doctorVoiceprint: doctorVp, voiceprintWeight: 0.6 } : undefined);
    // `ready` drives re-diarization once async voiceprints resolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, ready, doctorVp]);
}
