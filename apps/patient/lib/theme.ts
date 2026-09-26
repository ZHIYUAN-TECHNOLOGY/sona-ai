/**
 * Sona's tokens, the same as the clinician app (apps/native/components/sona/theme.ts): pale grey
 * canvas, subtle blue, ink type. Kept as a copy until a shared UI package is worth making.
 */
export const palette = {
  canvas: "#F5F6F8", surface: "#FFFFFF", ink: "#1D1F23", muted: "#59616B",
  blue: "#245BCC", blueWash: "#D5E5FC", line: "#D8DBE0", white: "#FFFFFF",
  green: "#286850", amber: "#8B5518", red: "#A23E3E", dark: "#282C33",
};

export const type = {
  display: { fontSize: 27, lineHeight: 35, letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 31, letterSpacing: -0.45 },
  headline: { fontSize: 17, lineHeight: 23, letterSpacing: -0.2, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 24 },
  footnote: { fontSize: 13, lineHeight: 18 },
  overline: { fontSize: 11, lineHeight: 14, letterSpacing: 0.8, fontWeight: "700", textTransform: "uppercase" },
} as const;
