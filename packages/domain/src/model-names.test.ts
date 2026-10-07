import { expect, test } from "bun:test";
import { modelName } from "./model-names";

test("every hosted model is shown by Sona's name, never its base model's", () => {
  expect(modelName("gemma-4-26b-a4b")).toBe("Sona Med");
  expect(modelName("medgemma-27b-it-sona-triage-v3")).toBe("Sona Med");
  expect(modelName("@cf/aisingapore/gemma-sea-lion-v4-27b-it")).toBe("Sona Med");
  expect(modelName("medgemma-1.5-4b")).toBe("Sona Vision");
  expect(modelName("google/medgemma-4b-it-cxr-finetune-2026-09-30")).toBe("Sona Vision");
  expect(modelName("sona-asr")).toBe("Sona Speech");
  expect(modelName("@cf/openai/whisper-large-v3-turbo")).toBe("Sona Speech");
  expect(modelName("sona-voxcpm2-malaysian")).toBe("Sona Voice");
  expect(modelName("OpenMed/OpenMed-PII-mClinicalE5-Large-560M-v1")).toBe("Sona Privacy");
  expect(modelName("something-new")).toBe("Sona");
  expect(modelName(undefined)).toBe("Sona");
});
