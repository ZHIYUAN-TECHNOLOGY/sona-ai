// Pure test for TTS language segmentation. No device.
//   npx tsx lib/tts/language.test.ts

import assert from "node:assert/strict";

import { langToBcp47, segmentByLanguage } from "./language";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

// BCP-47 mapping.
ok(langToBcp47("zh") === "zh-CN" && langToBcp47("ms") === "ms-MY" && langToBcp47("en") === "en-US", "bcp47 map");

// Chinese sentence → zh.
const zh = segmentByLanguage("请深呼吸。");
ok(zh.length === 1 && zh[0].lang === "zh", "chinese → zh voice");

// Malay-heavy sentence → ms.
const ms = segmentByLanguage("Encik, ada demam dan sakit kepala tak?");
ok(ms[0].lang === "ms", "malay markers → ms voice");

// English sentence → en.
const en = segmentByLanguage("Take one tablet after food twice daily.");
ok(en[0].lang === "en", "english → en voice");

// Mixed note: routes each sentence + merges consecutive same-language.
const mix = segmentByLanguage("Good morning. Ada demam ke? 请张开嘴巴。 Let's check your throat.");
ok(mix.length === 4, "four language runs");
ok(
  mix[0].lang === "en" && mix[1].lang === "ms" && mix[2].lang === "zh" && mix[3].lang === "en",
  "en → ms → zh → en routing",
);

// Consecutive same-language sentences merge into one segment (fewer utterances).
const merged = segmentByLanguage("Vitals stable. No chest pain. Plan review in one week.");
ok(merged.length === 1 && merged[0].lang === "en", "consecutive english merged");

// Empty / whitespace → no segments.
ok(segmentByLanguage("   \n ").length === 0, "empty → no segments");

// eslint-disable-next-line no-console
console.log(`tts-language: ${checks}/${checks} checks pass`);
