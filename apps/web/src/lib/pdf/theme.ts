import { professionalTheme } from "./themes/professional";
import type { PdfcnTheme } from "./themes/theme-types";

// Noto Sans covers English and Malay, Noto Sans SC the Chinese leaflet; both are registered by render.tsx.
const FONT = "Noto Sans, Noto Sans SC, sans-serif";

/** pdfcn's professional theme in Sona's colours and type: sans headings, no serif, the web app's ink and blue. */
export const sonaTheme: PdfcnTheme = {
  ...professionalTheme,
  name: "sona",
  colors: {
    ...professionalTheme.colors,
    foreground: "#1D1F23",
    primary: "#1D1F23",
    mutedForeground: "#59616B",
    accent: "#245BCC",
    info: "#245BCC",
    border: "#D8DBE0",
    warning: "#8A5A00",
  },
  typography: {
    body: { fontFamily: FONT, fontSize: 10.5, lineHeight: 1.5 },
    heading: { ...professionalTheme.typography.heading, fontFamily: FONT, fontSize: { h1: 22, h2: 15, h3: 12.5, h4: 11, h5: 10.5, h6: 10 } },
  },
};
