import { expect, test } from "bun:test";
import { languageOf, pickVoices, voiceFor } from "./voices";

const v = (identifier, language, quality = "Default") => ({ identifier, name: identifier, language, quality });

test("Malay and Chinese voices join the English ones, and an answer is read in its own language", () => {
  const list = pickVoices([v("gb", "en-GB", "Enhanced"), v("us", "en-US"), v("au", "en-AU"), v("amira", "ms-MY"), v("tingting", "zh-CN")]);
  expect(list.map(x => x.name)).toEqual(["Mira", "Arin", "Suri", "Nadia", "Mei"]);
  const picked = list[0];
  expect(languageOf("Anda perlu makan Azithromycin sekali sehari pada pukul 8:00 pagi.")).toBe("ms");
  expect(languageOf("你什么时候复诊？")).toBe("zh");
  expect(languageOf("Take it after food.")).toBe("en");
  expect(voiceFor("Anda perlu makan ubat ini selepas makan.", picked, list).name).toBe("Nadia");
  expect(voiceFor("你的复诊在十月四日。", picked, list).name).toBe("Mei");
  expect(voiceFor("Take it after food.", picked, list).name).toBe("Mira");
  // No Malay voice on the phone: the picked voice reads it rather than nothing.
  expect(voiceFor("Anda perlu makan ubat ini.", picked, pickVoices([v("gb", "en-GB")])).name).toBe("Mira");
});
