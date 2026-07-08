import { StyleSheet } from "react-native";
import Markdown from "react-native-markdown-display";

import { highlightClinical, normalizeNoteMarkdown } from "@/lib/pipeline/noteHighlight";
import { colors, fonts } from "@/lib/theme";

// Green clinical theme for the rendered note markdown. Section headings (## …)
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
  // Emphasised clinical terms (vitals, doses, red-flags): green, bold, subtle
  // green highlight behind them so they pop as the scannable data.
  strong: {
    fontWeight: "700",
    color: colors.greenDeep,
    backgroundColor: colors.greenSoft,
  },
  em: { fontStyle: "italic", color: colors.ink2 },
  bullet_list: { marginTop: 2 },
  ordered_list: { marginTop: 2 },
  list_item: { marginBottom: 4 },
  bullet_list_icon: { color: colors.green, marginLeft: 2, marginRight: 8 },
  ordered_list_icon: { color: colors.green, marginLeft: 2, marginRight: 8 },
  code_inline: {
    color: colors.greenDeep,
    backgroundColor: colors.greenSoft,
    borderWidth: 0,
    borderRadius: 4,
  },
  link: { color: colors.green },
  paragraph: { marginTop: 0, marginBottom: 12 },
});

/** Renders a re-identified clinical note (Markdown) with the green clinical theme,
 *  with vitals / doses / red-flags deterministically highlighted. */
export function NoteMarkdown({ markdown }: { markdown: string }) {
  return <Markdown style={noteStyles}>{highlightClinical(normalizeNoteMarkdown(markdown))}</Markdown>;
}
