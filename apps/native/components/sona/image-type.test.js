import { expect, test } from "bun:test";
import { suggestImageType } from "./image-type";

test("the capture sheet preselects a type from the typed request", () => {
  expect(suggestImageType("what's this rash on her arm")).toBe("Skin");
  expect(suggestImageType("check the wound dressing")).toBe("Wound");
  expect(suggestImageType("read this referral letter")).toBe("Document");
  expect(suggestImageType("chest x-ray please")).toBe("Chest X-ray");
  expect(suggestImageType("")).toBe("Chest X-ray");
});
