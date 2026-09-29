export const palette = {
  canvas: "#F5F6F8", surface: "#FFFFFF", ink: "#1D1F23", muted: "#59616B",
  blue: "#245BCC", blueWash: "#D5E5FC", line: "#D8DBE0", white: "#FFFFFF",
  // One green for done, safe and ready (the teal the seals and ticks always used); one grey for placeholder text.
  green: "#0F6E66", amber: "#8B5518", red: "#A23E3E", dark: "#282C33", placeholder: "#8A929E",
};

/**
 * Type scale (iOS-sized, named by use). Headings tighten and track slightly negative; body text
 * sits at 1.5; small caps labels track positive. Deviate only for display numerals (timers, clocks).
 */
export const type = {
  display: { fontSize: 27, lineHeight: 35, letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 31, letterSpacing: -0.45 },
  heading: { fontSize: 19, lineHeight: 25, letterSpacing: -0.3, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 23, letterSpacing: -0.2, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 24 },
  callout: { fontSize: 15, lineHeight: 21 },
  subhead: { fontSize: 14, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
  overline: { fontSize: 11, lineHeight: 14, letterSpacing: 0.8, fontWeight: "700", textTransform: "uppercase" },
} as const;
