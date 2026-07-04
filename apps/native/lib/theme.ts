// Sona consult-flow design tokens.
//
// Ported verbatim from the white + clinical-green prototype
// (docs/superpowers/visuals/sona-slice-prototype-green.html). The consult flow
// is a fixed light theme regardless of the OS colour scheme — this is the face
// of the demo and must read identically to the prototype. Do not wire these into
// useColorScheme; the flow is intentionally light-only.

export const colors = {
  bg: "#ffffff",
  surface: "#f5f9f7",
  surface2: "#eef4f0",
  line: "#e4ebe7",
  lineStrong: "#cddbd3",

  ink: "#0b1e16",
  ink2: "#42534b",
  ink3: "#5f6d64",

  green: "#0e7c52",
  greenDeep: "#0a5c3e",
  greenInk: "#0a3d2b",
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

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 999,
  phone: 46,
} as const;

// 4pt-ish spacing scale matching the prototype's tight phone padding.
export const space = {
  xs: 4,
  sm: 6,
  md: 9,
  lg: 13,
  xl: 17,
  xxl: 24,
} as const;

export const font = {
  // Section labels / SOAP headings.
  overline: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
  },
  cardHeading: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  cardBody: {
    fontSize: 11.5,
    lineHeight: 17,
  },
  micro: {
    fontSize: 10.5,
  },
  title: {
    fontSize: 16,
    fontWeight: "600" as const,
    letterSpacing: -0.16,
  },
  sub: {
    fontSize: 11,
  },
} as const;

// A soft green-tinted shadow used on primary buttons / the raised record tab.
export const glowShadow = {
  shadowColor: colors.green,
  shadowOpacity: 0.28,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 8 },
  elevation: 6,
} as const;

export const theme = { colors, radius, space, font, glowShadow } as const;
export type Theme = typeof theme;
