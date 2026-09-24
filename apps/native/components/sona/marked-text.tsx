import type { ReactNode } from "react";
import type { StyleProp, TextStyle } from "react-native";
import { Text } from "./text";

/**
 * Colour-coded key terms in AI text (after entity-tag UIs): a quiet tint behind symptoms,
 * medicines, cautions and findings so a clinician's eye lands on them first. Terms come from
 * explicit `[[text|kind]]` markup (what a model response would emit) or a small clinical
 * dictionary. Plain text and screen-reader output are unchanged.
 *
 * ponytail: dictionary matching is a prototype stand-in; the backend should emit markup (or
 * react-native-enriched-markdown `linkVariants`) once responses are generated.
 */
export type Mark = "symptom" | "medicine" | "caution" | "finding";
const TINT: Record<Mark, { color: string; backgroundColor: string }> = {
  symptom: { color: "#1E4FB8", backgroundColor: "rgba(36,91,204,0.10)" },
  medicine: { color: "#5A3DB8", backgroundColor: "rgba(110,80,210,0.11)" },
  caution: { color: "#8B5518", backgroundColor: "rgba(196,120,20,0.14)" },
  finding: { color: "#0F6E66", backgroundColor: "rgba(20,140,130,0.12)" },
};
const DICTIONARY: [RegExp, Mark][] = [
  [/\b(cough|fever|breathlessness|wheeze|wheezing|rash|chest pain|shortness of breath)\b/gi, "symptom"],
  [/\b(salbutamol|albuterol|cetirizine|paracetamol|penicillin|beta-blockers?|inhaler)\b/gi, "medicine"],
  [/\b(unconfirmed|not confirmed|needs confirmation|missing|blocked|allerg(?:y|ic)|unknown|not yet documented|interrupted)\b/gi, "caution"],
  [/\b(pneumonia|asthma|respiratory review)\b/gi, "finding"],
];

type Segment = { text: string; mark?: Mark };
export function segments(input: string): Segment[] {
  // Explicit markup first, then dictionary terms inside the plain runs.
  const out: Segment[] = [];
  const markup = /\[\[(.+?)\|(symptom|medicine|caution|finding)\]\]/g;
  let last = 0;
  const plain = (text: string) => {
    const hits: { start: number; end: number; mark: Mark }[] = [];
    for (const [pattern, mark] of DICTIONARY) for (const m of text.matchAll(pattern)) {
      const start = m.index!, end = start + m[0].length;
      if (!hits.some(h => start < h.end && end > h.start)) hits.push({ start, end, mark });
    }
    hits.sort((a, b) => a.start - b.start);
    let at = 0;
    for (const h of hits) { if (h.start > at) out.push({ text: text.slice(at, h.start) }); out.push({ text: text.slice(h.start, h.end), mark: h.mark }); at = h.end; }
    if (at < text.length) out.push({ text: text.slice(at) });
  };
  for (const m of input.matchAll(markup)) { plain(input.slice(last, m.index)); out.push({ text: m[1]!, mark: m[2] as Mark }); last = m.index! + m[0].length; }
  plain(input.slice(last));
  return out;
}

/** Words as MarkedText counts them (segment-aware), for driving `shown` while streaming. */
export const wordCount = (text: string) => segments(text).reduce((n, seg) => n + seg.text.split(/\s+/).filter(Boolean).length, 0);

/**
 * Renders text with marked terms. `shown` reveals only the first N words (streaming); hidden words
 * keep their space so the paragraph never reflows as it streams in.
 */
export function MarkedText({ text, style, shown, selectable = true }: { text: string; style?: StyleProp<TextStyle>; shown?: number; selectable?: boolean }) {
  let word = 0;
  const reveal = (token: string, key: string) => {
    if (!token.trim()) return token;
    const visible = shown === undefined || word < shown;
    word += 1;
    return shown === undefined ? token : <Text key={key} style={{ opacity: visible ? 1 : 0 }}>{token}</Text>;
  };
  // Tint each word on its own and keep the spaces between words untinted: a line break then falls
  // on a plain space, so a multi-word term ("respiratory review") never paints past the end of a line.
  const parts: ReactNode[] = segments(text).map((seg, i) => {
    const tokens = seg.text.split(/(\s+)/).map((token, j) => {
      const shownToken = reveal(token, `${i}-${j}`);
      if (!seg.mark || !token.trim()) return shownToken;
      return <Text key={`${i}-${j}`} style={[TINT[seg.mark], { fontWeight: "500" }]}>{"\u202F"}{shownToken}{"\u202F"}</Text>;
    });
    return <Text key={i}>{tokens}</Text>;
  });
  return <Text selectable={selectable} style={style}>{parts}</Text>;
}
