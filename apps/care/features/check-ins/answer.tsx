import type { Language } from "@sona-ai/domain/discharge";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, View, type ViewStyle } from "react-native";
import { MicButton } from "@/features/assistant/mic";
import { useListen } from "@/lib/listen";
import { Text, TextInput } from "@/lib/text";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, withDelay, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { motion, palette, type } from "@/lib/theme";
import { Button, Chip, field } from "@/lib/ui";
import { answersFor, replyText, type Feeling } from "./model";

/** Each feeling's soft tint (after Moods' pills). Tints only: the meaning stays in the words. */
export const TINT: Record<Feeling, { fill: string; face: string; glow: string; line: string }> = {
  better: { fill: "linear-gradient(170deg, #F1FBF6, #D6F1E5)", face: "#2E9C6E", glow: "rgba(61,191,142,0.22)", line: palette.green },
  same: { fill: "linear-gradient(170deg, #F5F2FF, #E4DCFB)", face: "#7F6FE0", glow: "rgba(154,134,240,0.22)", line: palette.ink },
  worse: { fill: "linear-gradient(170deg, #FFF4E8, #FCE0C6)", face: "#C0782E", glow: "rgba(217,138,58,0.24)", line: palette.amber },
};
// The kit's five faces, happiest first: a wide smile down to a deep frown.
const MOUTHS = ["M7.5 13.5s1.8 3 4.5 3 4.5-3 4.5-3", "M8.5 14.5s1.3 1.5 3.5 1.5 3.5-1.5 3.5-1.5", "M8.5 15.5h7", "M15.5 16.5s-1.3-1.5-3.5-1.5-3.5 1.5-3.5 1.5", "M16.5 17s-1.8-3-4.5-3-4.5 3-4.5 3"];

// Motion tokens: the chosen face springs larger on the kit's pop, the rest settle back; the follow-up rises in.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const rise = (delay: number) => () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ translateY: 8 }] }, animations: { opacity: withDelay(delay, withTiming(1, { duration: 360, easing: EASE_OUT })), transform: [{ translateY: withDelay(delay, withTiming(0, { duration: 360, easing: EASE_OUT })) }] } };
};

/** One round white glass face with its words under it; the chosen one springs larger in its feeling's tint. */
function Face({ index, label, feeling, chosen, dim, disabled, onPress }: { index: number; label: string; feeling: Feeling; chosen: boolean; dim: boolean; disabled: boolean; onPress: () => void }) {
  const still = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const scale = chosen ? 1.16 : pressed ? 0.94 : dim ? 0.92 : 1;
  const lift = useAnimatedStyle(() => ({
    transform: [{ scale: still ? scale : withSpring(scale, motion.pop) }],
    opacity: still ? (dim ? 0.5 : 1) : withTiming(dim ? 0.5 : 1, { duration: 200 }),
  }));
  const stroke = chosen ? TINT[feeling].face : palette.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: chosen, disabled }} disabled={disabled}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} onPress={onPress}
    style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 8, paddingVertical: 4 }}>
    <Animated.View style={[{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)",
      backgroundColor: "rgba(255,255,255,0.75)", boxShadow: "0 8px 18px -12px rgba(80,60,120,0.45)" } as ViewStyle, chosen && { experimental_backgroundImage: TINT[feeling].fill } as ViewStyle, lift]}>
      <Svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no">
        <Circle cx={12} cy={12} r={10} /><Path d={MOUTHS[index]!} /><Path d="M9 9.5h.01M15 9.5h.01" strokeWidth={2.6} />
      </Svg>
    </Animated.View>
    <Text numberOfLines={2} maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 17, fontWeight: chosen ? "700" : "500", color: chosen ? palette.ink : palette.muted, textAlign: "center" }}>{label}</Text>
  </Pressable>;
}

/**
 * How the patient answers a check-in: the kit's five faces in the check-in's language. The chosen face
 * springs larger in its feeling's tint and its follow-up opens in place under the row (after Moods' pill
 * morph); another face can still be picked until the answer is sent. Better and same send on a quick
 * reply; worse shows what will be sent first (review before deciding) and keeps the 999 line in view.
 */
