import { expect, test } from "bun:test";
import { formatDate, registered, translate } from "./i18n";

// Every feature's words, registered the way the app does (each strings.ts calls addStrings on import).
const root = `${import.meta.dir}/..`;
for (const file of new Bun.Glob("{app,features,lib}/**/strings.ts").scanSync(root)) await import(`${root}/${file}`);
const { en, ms, zh } = registered();
const namespaces = new Set(Object.keys(en).map(k => k.split(".")[0]));

// Every string literal in the app's source that looks like one of those keys ("home.hello", label: "dock.home").
const used = new Set();
for (const file of new Bun.Glob("{app,features,lib}/**/*.{ts,tsx}").scanSync(root)) {
  if (file.endsWith("strings.ts")) continue;
  const source = await Bun.file(`${root}/${file}`).text();
  for (const [, key] of source.matchAll(/["`]([a-zA-Z]+\.[\w.-]+)["`]/g)) if (namespaces.has(key.split(".")[0])) used.add(key);
}

test("every key the app uses has English words", () => {
  expect(used.size).toBeGreaterThan(300);
  expect([...used].filter(k => !(k in en))).toEqual([]);
});

test("Malay and Chinese cover at least 95% of the keys, with the same placeholders", () => {
  const keys = Object.keys(en);
  for (const [name, dict] of [["ms", ms], ["zh", zh]]) {
    const missing = keys.filter(k => !(k in dict));
    if (missing.length) console.log(`${name} falls back to English for: ${missing.join(", ")}`);
    expect(1 - missing.length / keys.length).toBeGreaterThanOrEqual(0.95);
    // A translation may drop a placeholder (Malay leaves out an English-only condition name), never invent one.
    const invented = Object.entries(dict).filter(([k, v]) => [...v.matchAll(/\{(\w+)\}/g)].some(([, p]) => !en[k]?.includes(`{${p}}`)));
    expect(invented.map(([k]) => k)).toEqual([]);
  }
});

test("emergency lines keep 999 in every language", () => {
  for (const key of Object.keys(en).filter(k => en[k].includes("999"))) {
    expect(translate("ms", key)).toContain("999");
    expect(translate("zh", key)).toContain("999");
  }
});

test("the dock names Messages in every language, and says when the care team has replied", () => {
  expect(["en", "ms", "zh"].map(l => translate(l, "dock.messages"))).toEqual(["Messages", "Mesej", "消息"]);
  for (const dict of [en, ms, zh]) expect(dict["dock.messagesNew"]).toStartWith(dict["dock.messages"]);
});

test("dates and times read in Malaysia time, in each language's own words", () => {
  const at = new Date("2026-09-28T13:00:00Z"); // Mon 28 Sep, 9:00 PM in Malaysia
  const morning = new Date("2026-09-28T01:00:00Z"); // 9:00 AM
  expect(formatDate("en", at, "dayTime")).toBe("Mon 28 Sep 9:00 PM");
  expect(formatDate("ms", morning, "dayTime")).toBe("Isn 28 Sep, 9:00 PG");
  expect(formatDate("ms", at, "time")).toBe("9:00 PTG");
  expect(formatDate("zh", morning, "dayTime")).toBe("9月28日 周一 上午9:00");
  expect(formatDate("zh", at, "time")).toBe("晚上9:00");
  expect(formatDate("en", new Date("2026-09-27T16:30:00Z"), "header")).toBe("Mon, 28 Sep"); // 00:30 the next day in Malaysia
  expect(formatDate("ms", at, "long")).toBe("Isnin 28 September");
  expect(formatDate("zh", at, "long")).toBe("9月28日 星期一");
  expect(formatDate("en", at, "hm")).toBe("21:00");
});
