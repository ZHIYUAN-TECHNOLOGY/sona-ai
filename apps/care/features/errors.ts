import { ORPCError } from "@orpc/client";
import { registered, translate, type Lang } from "@/lib/i18n";
import "@/lib/strings";

/**
 * The server's refusals in the patient's words. A refusal carrying a stable code (`data.code`, or its own
 * error code) is read as `err.<code>`, ignoring case, dashes and underscores ("VOICE_OFF" → err.voiceOff);
 * until the server sends codes, its known English sentences map to the same words. Anything else the
 * server refused is shown as it wrote it; a dropped connection or a server fault gets `fallback`.
 */
const SAID: Record<string, string> = {
  "That code was not recognised. Check it against your discharge paper.": "codeUnknown",
  "This is a clinician account. Create a separate account for Sona Care.": "clinician",
  "This code has already been used. Ask the ward for a new one.": "codeUsed",
  "This code has expired. Ask the ward for a new one.": "codeExpired",
  "Your record was not found": "noRecord",
  "Speaking to Sona Care isn't switched on yet. Please type instead.": "voiceOff",
  "Join with the code on your discharge paper first": "joinFirst",
  "We couldn't find that doctor": "noDoctor",
  "No such doctor at this hospital": "noDoctor",
  "That time is no longer free. Please choose another.": "slotTaken",
  "That request is no longer open": "requestClosed",
  "That isn't one of your doses": "notYourDose",
};
const squash = (s: string) => s.replace(/[-_\s]/g, "").toLowerCase();
// The server's codes whose words here have another name.
const ALIAS: Record<string, string> = {
  CLINICIAN_ACCOUNT: "clinician", NOT_JOINED: "joinFirst", RECORD_MISSING: "noRecord", SPEECH_OFF: "voiceOff",
  DOCTOR_UNKNOWN: "noDoctor", DOSE_UNKNOWN: "notYourDose", CHECK_IN_UNKNOWN: "noRecord",
};

function keyOf(code: unknown) {
  if (typeof code !== "string") return undefined;
  if (ALIAS[code]) return `err.${ALIAS[code]}`;
  return Object.keys(registered().en).find(k => k.startsWith("err.") && squash(k.slice(4)) === squash(code));
}

export function errorText(e: unknown, lang: Lang = "en", fallback = "common.error") {
  const { message, code, data } = (e ?? {}) as { message?: unknown; code?: unknown; data?: { code?: unknown } };
  const key = keyOf(data?.code) ?? keyOf(code) ?? (typeof message === "string" && SAID[message] ? `err.${SAID[message]}` : undefined);
  if (key) return translate(lang, key);
  return e instanceof ORPCError && e.status < 500 && typeof message === "string" && message ? message : translate(lang, fallback);
}
