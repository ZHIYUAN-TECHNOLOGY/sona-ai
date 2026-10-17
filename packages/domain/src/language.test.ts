import { expect, test } from "bun:test";
import { languageOf } from "./language";

test("a question's own language, whatever the plan's", () => {
  expect(languageOf("What should I watch for while recovering from pneumonia?")).toBe("en");
  expect(languageOf("Apa yang perlu saya perhatikan semasa pulih daripada radang paru-paru?")).toBe("ms");
  expect(languageOf("Bolehkah saya makan antibiotik selepas makan?")).toBe("ms");
  expect(languageOf("肺炎康复期间我应该注意什么？")).toBe("zh");
  expect(languageOf("Can I take my antibiotic with food?")).toBe("en");
});
