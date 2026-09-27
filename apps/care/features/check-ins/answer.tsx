import type { Language } from "@sona-ai/domain/discharge";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import Animated, { Easing, LinearTransition, useReducedMotion, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { palette, type } from "@/lib/theme";
import { Button, Chip, field } from "@/lib/ui";
import { answersFor, replyText, type Feeling } from "./model";

/** Each answer's soft tint (after Moods' pills). Tints only: the meaning stays in the words. */
export const TINT: Record<Feeling, { fill: string; face: string; glow: string; line: string }> = {
  better: { fill: "linear-gradient(170deg, #F1FBF6, #D6F1E5)", face: "#2E9C6E", glow: "rgba(61,191,142,0.22)", line: palette.green },
  same: { fill: "linear-gradient(170deg, #F5F2FF, #E4DCFB)", face: "#7F6FE0", glow: "rgba(154,134,240,0.22)", line: palette.ink },
  worse: { fill: "linear-gradient(170deg, #FFF4E8, #FCE0C6)", face: "#C0782E", glow: "rgba(217,138,58,0.24)", line: palette.amber },
};
const MOUTH: Record<Feeling, string> = { better: "M8 14s1.5 2 4 2 4-2 4-2", same: "M8 15h8", worse: "M16 16s-1.5-2-4-2-4 2-4 2" };

/** A small line face in the answer's colour; decorative, the label carries the answer. */
function Face({ feeling, size = 30 }: { feeling: Feeling; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={TINT[feeling].face} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no">
    <Circle cx={12} cy={12} r={10} /><Path d={MOUTH[feeling]} /><Path d="M9 9h.01M15 9h.01" />
  </Svg>;
}

// Motion tokens: layout spring 380 ms with no bounce; entrances ease out; the unchosen pills shrink as they fade.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const rise = (delay: number) => () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ translateY: 8 }] }, animations: { opacity: withDelay(delay, withTiming(1, { duration: 360, easing: EASE_OUT })), transform: [{ translateY: withDelay(delay, withTiming(0, { duration: 360, easing: EASE_OUT })) }] } };
};
const shrink = () => {
  "worklet";
  return { initialValues: { opacity: 1, transform: [{ scale: 1 }] }, animations: { opacity: withTiming(0, { duration: 180, easing: EASE_OUT }), transform: [{ scale: withTiming(0.9, { duration: 260, easing: EASE_OUT }) }] } };
};
const Pill = Animated.createAnimatedComponent(Pressable);

/**
 * How the patient answers a check-in (after Moods' pills that morph open): three tall tinted pills in
 * the check-in's language. The chosen one springs to the full width while the others shrink away, and
 * opens in place into a follow-up with quick replies. Better and same send on a quick reply; worse
 * shows what will be sent first (review before deciding) and keeps the 999 line in view.
 */
export function Answer({ language, feeling, onChoose, busy, onSend }: { language: Language; feeling?: Feeling; onChoose: (feeling: Feeling) => void; busy: boolean; onSend: (text: string, about?: string) => void }) {
  const still = useReducedMotion();
  const [pressed, setPressed] = useState<Feeling>();
  const [review, setReview] = useState<string>();
  const [writing, setWriting] = useState(false);
  const [words, setWords] = useState("");
  const copy = answersFor(language);
  const layout = still ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  const enter = (i: number) => still ? undefined : rise(120 + i * 50);

  return <View style={{ flexDirection: "row", gap: 8 }}>
    {copy.answers.filter(([, f]) => !feeling || f === feeling).map(([text, f]) => {
      const open = f === feeling, follow = copy.follow[f];
      const quick = (q?: string) => {
        if (busy) return;
        if (f !== "worse") return onSend(replyText(text, q), q);
        setReview(q);
        AccessibilityInfo.announceForAccessibility(`${copy.review}: ${replyText(text, q)}`);
      };
      return <Pill key={f} layout={layout} exiting={still ? undefined : shrink}
        accessible={!open} accessibilityRole={open ? undefined : "button"} accessibilityLabel={open ? undefined : text} disabled={open}
        onPressIn={() => setPressed(f)} onPressOut={() => setPressed(undefined)}
        onPress={() => { AccessibilityInfo.announceForAccessibility(`${text}. ${follow.line} ${follow.prompt}`); onChoose(f); }}
        style={[{ flex: 1, minWidth: 0, minHeight: 92, borderRadius: 24, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", overflow: "hidden",
          experimental_backgroundImage: TINT[f].fill, boxShadow: "0 10px 20px -14px rgba(80,60,120,0.5)", transform: [{ scale: pressed === f && !open ? 0.96 : 1 }] },
          open ? { padding: 16, gap: 10 } : { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 6 }]}>
        {open ? <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Face feeling={f} size={22} /><Text style={{ ...type.headline, color: palette.ink }}>{text}</Text></View>
          <Animated.View entering={enter(0)}><Text style={{ ...type.body, fontWeight: "700", color: TINT[f].line }}>{follow.line}</Text></Animated.View>
          {review ? <Animated.View entering={enter(0)} style={{ gap: 10 }}>
            <View accessible style={{ gap: 2 }}>
              <Text style={{ ...type.footnote, fontWeight: "700", color: palette.muted }}>{copy.review}</Text>
              <Text style={{ ...type.headline, color: palette.ink }}>{replyText(text, review)}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><Button label={copy.sendNow} busy={busy} onPress={() => onSend(replyText(text, review), review)} /></View>
              <View style={{ flex: 1 }}><Button quiet label={copy.change} disabled={busy} onPress={() => setReview(undefined)} /></View>
            </View>
          </Animated.View>
          : writing ? <Animated.View entering={enter(0)} style={{ gap: 10 }}>
            <TextInput value={words} onChangeText={setWords} placeholder={copy.placeholder} placeholderTextColor={palette.muted} multiline autoFocus maxLength={900}
              accessibilityLabel={copy.more} style={{ ...field, minHeight: 96, paddingTop: 12, textAlignVertical: "top" }} />
            <Button label={copy.send} busy={busy} disabled={!words.trim()} onPress={() => onSend(replyText(text, words))} />
          </Animated.View>
          : <>
            <Animated.View entering={enter(1)}><Text style={{ ...type.body, color: palette.muted }}>{follow.prompt}</Text></Animated.View>
            <Animated.View entering={enter(2)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {follow.quick.map(q => <Chip key={q} label={q} onPress={() => quick(q)} />)}
              {follow.none && <Chip label={follow.none} onPress={() => quick()} />}
            </Animated.View>
            <Animated.View entering={enter(3)}>
              <Pressable accessibilityRole="button" onPress={() => setWriting(true)} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
                <Text style={{ ...type.body, fontWeight: "600", color: palette.blue }}>{copy.more}</Text>
              </Pressable>
            </Animated.View>
            {busy && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
          </>}
          {f === "worse" && <Text style={{ ...type.footnote, fontWeight: "700", color: palette.red }}>{copy.urgent}</Text>}
        </> : <>
          <Face feeling={f} />
          <Text style={{ fontSize: 15, lineHeight: 19, fontWeight: "700", color: palette.ink, textAlign: "center" }}>{text}</Text>
        </>}
      </Pill>;
    })}
  </View>;
}
