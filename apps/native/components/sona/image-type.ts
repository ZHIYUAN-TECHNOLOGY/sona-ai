/**
 * The image type the capture sheet preselects, guessed from what the clinician typed. The sheet
 * still asks; this only saves a tap. ponytail: keyword match; an on-device classifier replaces it.
 */
export const IMAGE_TYPES = ["Chest X-ray", "Skin", "Wound", "Document", "Other"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
const RULES: [RegExp, ImageType][] = [
  [/\b(x-?ray|cxr|chest|film|radiograph)\b/i, "Chest X-ray"],
  [/\b(wound|ulcer|laceration|cut|burn|incision|dressing)\b/i, "Wound"],
  [/\b(rash|skin|lesion|mole|eczema|itch|spot)\b/i, "Skin"],
  [/\b(letter|report|referral|document|lab|result|prescription|discharge)\b/i, "Document"],
];
export function suggestImageType(text: string | undefined): ImageType {
  return RULES.find(([pattern]) => pattern.test(text ?? ""))?.[1] ?? "Chest X-ray";
}
