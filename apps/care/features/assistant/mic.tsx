import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import type { useListen } from "@/lib/listen";
import { AnimatedText, Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { Glyph } from "./composer";
import { bar, clock, pieces } from "./wave";
import "./strings";

export const MIC = "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3M19 10v2a7 7 0 0 1-14 0v-2M12 19v3";
type Listen = ReturnType<typeof useListen>;
// The recording morph (iMessage's audio bar, 0.4 s at 0.8 damping): mic to stop, field to pill and back.
const MORPH = { duration: 400, dampingRatio: 0.8 } as const;

/**
 * The round mic button: tap to speak, tap the stop square to finish. While listening it fills blue and
 * the mic glyph springs into a small rounded square; while the words are read, a spinner. `quiet` when
 * the composer's pill already shows the level and "Transcribing…": no halo (it would spill onto the
 * next button) and no spinner. Elsewhere a soft ring breathes with the voice inside the button's own 48 pt.
 */
export function MicButton({ listen, size = 48, label, quiet }: { listen: Listen; size?: number; label?: string; quiet?: boolean }) {
  const t = useT();
  const still = useReducedMotion();
  const on = listen.state === "listening", reading = listen.state === "reading";
  const disc = quiet ? size : size - 8;
  const p = useSharedValue(0);
  useEffect(() => { p.set(still ? withTiming(on ? 1 : 0, { duration: 180 }) : withSpring(on ? 1 : 0, MORPH)); }, [on, still, p]);
  // -60 dB (quiet) to -10 dB (loud) grows the ring from the disc to the button's edge, never past it.
  const loud = Math.max(0, Math.min(1, (listen.level + 60) / 50));
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: on && !still ? withSpring(1 + loud * (size / disc - 1), { duration: 180, dampingRatio: 0.8 }) : 1 }], opacity: on ? 0.35 : 0 }));
  // Reduce Motion: the glyphs crossfade in place; otherwise the mic shrinks away as the square springs up.
  const mic = useAnimatedStyle(() => ({ opacity: 1 - p.get(), transform: [{ scale: still ? 1 : interpolate(p.get(), [0, 1], [1, 0.5]) }] }));
  const stop = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ scale: still ? 1 : interpolate(p.get(), [0, 1], [0.4, 1]) }] }));
  const glyph = Math.round(size * 0.42);
  return <Pressable accessibilityRole="button" accessibilityLabel={on ? t("mic.stop") : reading ? t("mic.reading") : label ?? t("mic.speak")}
    accessibilityHint={on ? (listen.untilStop ? undefined : t("mic.stopHint")) : reading ? undefined : t("mic.hint")} accessibilityState={{ busy: reading }}
    disabled={reading} onPress={() => { if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync(); listen.toggle(); }}
    style={({ pressed }) => ({ width: size, height: size, alignItems: "center", justifyContent: "center", opacity: quiet && reading ? 0.4 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
    {!quiet && <Animated.View pointerEvents="none" style={[{ position: "absolute", width: disc, height: disc, borderRadius: disc / 2, backgroundColor: palette.blue }, ring]} />}
    <Animated.View style={{ width: disc, height: disc, borderRadius: disc / 2, alignItems: "center", justifyContent: "center", backgroundColor: on ? palette.blue : palette.mutedWash,
      transitionProperty: "backgroundColor", transitionDuration: 180 }}>
      {reading && !quiet ? <ActivityIndicator color={palette.ink} />
        : <>
          <Animated.View style={mic}><Glyph d={MIC} color={on ? palette.white : palette.ink} size={glyph} /></Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }, stop]}>
            <View style={{ width: glyph * 0.62, height: glyph * 0.62, borderRadius: 4, borderCurve: "continuous", backgroundColor: palette.white }} />
          </Animated.View>
        </>}
    </Animated.View>
  </Pressable>;
}

/**
 * The composer's field while dictating (iMessage's recording bar, in Sona's blue): a blue-washed pill
 * with the live waveform and an m:ss timer. Once the first partial lands, the words so far stream in above
 * (ChatGPT's dictation) and the waveform slims to a strip under them. "Transcribing…" with three soft dots
 * only when the stop came before any words (otherwise the field holds them while the final pass runs). It
 * springs in over the field and fades back out; Reduce Motion fades both ways.
 */
const spring = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.96 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, MORPH) }] } };
};

