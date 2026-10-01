import { expect, test } from "bun:test";
import { languageOf, partsOf, pickVoices, standInFor, voiceFor, wordEnd } from "./voices";

const v = (identifier, language, quality = "Default") => ({ identifier, name: identifier, language, quality });

test("Malay and Chinese voices join the English ones, and an answer is read in its own language", () => {
  const list = pickVoices([v("gb", "en-GB", "Enhanced"), v("us", "en-US"), v("au", "en-AU"), v("amira", "ms-MY"), v("tingting", "zh-CN")]);
  expect(list.map(x => x.name)).toEqual(["Sona", "Mira", "Arin", "Suri", "Nadia", "Mei"]);
  const picked = list[1];
  expect(languageOf("Anda perlu makan Azithromycin sekali sehari pada pukul 8:00 pagi.")).toBe("ms");
  expect(languageOf("你什么时候复诊？")).toBe("zh");
  expect(languageOf("Take it after food.")).toBe("en");
  expect(voiceFor("Anda perlu makan ubat ini selepas makan.", picked, list).name).toBe("Nadia");
  expect(voiceFor("你的复诊在十月四日。", picked, list).name).toBe("Mei");
  expect(voiceFor("Take it after food.", picked, list).name).toBe("Mira");
  // No Malay voice on the phone: the picked voice reads it rather than nothing.
  expect(voiceFor("Anda perlu makan ubat ini.", picked, pickVoices([v("gb", "en-GB")])).name).toBe("Mira");
});

test("Sona's own voice reads every language; while it isn't ready, the phone's voice for that language stands in", () => {
  const list = pickVoices([v("gb", "en-GB"), v("amira", "ms-MY"), v("tingting", "zh-CN")]);
  const sona = list[0];
  expect(sona).toMatchObject({ id: "sona", hosted: true });
  for (const text of ["Anda perlu makan ubat ini selepas makan.", "你的复诊在十月四日。", "Take it after food."]) expect(voiceFor(text, sona, list)).toBe(sona);
  expect(standInFor("Anda perlu makan ubat ini selepas makan.", list).name).toBe("Nadia");
  expect(standInFor("你的复诊在十月四日。", list).name).toBe("Mei");
  expect(standInFor("Take it after food.", list).name).toBe("Mira");
});

test("an answer is read in sentences: not split at a decimal dot, a short one joined to the next, a long one cut at a space", () => {
  const read = text => partsOf(text).map(p => text.slice(p.start, p.end));
  expect(read("Take Paracetamol 2.5 mg every 6 hours. Come back if the fever returns!  ")).toEqual(["Take Paracetamol 2.5 mg every 6 hours.", "Come back if the fever returns!"]);
  expect(read("Yes. Take it after food, with water.")).toEqual(["Yes. Take it after food, with water."]);
  expect(read("你的复诊在十月四日。请带上药物清单。")).toEqual(["你的复诊在十月四日。", "请带上药物清单。"]);
  const long = `${"word ".repeat(70)}end.`;
  const parts = read(long);
  expect(parts.length).toBe(2);
  expect(parts.every(p => p.length <= 300 && !p.startsWith(" ") && !p.endsWith(" "))).toBe(true);
  expect(parts.join(" ")).toBe(long);
});

test("a long first sentence is cut at its first comma or colon, so Sona starts sooner; never inside 1,000 or too early", () => {
  const read = text => partsOf(text).map(p => text.slice(p.start, p.end));
  expect(read("Your plan says: For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day."))
    .toEqual(["Your plan says: For pain or fever:", "1 g every 6 hours if you need it, no more than 4 g a day."]);
  expect(read("Take 1,000 mg of Paracetamol every six hours when you need it for the fever or the pain.")).toHaveLength(1);
  expect(read("Clinic review, Tue 13 Oct (in 11 days). To see how you're doing after your pneumonia.")).toEqual(["Clinic review, Tue 13 Oct (in 11 days).", "To see how you're doing after your pneumonia."]);
  expect(read("如果发烧又回来了，或者您觉得呼吸困难，请马上拨打999或去最近的急诊部门。")).toEqual(["如果发烧又回来了，", "或者您觉得呼吸困难，请马上拨打999或去最近的急诊部门。"]);
});

test("Sona's voice lights whole words as it plays: mid-word moves to the word's end; Chinese goes character by character", () => {
  const text = "Clinic visit, Tue 29 Sep (3 days ago).";
  expect(text.slice(0, wordEnd(text, text.indexOf("ep")))).toBe("Clinic visit, Tue 29 Sep");
  expect(wordEnd(text, text.length - 3)).toBe(text.length);
  expect(wordEnd("你的复诊在十月四日。", 3)).toBe(3);
  expect(wordEnd(text, 0)).toBe(0);
});
