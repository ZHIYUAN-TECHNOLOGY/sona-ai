import { clearDoctorVoiceprint, getDoctorVoiceprint, saveDoctorVoiceprint } from "../db";
import { getSpeakerEmbedder } from "./embedder";
import type { Voiceprint } from "./types";

// Clinician voiceprint enrollment (device-only). The doctor records a few seconds of
// their own voice once; we embed each window, average the voiceprints, and store the
// result locally so the diarizer can positively identify the clinician's voice in every
// consult. BIOMETRIC PHI — persisted via the doctor_voiceprint table (device-only,
// never logged/exported). Touches the DB, so keep this out of pure tests.

function averageNormalized(vps: Voiceprint[]): Voiceprint {
  const dim = vps[0].length;
  const sum = new Float64Array(dim);
  for (const v of vps) for (let i = 0; i < dim; i++) sum[i] += v[i];
  const out = new Float32Array(dim);
  let sq = 0;
  for (let i = 0; i < dim; i++) {
    const v = sum[i] / vps.length;
    out[i] = v;
    sq += v * v;
  }
  const n = Math.sqrt(sq);
  if (n > 0) for (let i = 0; i < dim; i++) out[i] /= n;
  return out;
}

/** Enroll the clinician from one or more audio windows. Returns the stored voiceprint. */
export async function enrollDoctorVoiceprint(windows: Float32Array[]): Promise<Voiceprint> {
  if (windows.length === 0) throw new Error("enrollDoctorVoiceprint: need at least one audio window");
  const embedder = getSpeakerEmbedder();
  const vps = await Promise.all(windows.map((w) => embedder.embed(w)));
  const vp = averageNormalized(vps);
  await saveDoctorVoiceprint(embedder.id, Array.from(vp));
  return vp;
}

/** The enrolled voiceprint as a Float32Array, or null if none / stale (embedder changed). */
export async function loadDoctorVoiceprint(): Promise<Voiceprint | null> {
  const stored = await getDoctorVoiceprint();
  if (!stored) return null;
  if (stored.model !== getSpeakerEmbedder().id) return null; // model changed → re-enroll
  return Float32Array.from(stored.vec);
}

/** Remove the enrolled voiceprint (re-enroll or revoke). */
export async function unenrollDoctor(): Promise<void> {
  await clearDoctorVoiceprint();
}

/** Whether the clinician has enrolled a voiceprint (for a settings badge). */
export async function isDoctorEnrolled(): Promise<boolean> {
  return (await getDoctorVoiceprint()) !== null;
}
