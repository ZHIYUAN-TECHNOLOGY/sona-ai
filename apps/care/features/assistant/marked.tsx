import { MARK_HUE } from "@sona-ai/domain/answer-parts";
import type { TextStyle } from "react-native";
import { Text } from "@/lib/text";
import { markInk, palette } from "@/lib/theme";
import { marked, type Chosen, type Mark } from "./terms";

/**
 * Each kind of word in the colour it keeps across Sona (answer-parts MARK_HUE, theme `markInk`), never colour alone:
 * every mark is semibold, and a warning (must not miss) is underlined and a caution (check) dotted, so both stand
 * apart for a colour-blind reader. ponytail: React Native draws no underline offset or thickness; add them if it can.
 */
const inkOf = (mark: Mark): TextStyle => {
  const color = markInk[MARK_HUE[mark]];
  return mark === "warning" || mark === "caution" ? { color, textDecorationLine: "underline", textDecorationColor: color, textDecorationStyle: mark === "caution" ? "dotted" : "solid" } : { color };
};

/**
 * An answer's words with its medicines, doses and warning signs in colour (terms.ts), to sit inside a parent Text.
 * Every piece is in `weight` (the app's Text sets a face per piece, so a nested one would fall back to regular); a
 * marked word in body text is semibold too. Past `lit` (voice mode's words not yet spoken) the words stay faint.
 */
export function Marked({ text, medicines, chosen, weight = "400", lit = Infinity }: { text: string; medicines?: string[]; /** The model's own marks (terms.ts); without them the word lists colour. */ chosen?: Chosen[]; weight?: "400" | "600" | "700"; lit?: number }) {
  let at = 0;
  return marked(text, medicines, chosen).flatMap((p, i) => {
    const said = Math.max(0, lit - at);
    at += p.text.length;
    const on = p.text.slice(0, said), off = p.text.slice(said);
    return [
      on && <Text key={`${i}-on`} style={p.mark ? { fontWeight: weight === "400" ? "600" : weight, ...inkOf(p.mark) } : { fontWeight: weight }}>{on}</Text>,
      off && <Text key={`${i}-off`} style={{ fontWeight: weight, color: palette.faint }}>{off}</Text>,
    ];
  });
}