export function Dictation({ listen }: { listen: Listen }) {
  const t = useT();
  const still = useReducedMotion();
  const reading = listen.state === "reading", words = !reading && !!listen.partial;
  const recording = t("mic.recording", { time: clock(listen.ms) });
  return <Animated.View entering={still ? FadeIn.duration(160) : spring} exiting={FadeOut.duration(160)}
    accessible accessibilityLabel={reading ? t("mic.transcribing") : words ? `${recording}. ${listen.partial}` : recording}
    style={{ marginLeft: -10, minHeight: 48, borderRadius: 18, borderCurve: "continuous", backgroundColor: palette.blueWash,
      justifyContent: "center", gap: 6, paddingHorizontal: 12, paddingVertical: words ? 10 : 0 }}>
    {reading ? <Transcribing still={still} label={t("mic.transcribing")} />
      : <>
        {words && <Words text={listen.partial} still={still} />}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Wave level={listen.level} tick={listen.ms} still={still} high={words ? 12 : 24} />
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue, fontVariant: ["tabular-nums"] }}>{clock(listen.ms)}</Text>
        </View>
      </>}
  </Animated.View>;
}

/**
 * The words so far, at the field's own size so they don't jump when they land in it. Each word is its own text so
 * a new one fades in (220 ms, ease-out) while the words before it, unchanged, stay put; Reduce Motion: they just
 * appear. Five lines at most, newest at the bottom: the oldest slip out of view at the top.
 */
function Words({ text, still }: { text: string; still: boolean }) {
  return <View style={{ maxHeight: 110, overflow: "hidden", justifyContent: "flex-end" }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {pieces(text).map(p => <AnimatedText key={p.key} entering={still ? undefined : FadeIn.duration(220).easing(EASE_OUT)}
        style={{ fontSize: 17, lineHeight: 22, color: palette.ink, marginRight: p.space ? 4.5 : 0 }}>{p.word}</AnimatedText>)}
    </View>
  </View>;
}

// Bars 3 pt wide on a 6 pt step, right-aligned and clipped on the left, so the newest is always at the edge.
const BARS = 48, STEP = 6;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * The live waveform. Each metering tick (100 ms) pushes a bar on the right and slides the row one step
 * left over the same 100 ms, linear, so history scrolls at the recorder's own pace. Heights live in a
 * shared value and every bar reads it on the UI thread: no React render per bar. Reduce Motion: one
 * still bar whose opacity follows the voice. `high`: 24 pt on its own, a 12 pt strip under the live words.
 */
function Wave({ level, tick, still, high }: { level: number; tick: number; still: boolean; high: number }) {
  const levels = useSharedValue<number[]>(Array(BARS).fill(bar(-160)));
  const shift = useSharedValue(0);
  const glow = useSharedValue(0.35);
  useEffect(() => {
    const h = bar(level);
    if (still) { glow.set(withTiming(0.35 + 0.65 * h, { duration: 100 })); return; }
    levels.modify(v => { "worklet"; return [...v.slice(1), h]; });
    shift.set(withSequence(withTiming(STEP, { duration: 0 }), withTiming(0, { duration: 100, easing: Easing.linear })));
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps -- one bar per recorder tick
  const row = useAnimatedStyle(() => ({ transform: [{ translateX: shift.get() }] }));
  const lit = useAnimatedStyle(() => ({ opacity: glow.get() }));
  if (still) return <View style={{ flex: 1, height: high, justifyContent: "center" }}>
    <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: palette.blue }, lit]} />
  </View>;
  return <View style={{ flex: 1, height: high, overflow: "hidden" }}>
    <Animated.View style={[{ position: "absolute", right: 0, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: STEP - 3 }, row]}>
      {Array.from({ length: BARS }, (_, i) => <Bar key={i} i={i} levels={levels} high={high} />)}
    </Animated.View>
  </View>;
}

function Bar({ i, levels, high }: { i: number; levels: SharedValue<number[]>; high: number }) {
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: levels.get()[i] ?? 0.12 }] }));
  return <Animated.View style={[{ width: 3, height: high, borderRadius: 1.5, backgroundColor: palette.blue }, style]} />;
}

/** "Transcribing…" with three dots that breathe in turn (opacity only, so it stays calm under Reduce Motion too). */
function Transcribing({ still, label }: { still: boolean; label: string }) {
  return <Animated.View entering={FadeIn.duration(still ? 120 : 200)} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{label}</Text>
    <View style={{ flexDirection: "row", gap: 4 }}>
      {[0, 1, 2].map(i => <Animated.View key={i} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: palette.blue,
        animationName: { from: { opacity: 0.25 }, to: { opacity: 1 } }, animationDuration: "600ms", animationDelay: `${i * 160}ms`,
        animationIterationCount: "infinite", animationDirection: "alternate", animationTimingFunction: "ease-in-out" }} />)}
    </View>
  </Animated.View>;
}