export function Answer({ language, feeling, onChoose, busy, onSend }: { language: Language; feeling?: Feeling; onChoose: (feeling: Feeling) => void; busy: boolean; onSend: (text: string, about?: string) => void }) {
  const [chosen, setChosen] = useState<number>();
  const copy = answersFor(language);
  const picked = chosen === undefined || !feeling ? undefined : copy.answers[chosen];

  return <View style={{ gap: 14 }}>
    <View style={{ flexDirection: "row", gap: 4 }}>
      {copy.answers.map(([text, f], i) => <Face key={text} index={i} label={text} feeling={f} chosen={i === chosen && !!feeling} dim={!!picked && i !== chosen} disabled={busy}
        onPress={() => {
          const follow = copy.follow[f];
          AccessibilityInfo.announceForAccessibility(`${text}. ${follow.line} ${follow.prompt}`);
          setChosen(i);
          onChoose(f);
        }} />)}
    </View>
    {picked && <FollowUp key={chosen} language={language} text={picked[0]} feeling={picked[1]} busy={busy} onSend={onSend} />}
  </View>;
}

/** The chosen face's follow-up, opened in place in its tint: a line, then quick replies or their own words, or the review for worse. */
function FollowUp({ language, text, feeling: f, busy, onSend }: { language: Language; text: string; feeling: Feeling; busy: boolean; onSend: (text: string, about?: string) => void }) {
  const still = useReducedMotion();
  const [review, setReview] = useState<string>();
  const [writing, setWriting] = useState(false);
  const [words, setWords] = useState("");
  // Speaking fills the box with her words (added to anything typed); she reads them before sending.
  const listen = useListen({ language, onHeard: t => setWords(w => w.trim() ? `${w.trim()} ${t}` : t) });
  const copy = answersFor(language), follow = copy.follow[f];
  const enter = (i: number) => still ? undefined : rise(80 + i * 50);
  const quick = (q?: string) => {
    if (busy) return;
    if (f !== "worse") return onSend(replyText(text, q), q);
    setReview(q);
    AccessibilityInfo.announceForAccessibility(`${copy.review}: ${replyText(text, q)}`);
  };

  return <Animated.View entering={enter(0)} style={{ padding: 16, gap: 10, borderRadius: 24, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", experimental_backgroundImage: TINT[f].fill } as ViewStyle}>
    <Text style={{ ...type.body, fontWeight: "700", color: TINT[f].line }}>{follow.line}</Text>
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
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <TextInput value={words} onChangeText={setWords} placeholder={copy.placeholder} placeholderTextColor={palette.muted} multiline autoFocus maxLength={900}
          accessibilityLabel={copy.more} style={{ ...field, flex: 1, backgroundColor: palette.white, minHeight: 96, paddingTop: 12, textAlignVertical: "top" }} />
        <MicButton listen={listen} label="Say it instead" />
      </View>
      {listen.state === "listening" ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Listening… say it your way</Text>
        : listen.error ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber }}>{listen.error}</Text> : null}
      <Button label={copy.send} busy={busy} disabled={!words.trim()} onPress={() => onSend(replyText(text, words))} />
    </Animated.View>
    : <>
      <Animated.View entering={enter(1)}><Text style={{ ...type.body, color: palette.muted }}>{follow.prompt}</Text></Animated.View>
      <Animated.View entering={enter(2)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {follow.quick.map(q => <Chip key={q} label={q} onPress={() => quick(q)} />)}
        {follow.none && <Chip label={follow.none} onPress={() => quick()} />}
      </Animated.View>
      <Animated.View entering={enter(3)}>
        <Pressable accessibilityRole="button" onPress={() => setWriting(true)} style={{ minHeight: 48, justifyContent: "center", alignSelf: "flex-start" }}>
          <Text style={{ ...type.body, fontWeight: "600", color: palette.blue }}>{copy.more}</Text>
        </Pressable>
      </Animated.View>
      {busy && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
    </>}
    {f === "worse" && <Text style={{ ...type.footnote, fontWeight: "700", color: palette.red }}>{copy.urgent}</Text>}
  </Animated.View>;
}
