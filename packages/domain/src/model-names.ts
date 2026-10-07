/**
 * What a screen calls a model: Sona's own names (the models are hosted and fine-tuned for Sona), never the base model's
 * (Gemma, MedGemma, Whisper, VoxCPM2, OpenMed). The ids the server sends and keeps stay as they are, since each call names
 * its model by them; only what is shown is renamed. An id matching none of these is still Sona's, never shown raw.
 */
const NAMES: [RegExp, string][] = [
  [/pii|deident/i, "Sona Privacy"],
  [/asr|whisper|speech/i, "Sona Speech"],
  [/voxcpm|tts|voice/i, "Sona Voice"],
  [/medgemma[\w.-]*-4b|cxr|xray/i, "Sona Vision"],
  [/gemma|sea-lion|laya|brain|sona-med/i, "Sona Med"],
];

/** A model id's shown name ("gemma-4-26b-a4b" → "Sona Med", "medgemma-1.5-4b" → "Sona Vision"). */
export const modelName = (id?: string) => NAMES.find(([re]) => id && re.test(id))?.[1] ?? "Sona";
