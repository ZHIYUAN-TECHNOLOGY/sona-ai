import { expect, mock, test } from "bun:test";
mock.module("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => {} }));
const { addStrings, currentLang, setLang, translate } = await import("./i18n");

test("English until the patient picks another; missing words fall back to English", () => {
  addStrings({ en: { "t.hello": "Hello! {name}", "t.only": "English only" }, ms: { "t.hello": "Helo! {name}" }, zh: { "t.hello": "你好！{name}" } });
  expect(currentLang()).toBe("en");
  expect(translate("ms", "t.hello", { name: "Amelia" })).toBe("Helo! Amelia");
  expect(translate("ms", "t.only")).toBe("English only");
  setLang("zh");
  expect(translate(currentLang(), "t.hello", { name: "Amelia" })).toBe("你好！Amelia");
});
