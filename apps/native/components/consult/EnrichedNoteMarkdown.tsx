import { useMemo } from "react";
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";

import { colors, fonts } from "@/lib/theme";

// Native (Fabric) renderer for the consult note — react-native-enriched-markdown's
// display component. Same green clinical theme as the JS fallback renderer, plus
// what only the native surface gives us: real text selection with "Copy as
// Markdown", and a fade-in streaming mode for the live draft.
//
// The three-colour clinical highlight system maps onto the library's channels:
//   **strong**  → doses & vitals   → deep green, bold
//   *em*        → timeframes       → blue, non-italic
//   `code`      → red-flag symptom → red on soft red (the danger chip)
// StrongStyle/EmphasisStyle carry no backgroundColor, so green/blue read as
// coloured text rather than tinted chips — the red danger chip is preserved.
const noteMarkdownStyle: MarkdownStyle = {
  paragraph: { fontSize: 15, lineHeight: 22, color: colors.ink2, marginTop: 0, marginBottom: 12 },
  h1: { fontFamily: fonts.display, fontWeight: "normal", fontSize: 22, color: colors.ink, marginTop: 4, marginBottom: 8 },
  // Section labels ("## SUBJECTIVE") — the markdown is uppercased below because
  // HeadingStyle has no textTransform.
  h2: { fontSize: 12, fontWeight: "700", color: colors.green, marginTop: 18, marginBottom: 4 },
  h3: { fontSize: 13, fontWeight: "700", color: colors.green, marginTop: 12, marginBottom: 4 },
  list: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink2,
    bulletColor: colors.green,
    markerColor: colors.green,
    marginTop: 2,
    marginBottom: 4,
    gapWidth: 8,
  },
  strong: { fontWeight: "bold", color: colors.greenDeep },
  em: { fontStyle: "normal", color: colors.blue },
  code: { fontFamily: undefined, color: colors.red, backgroundColor: colors.red50 },
  link: { color: colors.green },
};

// Uppercase the "## " section labels at render time (presentation only — the
// stored markdown keeps its natural case for export and editing).
function uppercaseSectionHeadings(markdown: string): string {
  return markdown.replace(/^(##\s+)(.+)$/gm, (_, mark: string, label: string) => mark + label.toUpperCase());
}

export function EnrichedNoteMarkdown({
  markdown,
  streaming = false,
}: {
  markdown: string;
  streaming?: boolean;
}) {
  const display = useMemo(() => uppercaseSectionHeadings(markdown), [markdown]);
  return (
    <EnrichedMarkdownText
      markdown={display}
      markdownStyle={noteMarkdownStyle}
      flavor="commonmark"
      streamingAnimation={streaming}
      selectable
    />
  );
}
