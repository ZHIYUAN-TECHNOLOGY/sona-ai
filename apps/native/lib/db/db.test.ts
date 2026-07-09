// Pure, logic-level tests for the persistence layer — NO native modules required.
//
// Covers the native-free pieces: the row builders (./builders) and the re-ID
// helpers (../secure/reidMapCore). These import nothing from expo-*, so they run
// under plain node without a device build.
//
// RUN (from apps/native):
//   npx tsx lib/db/db.test.ts
//   # or: npx ts-node --compiler-options '{"module":"commonjs"}' lib/db/db.test.ts
//
// WHAT IS NOT COVERED HERE (needs a device / simulator build, because expo-sqlite
// and expo-secure-store are native modules):
//   - initDb / createConsult / appendTranscript / saveNote / appendAudit / getConsult
//     and all SQL round-trips in ./index.ts
//   - saveReidMap / getReidMap / mergeReidMap / reidentify / sealAudioDiscard /
//     getSealedAudioHash / purgeConsultSecrets in ../secure/reidMap.ts
// See the "Manual device checklist" comment at the bottom for how to verify those.

import { buildAudit, buildConsult, buildTranscriptSegment } from "./builders";
import { applyReidMap, audioSealKey, buildReidMap, storageKey } from "../secure/reidMapCore";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function eq<T>(actual: T, expected: T, msg: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  );
}

// --- buildConsult ------------------------------------------------------------
{
  const c = buildConsult({
    title: "GP follow-up",
    consentText: "Patient consents to on-device recording.",
    now: 1000,
    id: "c1",
  });
  eq(c.id, "c1", "consult id");
  eq(c.createdAt, 1000, "consult createdAt");
  eq(c.updatedAt, 1000, "consult updatedAt");
  eq(c.status, "consented", "new consult status is consented");
  eq(c.audioHash, null, "new consult has no audio hash");
  eq(c.signedAt, null, "new consult is unsigned");
  assert(buildConsult({ title: "a", consentText: "b" }).id.length > 0, "auto id generated");
}

// --- buildTranscriptSegment --------------------------------------------------
{
  const s = buildTranscriptSegment({
    consultId: "c1",
    seq: 0,
    speaker: "doctor",
    text: "Morning Encik Rahman, how's the cough today?",
    startMs: 0,
    endMs: 3200,
    id: "s0",
  });
  eq(s.consultId, "c1", "segment consultId");
  eq(s.seq, 0, "segment seq");
  eq(s.speaker, "doctor", "segment speaker");
  eq(s.confidence, null, "segment confidence defaults to null");
}

// --- buildAudit --------------------------------------------------------------
{
  const a = buildAudit({
    consultId: "c1",
    stage: "redact",
    detail: "de-identified text handed to note model",
    ts: 2000,
    id: "a1",
  });
  eq(a.stage, "redact", "audit stage");
  eq(a.ts, 2000, "audit ts");
  eq(a.detail, "de-identified text handed to note model", "audit detail");
  // Distinct entries get distinct auto ids.
  const x = buildAudit({ consultId: "c1", stage: "sign", detail: "signed" });
  const y = buildAudit({ consultId: "c1", stage: "sign", detail: "signed" });
  assert(x.id !== y.id, "auto audit ids are unique");
}

// --- buildReidMap ------------------------------------------------------------
{
  const base = { NAME_1: "Rahman bin Ismail" };
  const merged = buildReidMap(base, { IC_1: "580214-05-5321" });
  eq(merged, { NAME_1: "Rahman bin Ismail", IC_1: "580214-05-5321" }, "merge adds entry");
  // Later entries override earlier ones.
  eq(buildReidMap(base, { NAME_1: "X" }), { NAME_1: "X" }, "merge overrides on key clash");
  // buildReidMap is pure — base is untouched.
  eq(base, { NAME_1: "Rahman bin Ismail" }, "buildReidMap does not mutate base");
}

// --- applyReidMap: the locked-consult re-identification ----------------------
{
  const map = {
    NAME_1: "Rahman bin Ismail",
    IC_1: "580214-05-5321",
    PHONE_1: "012-345 6789",
    ADDR_1: "No. 12, Jalan Melati, Taman Sri Muda, Shah Alam",
    NAME_UNCERTAIN_1: "Kak Timah",
  };
  const deid = "NAME_1, IC IC_1, phone PHONE_1, at ADDR_1. Look for NAME_UNCERTAIN_1.";
  const out = applyReidMap(map, deid);
  eq(
    out,
    "Rahman bin Ismail, IC 580214-05-5321, phone 012-345 6789, at No. 12, Jalan Melati, Taman Sri Muda, Shah Alam. Look for Kak Timah.",
    "re-identifies all locked-consult tokens",
  );
  assert(!out.includes("NAME_1"), "no residual NAME_1 token after re-id");

  // Edge: longest-token-first must stop NAME_1 from clobbering NAME_UNCERTAIN_1.
  const edge = applyReidMap(map, "NAME_UNCERTAIN_1");
  eq(edge, "Kak Timah", "NAME_UNCERTAIN_1 wins over NAME_1 substring");

  // True prefix collision: "NAME_1" IS a substring of "NAME_10". Without
  // longest-first, applying NAME_1 first turns "NAME_10" into "Ali0".
  const collision = { NAME_1: "Ali", NAME_10: "Siti" };
  eq(
    applyReidMap(collision, "Seen NAME_1 and NAME_10 today"),
    "Seen Ali and Siti today",
    "longest-first stops NAME_1 from eating NAME_10",
  );
}

// --- secure-store keys are namespaced + per-consult --------------------------
{
  eq(storageKey("c1"), "sona.reidmap.c1", "reid map storage key");
  eq(audioSealKey("c1"), "sona.audioseal.c1", "audio seal storage key");
  assert(storageKey("c1") !== storageKey("c2"), "reid keys differ per consult");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  // Non-zero exit so CI / a manual run flags the failure.
  if (typeof process !== "undefined") process.exitCode = 1;
}

// --- Manual device checklist (needs a real device / simulator build) ---------
// 1. initDb(): open sona.db, confirm tables consult/transcript_segment/
//    clinical_note/audit_entry exist and PRAGMA user_version = 2.
// 2. createConsult -> getConsult round-trips; status starts "consented".
// 3. appendTranscript x N -> getTranscript returns them ordered by seq.
// 4. saveNote -> getNote round-trips SOAP + orders (JSON) + flags.
// 5. appendAudit x N -> getAudit returns append-only rows oldest-first.
// 6. saveReidMap/getReidMap/mergeReidMap round-trip via the Keychain/Keystore.
// 7. reidentify(consultId, deidText) substitutes using the stored map on-device.
// 8. sealAudioDiscard stores ONLY the hash; confirm the audio file is deleted and
//    getSealedAudioHash returns the hash. purgeConsultSecrets clears both keys.
// 9. MOAT: with a network monitor, confirm none of the above emits any bytes.
