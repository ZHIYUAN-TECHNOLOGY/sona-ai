/**
 * Sona Care's tokens, Clean (after the Life OS kit, 27 Sep 2026): a near-white canvas under a cool
 * mist, white cards on hairline edges, navy type, black primary pills and one royal-blue accent.
 * Red, amber and green keep their meaning (must-not-miss, soon, done); emergency text is never tinted.
 */
export const palette = {
  canvas: "#FCFCFD", surface: "#FFFFFF", ink: "#141A2E", muted: "#5E6478", faint: "#9197AB",
  blue: "#3D5AF1", blueWash: "#EAEEFF", line: "#E6E8F0", white: "#FFFFFF",
  green: "#2E7D5B", amber: "#8B5518", red: "#A23E3E", dark: "#111318",
  amberWash: "#FFF1E0", amberEdge: "#F5DDC3", mutedWash: "#F0F2F7",
};

/** The accent: royal blue easing to periwinkle, on one word per screen (the part to glance at). */
export const accent = ["#3D5AF1", "#5F73F3", "#8C8FF4"] as const;
/** Halftone glint on feature cards and the primary pill: blue to lilac, kept faint. */
export const glint = { from: [0.36, 0.48, 0.96], to: [0.7, 0.62, 0.97] } as const;

export const type = {
  display: { fontSize: 32, lineHeight: 38, letterSpacing: -1 },
  greeting: { fontSize: 24, lineHeight: 30, letterSpacing: -0.5, fontWeight: "300" },
  title: { fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
  headline: { fontSize: 17, lineHeight: 23, letterSpacing: -0.2, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 23 },
  footnote: { fontSize: 13, lineHeight: 18 },
  overline: { fontSize: 12, lineHeight: 16, letterSpacing: 0.9, fontWeight: "700", textTransform: "uppercase" },
} as const;
