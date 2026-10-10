import { Text } from "@/lib/text";
import { palette } from "@/lib/theme";
import { marked, type Mark } from "./terms";

/** Each kind of word in the colour it keeps across Sona Care: blue a medicine (as the plan's "new" tag), violet how much and when, red a warning. */
const INK: Record<Mark, string> = { medicine: palette.blue, dose: palette.violet, warning: palette.red };

/**
 * An answer's words with its medicines, doses and warning signs in colour (terms.ts), to sit inside a parent Text.
 * Every piece is in `weight` (the app's Text sets a face per piece, so a nested one would fall back to regular); a
 * marked word in body text is semibold too. Past `lit` (voice mode's words not yet spoken) the words stay faint.
 */
export function Marked({ text, medicines, weight = "400", lit = Infinity }: { text: string; medicines?: string[]; weight?: "400" | "600" | "700"; lit?: number }) {
  let at = 0;
  return marked(text, medicines).flatMap((p, i) => {
    const said = Math.max(0, lit - at);
    at += p.text.length;
    const on = p.text.slice(0, said), off = p.text.slice(said);
    return [
      on && <Text key={`${i}-on`} style={p.mark ? { fontWeight: weight === "400" ? "600" : weight, color: INK[p.mark] } : { fontWeight: weight }}>{on}</Text>,
      off && <Text key={`${i}-off`} style={{ fontWeight: weight, color: palette.faint }}>{off}</Text>,
    ];
  });
}
