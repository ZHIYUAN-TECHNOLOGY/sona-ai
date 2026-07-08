import { QWEN3_1_7B_QUANTIZED } from "react-native-executorch";

// Single source of truth for the on-device note model. The rest of the pipeline
// is model-agnostic — it only depends on the `LlmLike.generate(messages)` shape
// (see noteGen.ts). To switch models, change these two lines only:
//   - NOTE_MODEL: the executorch model source passed to useLLM.
//   - NOTE_MODEL_NAME: the human label shown in the note screen / audit / settings.
export const NOTE_MODEL = QWEN3_1_7B_QUANTIZED;
export const NOTE_MODEL_NAME = "Qwen3-1.7B";
