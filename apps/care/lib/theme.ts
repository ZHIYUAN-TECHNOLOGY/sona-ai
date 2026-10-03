/**
 * Sona Care's tokens (the AI Health Companion kit's style guide, 27 Sep 2026): a #FAFAFA canvas under
 * a lilac and mint aurora, near-white cards on a #F5F5F5 hairline, content in three greys (#1F1F1F,
 * #4E4E4E, #646462), the kit's blue for the next step, and its green and orange for done and soon.
 * Every content grey reads at 4.5:1 or more on the canvas, the cards and the washes (the kit's #979795
 * measured 2.6–2.9:1); `pale` keeps the kit's grey for decoration only (placeholders, chevrons, idle dots).
 * State colours keep their meaning: bright bases (500) fill dots, bars and badges; darker shades (700)
 * carry text so it stays readable. Red stays for "call the hospital now".
 */
export const palette = {
  canvas: "#FAFAFA", surface: "#FFFFFF", card: "#FAFAFA", ink: "#1F1F1F", muted: "#4E4E4E", faint: "#646462", pale: "#979795",
  blue: "#2563EB", blueWash: "#EFF6FF", line: "#F5F5F5", white: "#FFFFFF",
  green: "#15803D", amber: "#C2410C", red: "#C81E2E", dark: "#1F1F1F",
  amberWash: "#FFF7ED", amberEdge: "#FED7AA", redWash: "#FEF2F2", redEdge: "#FECACA", mutedWash: "#F5F5F5", greenWash: "#F0FDF4",
  azure: "#2563EB", violet: "#9333EA",
  // Fills (dots, bars, badges), never text: the kit's 500 shades.
  success: "#22C55E", warning: "#F97316", error: "#EF4444", feature: "#A855F7", info: "#3B82F6", away: "#FB923C",
};

/** Sona Care's headline gradient (the user's pick, 27 Sep): ink easing through azure into violet across the bold line. */
export const accent = ["#1F1F1F", "#2563EB", "#9333EA"] as const;
/** Halftone glint (cards, the feature card): azure to violet, kept faint. */
export const glint = { from: [0.145, 0.388, 0.922], to: [0.576, 0.2, 0.918] } as const;

// Type after the kit (Header/Medium 28/32 −7 %, Body/xl 18/26…), with body kept at 17 pt for patients.
export const type = {
  display: { fontSize: 28, lineHeight: 34, letterSpacing: -1.6, fontWeight: "600" },
  greeting: { fontSize: 20, lineHeight: 28, letterSpacing: -0.6, fontWeight: "400" },
  title: { fontSize: 24, lineHeight: 28, letterSpacing: -1 },
  headline: { fontSize: 17, lineHeight: 23, letterSpacing: -0.4, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 24, letterSpacing: -0.3 },
  footnote: { fontSize: 14, lineHeight: 19, letterSpacing: -0.2 },
  overline: { fontSize: 12, lineHeight: 16, letterSpacing: 0.6, fontWeight: "600", textTransform: "uppercase" },
} as const;

/**
 * Spacing on a 4 pt grid: `edge` screen sides, `top` above the first row, `stack` between blocks on a
 * screen, `section` from a header row to the first section head (stack + 8, so a head reads as new).
 */
export const space = { edge: 20, top: 8, stack: 16, section: 24 } as const;

/** Motion shared by every screen: the layout spring (no bounce) and the kit's gentle press. */
export const motion = { spring: { duration: 380, dampingRatio: 1 }, pop: { duration: 380, dampingRatio: 0.72 }, stagger: 40, press: 0.96 } as const;
