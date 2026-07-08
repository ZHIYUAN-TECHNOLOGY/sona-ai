// Sona design tokens — v2 "editorial calm, clinical-green".
//
// Heidi-inspired spatial system (generous 8pt spacing, soft radii, a serif
// display face) kept on our green identity. Fixed light theme regardless of the
// OS colour scheme — this is the face of the demo. Do NOT wire these into
// useColorScheme; the app is intentionally light-only.
//
// Fraunces (the serif display) is loaded at runtime via useFonts in
// app/_layout.tsx; reference the family names in `fonts`.

export const fonts = {
  // Serif display — screen titles + hero stats. Weight comes from the family
  // name, so never pair these with a numeric fontWeight (avoids faux-bold).
  display: "Fraunces_600SemiBold",
  displayMedium: "Fraunces_500Medium",
  displayRegular: "Fraunces_400Regular",
} as const;

export const colors = {
  // Warmed near-white paper with a faint green tint (was flat #ffffff).
  bg: "#f8faf7",
  paper: "#f8faf7",
  card: "#ffffff",
  surface: "#f0f5f2",
  surface2: "#e9f1ec",
  line: "#e2ebe6",
  lineStrong: "#cddbd3",

  ink: "#0b1e16",
  ink2: "#42534b",
  ink3: "#5f6d64",

  green: "#0e7c52",
  greenDeep: "#0a5c3e",
  greenInk: "#0a3d2b",
  greenSoft: "#e9f5ef",
  green50: "#e9f5ef",
  green100: "#d2ebde",
  greenGlow: "rgba(14,124,82,0.18)",

  red: "#b42318",
  red50: "#fdf0ee",
  redLine: "#f4d3ce",

  amber: "#8a5a00",
  amber50: "#fdf5e6",
  amberLine: "#f0e0b6",

  blue: "#1f5f8b",
  blue50: "#eaf2f8",
  blueLine: "#cfe0ee",

  white: "#ffffff",
} as const;

// Softer, larger radii for the calmer look.
export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
  phone: 46,
} as const;

// 8pt spacing scale (was a tight 4pt scale) — roomier, more editorial.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const font = {
  // --- Display (Fraunces serif) — no numeric fontWeight alongside fontFamily ---
  hero: { fontFamily: fonts.display, fontSize: 44, lineHeight: 48, letterSpacing: -1 },
  h1: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -0.5 },
  h2: { fontFamily: fonts.display, fontSize: 27, lineHeight: 32, letterSpacing: -0.4 },
  h3: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, letterSpacing: -0.2 },

  // --- Body (system sans) ---
  body: { fontSize: 15, lineHeight: 22 },
  bodySm: { fontSize: 13, lineHeight: 19 },
  label: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
  },

  // --- Legacy keys (kept so existing components compile; migrated in Phase 2) ---
  overline: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
  },
  cardHeading: { fontSize: 12, fontWeight: "600" as const },
  cardBody: { fontSize: 11.5, lineHeight: 17 },
  micro: { fontSize: 10.5 },
  title: { fontSize: 16, fontWeight: "600" as const, letterSpacing: -0.16 },
  sub: { fontSize: 11 },
} as const;

// Modern CSS boxShadow strings (building-native-ui: never legacy RN shadow props).
export const shadow = {
  // Soft card lift.
  card: "0px 1px 3px rgba(11,30,22,0.06)",
  // Green glow reserved for the primary CTA + the record button.
  glow: "0px 8px 20px rgba(14,124,82,0.22)",
} as const;

// Legacy RN shadow object — still used by components not yet migrated to `shadow`.
export const glowShadow = {
  shadowColor: colors.green,
  shadowOpacity: 0.22,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 8 },
  elevation: 6,
} as const;

// Emil-calibrated motion tokens (durations in ms, RN Reanimated easing via cubic-bezier).
export const motion = {
  duration: { press: 140, sheet: 320, title: 220, tab: 180 },
  // Strong ease-out — starts fast, feels responsive (cubic-bezier(0.23,1,0.32,1)).
  easeOut: [0.23, 1, 0.32, 1] as const,
  // iOS drawer curve for sheets.
  easeDrawer: [0.32, 0.72, 0, 1] as const,
  pressScale: 0.97,
} as const;

export const theme = { colors, radius, space, font, fonts, shadow, glowShadow, motion } as const;
export type Theme = typeof theme;
