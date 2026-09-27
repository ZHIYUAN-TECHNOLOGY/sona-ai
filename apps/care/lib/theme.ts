/**
 * Sona Care's tokens, Dawn (reviewed 27 Sep 2026): the clinician app's system (glass, ink type, one
 * accent word) in the Dawn pearl's colours, for a warmer, more hopeful feel. Red, amber and green keep
 * their meaning (must-not-miss, soon, done); emergency text never takes the sunrise tint.
 */
export const palette = {
  canvas: "#FBF8F7", surface: "#FFFFFF", ink: "#1B1A26", muted: "#5F5A6E", faint: "#8A8698",
  blue: "#3E5FD8", blueWash: "#ECE7FF", line: "#E4E0EA", white: "#FFFFFF",
  green: "#2E7D5B", amber: "#8B5518", red: "#A23E3E", dark: "#211E33",
};

/** The Dawn accent: rose to violet to blue, on one word per screen (the part to glance at). */
export const dawn = ["#EE8FB2", "#8E7FEA", "#5B7FEA"] as const;
/** Halftone glint on feature cards and the primary pill: peach, rose, violet. */
export const glint = { from: [1, 0.7, 0.54], to: [0.56, 0.56, 0.94] } as const;

export const type = {
  display: { fontSize: 32, lineHeight: 38, letterSpacing: -1 },
  greeting: { fontSize: 24, lineHeight: 30, letterSpacing: -0.5, fontWeight: "300" },
  title: { fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
  headline: { fontSize: 17, lineHeight: 23, letterSpacing: -0.2, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 23 },
  footnote: { fontSize: 13, lineHeight: 18 },
  overline: { fontSize: 12, lineHeight: 16, letterSpacing: 0.9, fontWeight: "700", textTransform: "uppercase" },
} as const;
