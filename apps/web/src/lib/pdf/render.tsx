import type { ReactElement } from "react";

import { PdfcnThemeProvider } from "@/components/pdf/theme-provider";

import { sonaTheme } from "./theme";

// Takumi margins are CSS px; the page is A4 with 18 mm on every side.
const mm = (n: number) => (n * 96) / 25.4;

type Fonts = Awaited<ReturnType<typeof import("@takumi-rs/helpers").googleFonts>>;
let fonts: Promise<Fonts> | undefined;

// Google's Noto Sans slices leave out glyphs the font has and Sona Med writes ("SpO₂", "⅓ tablet"), and the engine
// refuses a character no font covers; so these come as one more small slice of just them (css2's `text=`).
export const CLINICAL_GLYPHS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎½⅓⅔¼¾⅕⅙⅛°µμ±×÷≈≠≤≥←→↑↓↔";

// Fetched once per session. When Google Fonts is unreachable the engine's default font still sets
// English and Malay, so the download is not lost; the next click tries the fonts again.
function loadFonts() {
  fonts ??= import("@takumi-rs/helpers")
    .then(h => Promise.all([
      h.googleFonts(["Noto Sans", "Noto Sans SC"]),
      h.googleFonts({ families: ["Noto Sans"], baseUrl: `https://fonts.googleapis.com/css2?text=${encodeURIComponent(CLINICAL_GLYPHS)}` }),
    ]))
    .then(lists => lists.flat())
    .catch(() => { fonts = undefined; return [] as Fonts; });
  return fonts;
}

export interface RenderPdfOptions { title: string; landscape?: boolean }

/**
 * Renders a pdfcn document to PDF bytes in the browser. The engine (about 4 MB of WebAssembly) is
 * imported on the first call, not at page load; Vite serves its wasm by `?url` and the package's
 * entry initialises itself before `render` is reachable.
 */
export async function renderPdf(doc: ReactElement, { title, landscape }: RenderPdfOptions) {
  const [{ render }, { PageNumber, TotalPages }, fontList] = await Promise.all([import("takumi-pdf"), import("takumi-pdf/primitives"), loadFonts()]);
  const bytes = await render(<PdfcnThemeProvider theme={sonaTheme}>{doc}</PdfcnThemeProvider>, {
    size: "a4",
    landscape,
    margin: mm(18),
    fonts: fontList,
    footer: (
      <div style={{ display: "flex", justifyContent: "center", padding: `${mm(6)}px ${mm(18)}px`, fontFamily: sonaTheme.typography.body.fontFamily, fontSize: 8.5, color: sonaTheme.colors.mutedForeground }}>
        {title} · Page <PageNumber /> of <TotalPages /> · Sona
      </div>
    ),
  });
  return { bytes, blob: new Blob([bytes as BlobPart], { type: "application/pdf" }) };
}

/** Saves a blob through a one-off anchor click; the object URL is revoked once the click has fired. */
export function downloadPdf(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
