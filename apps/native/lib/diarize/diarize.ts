import type { Speaker } from "../db/types";
import { cosineSim } from "../knowledge/vector";
import { clusterVoiceprints, type ClusterResult } from "./cluster";
import { scoreClusterRole } from "./roleClassifier";
import type { DiarTurn, DiarUtterance, Voiceprint } from "./types";

// Diarization orchestrator: cluster voiceprints into anonymous speakers, then assign
// roles. The doctor cluster is chosen by blending (a) acoustic match to the enrolled
// clinician voiceprint, if any, and (b) the linguistic role classifier; the strongest
// remaining cluster by patient cues becomes the patient; the rest are "unknown" (a
// third party — family, nurse). With no enrollment it degrades to pure-linguistic role
// assignment, which still recovers doctor/patient on a code-switched consult.
//
// Pure + deterministic. On-device: voiceprints and the enrolled profile never leave.

export interface DiarizeOptions {
  /** Cosine threshold to join a cluster (see clusterVoiceprints). */
  threshold?: number;
  /** Cap on discovered speakers. */
  maxSpeakers?: number;
  /** Enrolled clinician voiceprint, if the doctor has enrolled. */
  doctorVoiceprint?: Voiceprint | null;
  /** How much to trust acoustics vs. language when a voiceprint is enrolled (0..1). */
  voiceprintWeight?: number;
}

const EPS = 1e-6;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

interface ClusterRole {
  /** Doctor-likeness in [0,1] (acoustic ⊕ linguistic). */
  doctorScore: number;
  /** Patient-likeness in [0,1] from linguistic cues. */
  patientScore: number;
  /** Confidence in this cluster's dominant role, [0,1]. */
  confidence: number;
}

/** Score every cluster's doctor/patient likeness. Exposed for testing. */
export function scoreClusters(
  clusters: ClusterResult,
  texts: string[],
  opts: DiarizeOptions = {},
): ClusterRole[] {
  const k = clusters.centroids.length;
  const vpWeight = opts.voiceprintWeight ?? 0.6;
  const hasVp = !!opts.doctorVoiceprint;

  return Array.from({ length: k }, (_, c) => {
    const clusterTexts = texts.filter((_, i) => clusters.labels[i] === c);
    const ling = scoreClusterRole(clusterTexts);
    const lingTotal = ling.doctor + ling.patient + EPS;
    const lingDoc = ling.doctor / lingTotal; // share of doctor cues
    const lingPat = ling.patient / lingTotal;

    const acoustic = hasVp
      ? clamp01(cosineSim(clusters.centroids[c], opts.doctorVoiceprint as Voiceprint))
      : 0;
    const doctorScore = hasVp ? vpWeight * acoustic + (1 - vpWeight) * lingDoc : lingDoc;
    const patientScore = lingPat;
    const confidence = clamp01(Math.abs(ling.doctor - ling.patient) / lingTotal);
    return { doctorScore, patientScore, confidence };
  });
}

/**
 * Run diarization over utterances with voiceprints. Returns one turn per utterance in
 * input order, each tagged with its anonymous cluster, assigned role, and confidence.
 */
export function diarize(utterances: DiarUtterance[], opts: DiarizeOptions = {}): DiarTurn[] {
  if (utterances.length === 0) return [];
  const clusters = clusterVoiceprints(
    utterances.map((u) => u.embedding),
    opts.threshold,
    opts.maxSpeakers,
  );
  const roles = scoreClusters(
    clusters,
    utterances.map((u) => u.text),
    opts,
  );

  // Pick the doctor cluster (highest doctorScore), then the patient cluster among the
  // rest (highest patientScore, breaking ties toward the larger cluster).
  const order = roles.map((_, c) => c);
  const doctorCluster = order.reduce((a, b) => (roles[b].doctorScore > roles[a].doctorScore ? b : a), order[0]);
  const rest = order.filter((c) => c !== doctorCluster);
  const patientCluster = rest.length
    ? rest.reduce((a, b) => {
        const d = roles[b].patientScore - roles[a].patientScore;
        if (Math.abs(d) > EPS) return d > 0 ? b : a;
        return clusters.sizes[b] > clusters.sizes[a] ? b : a; // tie → larger cluster
      }, rest[0])
    : -1;

  const roleOf = (c: number): Speaker =>
    c === doctorCluster ? "doctor" : c === patientCluster ? "patient" : "unknown";

  return utterances.map((u, i) => {
    const c = clusters.labels[i];
    return {
      text: u.text,
      lang: u.lang,
      cluster: c,
      speaker: roleOf(c),
      confidence: roles[c]?.confidence ?? 0,
    };
  });
}
