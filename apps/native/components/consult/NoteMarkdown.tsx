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

/** Renders a re-identified clinical note (Markdown) with the green clinical theme.
 *  Doses/vitals/timeframes are highlighted deterministically; red-flag symptoms come
 *  from the model's context-aware `redFlags` (hybrid highlighter), falling back to a
 *  lexicon when absent. */
export function NoteMarkdown({ markdown, redFlags }: { markdown: string; redFlags?: string[] }) {
  return (
    <Markdown style={noteStyles}>
      {highlightClinical(normalizeNoteMarkdown(markdown), redFlags)}
    </Markdown>
  );
}
