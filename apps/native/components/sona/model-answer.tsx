import { useEffect, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { riseIn } from "./motion";
import { Text } from "./text";
import { palette, type } from "./theme";
import { useAccessibleEffects } from "./ui";

/*
 * A model answer arriving from the server (live mode). While it drafts, soft bars breathe in place
 * (after Monogram's pulse-sweep response reveal, 60fps.design/shots/monogram-pulse-sweep-chat-response-reveal-interaction:
 * the ambient pulse says work is happening without a spinner); opacity 0.35 ↔ 0.8 over 900 ms each
 * way, each bar 120 ms behind the one above. When the answer lands, the bars go and its lines rise
 * 8 pt and fade in 70 ms apart on the ease-out (the upward, lightly staggered reveal of Monogram's
 * answer and of Slack's pinch-to-summarize, 60fps.design/shots/slack-pinch-to-summarize-interaction).
 * No height is animated: the response container keeps its plain layout. Reduce Motion: the bars
 * hold still and the lines appear at once.
 */
const WIDTHS = ["94%", "80%", "62%"] as const;

function Bar({ index, width, still }: { index: number; width: `${number}%`; still: boolean }) {
  const glow = useSharedValue(0.55);
  useEffect(() => {
    if (still) return;
    const ease = { duration: 900, easing: Easing.inOut(Easing.quad) };
    glow.set(withDelay(index * 120, withRepeat(withSequence(withTiming(0.8, ease), withTiming(0.35, ease)), -1)));
  }, [glow, index, still]);
  const style = useAnimatedStyle(() => ({ opacity: glow.value }));
  return <Animated.View style={[{ width, height: 12, borderRadius: 6, backgroundColor: "rgba(36,91,204,0.12)" }, style]} />;
}

/** The placeholder while the server drafts: a few breathing bars and what it is doing, announced once. */
export function Drafting({ label, lines = 3, style }: { label: string; lines?: number; style?: StyleProp<ViewStyle> }) {
  const { reducedMotion } = useAccessibleEffects();
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={[{ gap: 10 }, style]}>
    {WIDTHS.slice(0, lines).map((w, i) => <Bar key={w} index={i} width={w} still={reducedMotion} />)}
    <Text style={{ ...type.caption, color: palette.muted }}>{label}</Text>
  </View>;
}

/** One line of an arrived answer, rising in after the lines before it (`animate` false: already on screen, e.g. the authored fixture). */
export function Arrive({ index = 0, animate = true, children, style }: { index?: number; animate?: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View entering={reducedMotion || !animate ? undefined : riseIn({ delay: index * 70, distance: 8, duration: 320 })} style={style}>{children}</Animated.View>;
}

/** Says plainly when the server answered with authored sample content instead of a model; nothing when a model answered. */
export function SampleLabel({ source }: { source?: "fixture" | "model" }) {
  if (source !== "fixture") return null;
  return <Text selectable accessibilityLabel="Sample answer, not a model reading" style={{ ...type.caption, color: palette.muted }}>Sample · not a model reading</Text>;
}
