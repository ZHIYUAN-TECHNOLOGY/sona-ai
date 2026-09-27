/**
 * Sona Care's tokens (after the Life OS style guide, AlignUI tokens, 27 Sep 2026): white and cool-grey
 * surfaces under a blue liquid hero, near-black ink (#0E121B), a sub grey (#525866), a soft grey
 * (#99A0AE), Life OS blue (#335CFF) for actions and the next step. State colours keep their meaning:
 * the bright bases fill dots, bars and badges; darker shades carry text so it stays readable.
 */
export const palette = {
  canvas: "#F5F7FB", surface: "#FFFFFF", ink: "#0E121B", muted: "#525866", faint: "#99A0AE",
  blue: "#335CFF", blueWash: "#EBF1FF", line: "#E1E4EA", white: "#FFFFFF",
  green: "#15803D", amber: "#B45309", red: "#C81E2E", dark: "#0E121B",
  amberWash: "#FFF1EB", amberEdge: "#FFD5C0", mutedWash: "#F2F5F8",
  // Fills (dots, bars, badges), never text: AlignUI state bases.
  success: "#1FC16B", warning: "#FF8447", error: "#FB3748", feature: "#7D52F4", info: "#335CFF", away: "#F6B51E",
};

/** The accent: Life OS blue easing to violet, on one word per screen (the part to glance at). */
export const accent = ["#335CFF", "#5A5EF7", "#7D52F4"] as const;
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
