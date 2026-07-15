import type { ReactElement } from "react";
import { StyleSheet, UIManager } from "react-native";
import Markdown from "react-native-markdown-display";

import { NativeFallbackBoundary } from "@/components/consult/NativeFallbackBoundary";
import { highlightClinical, normalizeNoteMarkdown } from "@/lib/pipeline/noteHighlight";
import { colors, fonts } from "@/lib/theme";

// Green clinical theme for the JS-fallback note renderer. Section headings (## …)
// read as our small green uppercase labels; **bold** highlights key findings;
// bullets are green. Pure-JS renderer (react-native Text/View) — no native module.
const noteStyles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22, color: colors.ink2 },
  heading1: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginTop: 4,
    marginBottom: 8,
  },
  heading2: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.green,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 18,
    marginBottom: 4,
  },
  heading3: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.green,
    marginTop: 12,
    marginBottom: 4,
  },
  // Three-colour clinical highlight system (set by highlightClinical):
  //  strong = doses & vitals → green (clinical values)
  strong: {
    fontWeight: "700",
    color: colors.greenDeep,
    backgroundColor: colors.greenSoft,
  },
  //  em = timeframes → blue (the "when"). Non-italic; colour + weight carry it.
  em: {
    fontStyle: "normal",
    fontWeight: "600",
    color: colors.blue,
    backgroundColor: colors.blue50,
  },
  bullet_list: { marginTop: 2 },
  ordered_list: { marginTop: 2 },
  list_item: { marginBottom: 4 },
  bullet_list_icon: { color: colors.green, marginLeft: 2, marginRight: 8 },
  ordered_list_icon: { color: colors.green, marginLeft: 2, marginRight: 8 },
  //  code = red-flag symptoms → red (danger). fontFamily undefined so it renders
  //  in the body sans, not the renderer's default monospace.
  code_inline: {
    fontFamily: undefined,
    fontWeight: "700",
    color: colors.red,
    backgroundColor: colors.red50,
    borderWidth: 0,
    borderRadius: 4,
  },
  link: { color: colors.green },
  paragraph: { marginTop: 0, marginBottom: 12 },
});

function PlainNoteMarkdown({ markdown }: { markdown: string }): ReactElement {
  return <Markdown style={noteStyles}>{markdown}</Markdown>;
}

// Prefer the NATIVE renderer (react-native-enriched-markdown) — proper text layout,
// selection with "Copy as Markdown", streaming fade-in — and fall back to the JS
// renderer when the Fabric component isn't compiled into this binary. Same three
// guards as NoteEditor (an unregistered Fabric view fails SILENTLY):
//   1. require() try/catch, 2. hasViewManagerConfig, 3. render error boundary.
const RICH_COMPONENT = "EnrichedMarkdownText";

type EnrichedProps = { markdown: string; streaming?: boolean };
let EnrichedNoteMarkdown: ((props: EnrichedProps) => ReactElement) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  EnrichedNoteMarkdown = require("./EnrichedNoteMarkdown").EnrichedNoteMarkdown;
} catch {
  EnrichedNoteMarkdown = null; // package JS failed to import
}

let registered: boolean | null = null;
function isRichRegistered(): boolean {
  if (registered !== null) return registered;
  try {
    registered = !!UIManager.hasViewManagerConfig?.(RICH_COMPONENT);
  } catch {
    registered = false;
  }
  return registered;
}

/** Renders a re-identified clinical note (Markdown) with the green clinical theme.
 *  Doses/vitals/timeframes are highlighted deterministically; red-flag symptoms come
 *  from the model's context-aware `redFlags` (hybrid highlighter), falling back to a
 *  lexicon when absent. `streaming` renders with the native fade-in animation (live
 *  draft); highlighting is skipped there — partial lines misfire the lexicon. */
export function NoteMarkdown({
  markdown,
  redFlags,
  streaming = false,
}: {
  markdown: string;
  redFlags?: string[];
  streaming?: boolean;
}): ReactElement {
  const display = streaming
    ? normalizeNoteMarkdown(markdown)
    : highlightClinical(normalizeNoteMarkdown(markdown), redFlags);
  if (!EnrichedNoteMarkdown || !isRichRegistered()) return <PlainNoteMarkdown markdown={display} />;
  const Enriched = EnrichedNoteMarkdown;
  return (
    <NativeFallbackBoundary
      fallback={<PlainNoteMarkdown markdown={display} />}
      onError={(e) => console.warn("[NoteMarkdown] native renderer failed, using JS:", e?.message)}
    >
      <Enriched markdown={display} streaming={streaming} />
    </NativeFallbackBoundary>
  );
}
