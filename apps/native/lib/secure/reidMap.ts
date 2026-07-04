// Secure, device-only re-identify store for the Sona scribe.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ MOAT RULE — NON-NEGOTIABLE:                                              │
// │ The re-identify map (redaction token → real patient value) is the        │
// │ single most sensitive artefact in the app. It is written to the OS       │
// │ secure enclave (iOS Keychain / Android Keystore) via expo-secure-store   │
// │ and NEVER leaves the device. It is never sent to a server, never put in  │
// │ the SQLite DB, never logged, never included in any export (FHIR/PDF).    │
// │ Only DE-IDENTIFIED text (tokens still in place) may ever cross the       │
// │ network boundary — and only on the optional cloud path (not built this   │
// │ week).                                                                    │
// └─────────────────────────────────────────────────────────────────────────┘
//
// expo-secure-store is already a dependency (no install needed). It needs the
// native module, so the store/retrieve functions require a real device build;
// the pure helpers (buildReidMap, storageKey, audioSealKey) are unit-testable.

import * as SecureStore from "expo-secure-store";

import {
  applyReidMap,
  audioSealKey,
  buildReidMap,
  storageKey,
  type ReidMap,
} from "./reidMapCore";

// Pure helpers (native-free, unit-testable) live in ./reidMapCore. Re-exported so
// the whole re-ID API is importable from "lib/secure/reidMap".
export { applyReidMap, audioSealKey, buildReidMap, storageKey, type ReidMap };

// SecureStore options. WHEN_UNLOCKED keeps the secret reachable only while the
// device is unlocked, and never syncs off-device.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
};

/**
 * Persist the full re-ID map for a consult to the secure enclave. Overwrites any
 * existing map for that consult. Device-only — this value never leaves the phone.
 */
export async function saveReidMap(consultId: string, map: ReidMap): Promise<void> {
  await SecureStore.setItemAsync(storageKey(consultId), JSON.stringify(map), OPTIONS);
}

/** Read a consult's re-ID map from the secure enclave, or null if none stored. */
export async function getReidMap(consultId: string): Promise<ReidMap | null> {
  const raw = await SecureStore.getItemAsync(storageKey(consultId), OPTIONS);
  if (!raw) return null;
  return JSON.parse(raw) as ReidMap;
}

/**
 * Merge additional token→value entries into a consult's stored map (read-modify-
 * write). Used as identifiers are confirmed, e.g. the low-confidence name once
 * the clinician taps to confirm.
 */
export async function mergeReidMap(consultId: string, entries: ReidMap): Promise<ReidMap> {
  const existing = (await getReidMap(consultId)) ?? {};
  const merged = buildReidMap(existing, entries);
  await saveReidMap(consultId, merged);
  return merged;
}

/**
 * Re-identify de-identified text locally by substituting each token with its real
 * value from the secure map. Runs ON-DEVICE only, for the clinician's view — the
 * re-identified text is never transmitted.
 */
export async function reidentify(consultId: string, deidentifiedText: string): Promise<string> {
  const map = await getReidMap(consultId);
  if (!map) return deidentifiedText;
  return applyReidMap(map, deidentifiedText);
}

/**
 * On sign: the audio file is deleted by the caller; here we seal ONLY its hash as
 * tamper-evidence. We store the hash, never the audio. Idempotent per consult.
 */
export async function sealAudioDiscard(consultId: string, audioHash: string): Promise<void> {
  await SecureStore.setItemAsync(audioSealKey(consultId), audioHash, OPTIONS);
}

/** Read the sealed audio hash for a consult, or null. */
export async function getSealedAudioHash(consultId: string): Promise<string | null> {
  return SecureStore.getItemAsync(audioSealKey(consultId), OPTIONS);
}

/**
 * Purge all secure secrets for a consult (re-ID map + audio seal). Use when a
 * consult is deleted so no re-identifiable data lingers in the enclave.
 */
export async function purgeConsultSecrets(consultId: string): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(consultId), OPTIONS);
  await SecureStore.deleteItemAsync(audioSealKey(consultId), OPTIONS);
}
