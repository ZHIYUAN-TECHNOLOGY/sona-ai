import { expect, test } from "bun:test";
import { pickVoices } from "./voices";

const v = (identifier, language, quality = "Default") => ({ identifier, name: identifier, language, quality });

test("English voices only, the clearest first and one per accent (British first) before any repeats, four at most", () => {
  const picked = pickVoices([
    v("us-1", "en-US"), v("gb-1", "en-GB"), v("gb-2", "en-GB", "Enhanced"), v("fr-1", "fr-FR"),
    v("com.apple.speech.synthesis.voice.Bubbles", "en-US"), v("com.apple.eloquence.en-US.Eddy", "en-US"),
    v("au-1", "en_AU"), v("us-2", "en-US", "Enhanced"), v("in-1", "en-IN"),
  ]);
  expect(picked.map(p => p.voice)).toEqual(["gb-2", "us-2", "au-1", "in-1"]);
  expect(picked.map(p => p.name)).toEqual(["Mira", "Arin", "Suri", "Kai"]);
  expect(picked[0].line).toBe("British English · clearest quality");
  expect(picked[2].line).toBe("Australian English");
  expect(picked[2].language).toBe("en-AU");
});

test("with fewer than three English voices the phone's own voice fills in, slower and lower", () => {
  expect(pickVoices([]).map(p => [p.id, p.voice, p.rate, p.pitch])).toEqual([["phone", undefined, 1, 1], ["phone-slow", undefined, 0.8, 1], ["phone-low", undefined, 0.95, 0.8]]);
  expect(pickVoices([v("gb-1", "en-GB"), v("zh-1", "zh-CN")]).map(p => p.id)).toEqual(["gb-1", "phone", "phone-slow"]);
});
