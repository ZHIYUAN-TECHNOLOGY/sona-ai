import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, type StyleProp, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { segments, type Mark } from "./marked-terms";
import { Text } from "./text";

export { segments, wordCount, type Mark } from "./marked-terms";

/**
 * Colour-coded key terms in clinical text (after entity-tag UIs): a quiet tint behind the words a
 * clinician must see first. The rules live in marked-terms.ts; plain text and screen-reader
 * output are unchanged.
 */
export const TINT: Record<Mark, { color: string; backgroundColor: string }> = {
  alert: { color: "#A23E3E", backgroundColor: "rgba(162,62,62,0.12)" },
  medicine: { color: "#5A3DB8", backgroundColor: "rgba(110,80,210,0.11)" },
  finding: { color: "#0F6E66", backgroundColor: "rgba(20,140,130,0.12)" },
  symptom: { color: "#1E4FB8", backgroundColor: "rgba(36,91,204,0.10)" },
  caution: { color: "#8B5518", backgroundColor: "rgba(196,120,20,0.14)" },
};

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

/**
 * Lead paragraph laid out word by word so key terms can be real rounded chips, and a highlight
 * (after Threads' lyric sync) can travel between them: once the text has streamed in, a tinted
 * block springs from term to term (0.38 s, damping 0.82), each chip tinting as the block lands,
 * then the block fades and the chips remain. `shown` reveals words as they stream.
 */
export function SweptLead({ text, shown, sweep: sweepProp, style }: { text: string; shown: number; sweep: boolean; style: TextStyle }) {
  // Decided when the answer first appears; the request finishing mid-sweep must not cut it short.
  const [sweep] = useState(sweepProp);
  // Punctuation that follows a term (the "." in "review.") rides with that word instead of taking a gap.
  const words = useMemo(() => {
    const out: { word: string; mark?: Mark; tail: string }[] = [];
    let prevEndsSpace = true;
    for (const seg of segments(text)) {
      // Only text that touches the previous segment with no space between (e.g. "review" + ".") is glued.
      const touching = !prevEndsSpace && !/^\s/.test(seg.text);
      prevEndsSpace = /\s$/.test(seg.text);
      seg.text.split(/\s+/).filter(Boolean).forEach((word, j) => {
        const glued = j === 0 && touching && out.length > 0;
        if (glued) { out[out.length - 1]!.tail += word; return; }
        out.push({ word, mark: seg.mark, tail: "" });
      });
    }
    return out;
  }, [text]);
  const marked = useMemo(() => words.flatMap((w, i) => (w.mark ? [i] : [])), [words]);
  // Chip frames are measured inside each word's row; rows give the offset within the paragraph.
  const rows = useRef<Record<number, { x: number; y: number }>>({});
  const chips = useRef<Record<number, { x: number; y: number; width: number; height: number }>>({});
  // Chips tint once the block has reached them; without a sweep they are tinted from the start.
  const [lit, setLit] = useState(sweep ? -1 : Infinity);
  const [blockColor, setBlockColor] = useState<string>();
  const bx = useSharedValue(0), by = useSharedValue(0), bw = useSharedValue(0), bh = useSharedValue(0), bo = useSharedValue(0);
  const done = shown >= words.length;
  useEffect(() => {
    if (!sweep || !done || !marked.length) { if (!sweep) setLit(Infinity); return; }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const SPRING = { duration: 380, dampingRatio: 0.82 };
    marked.forEach((index, step) => timers.push(setTimeout(() => {
      const row = rows.current[index], chip = chips.current[index];
      if (!row || !chip) return;
      const f = { x: row.x + chip.x, y: row.y + chip.y, width: chip.width, height: chip.height };
      if (step === 0) { bx.set(f.x); by.set(f.y); bw.set(f.width); bh.set(f.height); bo.set(withTiming(1, { duration: 160 })); }
      else { bx.set(withSpring(f.x, SPRING)); by.set(withSpring(f.y, SPRING)); bw.set(withSpring(f.width, SPRING)); bh.set(withSpring(f.height, SPRING)); }
      setBlockColor(TINT[words[index]!.mark!].backgroundColor.replace(/0\.1\d?\)$/, "0.26)"));
      timers.push(setTimeout(() => setLit(index), 200));
    }, 120 + step * 420)));
    timers.push(setTimeout(() => bo.set(withTiming(0, { duration: 260 })), 120 + marked.length * 420));
    return () => timers.forEach(clearTimeout);
  }, [sweep, done, marked, words, bx, by, bw, bh, bo]);
  const block = useAnimatedStyle(() => ({ opacity: bo.value, transform: [{ translateX: bx.value }, { translateY: by.value }], width: bw.value, height: bh.value }));
  const wordGap = (style.fontSize ?? 16) * 0.26;
  return <View accessible accessibilityLabel={segments(text).map(s => s.text).join("")} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: wordGap }}>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, borderRadius: 8, borderCurve: "continuous", backgroundColor: blockColor, transitionProperty: "backgroundColor", transitionDuration: 200 } as never, block]} />
    {words.map((w, i) => {
      const on = w.mark && i <= lit;
      const fade = { opacity: i < shown ? 1 : 0, transitionProperty: "opacity", transitionDuration: 160 } as never;
      return <View key={i} onLayout={w.mark ? e => { rows.current[i] = e.nativeEvent.layout; } : undefined} style={{ flexDirection: "row" }}>
        <View onLayout={w.mark ? e => { chips.current[i] = e.nativeEvent.layout; } : undefined}
          style={[w.mark && { paddingHorizontal: 4, marginHorizontal: -4, borderRadius: 8, borderCurve: "continuous" }, w.mark && { backgroundColor: on ? TINT[w.mark].backgroundColor : "transparent", transitionProperty: "backgroundColor", transitionDuration: 220 } as never]}>
          <Text style={[style, fade, w.mark && { color: on ? TINT[w.mark].color : style.color, fontWeight: "500", transitionProperty: ["opacity", "color"], transitionDuration: 220 } as never]}>{w.word}</Text>
        </View>
        {!!w.tail && <Text style={[style, fade]}>{w.tail}</Text>}
      </View>;
    })}
  </View>;
}

/** The colour key: each tint once, labelled with what it means. */
const KEY: [Mark, string][] = [["alert", "Must not miss"], ["medicine", "Medicine"], ["finding", "Diagnosis"], ["symptom", "Symptom"], ["caution", "Unconfirmed"]];
export function TermLegend() {
  return <View accessible accessibilityLabel={`Colour key: ${KEY.map(([m, label]) => `${label} ${m === "alert" ? "red" : m === "medicine" ? "violet" : m === "finding" ? "teal" : m === "symptom" ? "blue" : "amber"}`).join(", ")}`}
    style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
    {KEY.map(([mark, label]) => <View key={mark} style={{ paddingHorizontal: 8, height: 24, borderRadius: 8, borderCurve: "continuous", justifyContent: "center", backgroundColor: TINT[mark].backgroundColor }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: TINT[mark].color }}>{label}</Text>
    </View>)}
  </View>;
}
