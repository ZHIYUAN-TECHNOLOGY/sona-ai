import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, type SharedValue, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from "react-native-reanimated";
import { EASE_OUT_CSS } from "./motion";
import { Icon } from "./ui";
import { BrandIcon } from "./brand-icon";

/**
 * Living status glyphs for the aurora orb (after Wabi's animated glass icons): each state has
 * its own small object moving inside the glass, and a change of state morphs one into the next
 * on a gentle spring (response 0.45 s, damping 0.72).
 */
export type OrbActivity =
  | "idle" | "listening" | "searching" | "reading" | "solving" | "breathing"
  | "checking" | "composing" | "connecting" | "done" | "stop" | "mic" | "muted";

const INK = "#16213A";
const SPRING = { duration: 450, dampingRatio: 0.72 };

function glyphIn() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.55 }, { rotate: "-35deg" }] },
    animations: { opacity: withTiming(1, { duration: 180 }), transform: [{ scale: withSpring(1, SPRING) }, { rotate: withSpring("0deg", SPRING) }] },
  };
}
// The talk glyph becoming a stop square (after Apple Messages' record control: response 0.4 s, damping 0.8).
const STOP_SPRING = { duration: 400, dampingRatio: 0.8 };
function stopIn() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.4 }] },
    animations: { opacity: withTiming(1, { duration: 150 }), transform: [{ scale: withSpring(1, STOP_SPRING) }] },
  };
}
function glyphOut() {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }, { rotate: "0deg" }] },
    animations: { opacity: withTiming(0, { duration: 140 }), transform: [{ scale: withTiming(0.6, { duration: 180 }) }, { rotate: withTiming("30deg", { duration: 180 }) }] },
  };
}

type Loop = Record<string, unknown>;
const loop = (name: Loop, duration: number, delay = 0, ease = "ease-in-out") =>
  ({ animationName: name, animationDuration: duration, animationDelay: delay, animationIterationCount: "infinite", animationTimingFunction: ease }) as object;

const PEAKS = [0.55, 1, 0.75, 0.9, 0.5];
const BAR = { width: 3.2, height: 22, borderRadius: 2 };

/** One bar following the voice on the UI thread: in silence a slow breath travels across the bars, speech lifts each toward its peak. */
function VoiceBar({ peak, i, level, clock, color }: { peak: number; i: number; level: SharedValue<number>; clock: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const t = clock.get(), breath = 0.12 + 0.08 * Math.sin((t + i * 0.18) * Math.PI * 2);
    const voice = level.get() * peak * (0.8 + 0.2 * Math.sin((t * 5 + i * 0.7) * Math.PI * 2));
    return { transform: [{ scaleY: Math.min(1, 0.2 + Math.max(breath, voice)) }] };
  });
  return <Animated.View style={[BAR, { backgroundColor: color }, style]} />;
}

/**
 * Level bars that rise and fall like a voice. With `level` (0–1, the microphone's metering) they follow the speaker;
 * without, they loop on their own. Still (Reduce Motion): a fixed waveform.
 */
export function Bars({ still, level, color = INK }: { still: boolean; level?: SharedValue<number>; color?: string }) {
  const clock = useSharedValue(0);
  useEffect(() => {
    if (!level || still) return;
    clock.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(clock);
  }, [Boolean(level), still]);
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 3, height: 22 }}>
    {PEAKS.map((peak, i) => level && !still ? <VoiceBar key={i} peak={peak} i={i} level={level} clock={clock} color={color} />
      : <Animated.View key={i} style={[BAR, { backgroundColor: color, transform: [{ scaleY: still ? peak * 0.7 : 0.3 }] },
        still ? null : loop({ "0%": { transform: [{ scaleY: 0.28 }] }, "50%": { transform: [{ scaleY: peak }] }, "100%": { transform: [{ scaleY: 0.28 }] } }, 620 + i * 90, i * 110)]} />)}
  </View>;
}

/**
 * Sona Live's mic, on: the mic in a thin blue ring that swells and brightens with the voice (`level`, on the UI thread),
 * resting faint in silence. Still (Reduce Motion): the ring keeps its size and only its strength follows the voice.
 */
function MicRing({ level, still }: { level?: SharedValue<number>; still: boolean }) {
  const ring = useAnimatedStyle(() => {
    const v = level?.get() ?? 0;
    return { opacity: 0.3 + 0.6 * v, transform: [{ scale: still ? 1 : 1 + 0.32 * v }] };
  });
  return <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
    <Animated.View style={[{ position: "absolute", inset: 0, borderRadius: 17, borderWidth: 1.5, borderColor: "rgba(36,91,204,0.7)" }, ring]} />
    <BrandIcon name="mic" size={24} color={INK} strokeWidth={1.9} />
  </View>;
}

function Moving({ children, motion, still }: { children: ReactNode; motion: object; still: boolean }) {
  return <Animated.View style={still ? null : motion}>{children}</Animated.View>;
}

function Glyph({ activity, still, level }: { activity: OrbActivity; still: boolean; level?: SharedValue<number> }) {
  switch (activity) {
    case "listening": return <Bars still={still} level={level} />;
    // Rounded stop square; its corners settle from round as it springs in.
    case "stop": return <Animated.View style={{ width: 16, height: 16, borderRadius: 4.5, borderCurve: "continuous", backgroundColor: INK, ...(still ? null : { animationName: { from: { borderRadius: 8 } }, animationDuration: 400, animationTimingFunction: EASE_OUT_CSS }) } as never} />;
    // Magnifier gliding on a small loop, as if scanning the record.
    case "searching": return <Moving still={still} motion={loop({ "0%": { transform: [{ translateX: -4 }, { translateY: 0 }] }, "25%": { transform: [{ translateX: 0 }, { translateY: -4 }] }, "50%": { transform: [{ translateX: 4 }, { translateY: 0 }] }, "75%": { transform: [{ translateX: 0 }, { translateY: 4 }] }, "100%": { transform: [{ translateX: -4 }, { translateY: 0 }] } }, 1600, 0, "linear")}><Icon name="magnifyingglass" size={21} color={INK} /></Moving>;
    // A page with a light bar sweeping down it.
    case "reading": return <View style={{ width: 24, height: 26, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <Icon name="doc.text" size={22} color={INK} />
      {!still && <Animated.View style={[{ position: "absolute", left: 2, right: 2, height: 3, borderRadius: 2, backgroundColor: "rgba(80,140,255,0.75)" }, loop({ "0%": { transform: [{ translateY: -11 }] }, "100%": { transform: [{ translateY: 11 }] } }, 1300, 0, "ease-in-out")]} />}
    </View>;
    // Two sparkles turning around each other while reasoning.
    case "solving": return <Moving still={still} motion={loop({ from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } }, 2600, 0, "linear")}>
      <View style={{ width: 26, height: 26 }}>
        <View style={{ position: "absolute", left: 0, top: 0 }}><Icon name="sparkle" size={15} color={INK} /></View>
        <View style={{ position: "absolute", right: 0, bottom: 0 }}><Icon name="sparkle" size={11} color={INK} /></View>
      </View>
    </Moving>;
    // Lungs expanding and settling: 4 s in, 6 s out would be too slow for a status, so 1.6 s.
    case "breathing": return <Moving still={still} motion={loop({ "0%": { transform: [{ scale: 0.88 }] }, "45%": { transform: [{ scale: 1.08 }] }, "100%": { transform: [{ scale: 0.88 }] } }, 1600)}><Icon name="lungs" size={22} color={INK} /></Moving>;
    // Capsule rocking while medicines are checked.
    case "checking": return <Moving still={still} motion={loop({ "0%": { transform: [{ rotate: "-14deg" }] }, "50%": { transform: [{ rotate: "14deg" }] }, "100%": { transform: [{ rotate: "-14deg" }] } }, 1100)}><Icon name="pills" size={22} color={INK} /></Moving>;
    // Pen tracing short strokes.
    case "composing": return <Moving still={still} motion={loop({ "0%": { transform: [{ translateX: -3 }, { translateY: 2 }, { rotate: "-6deg" }] }, "30%": { transform: [{ translateX: 3 }, { translateY: -1 }, { rotate: "4deg" }] }, "60%": { transform: [{ translateX: -1 }, { translateY: 2 }, { rotate: "-3deg" }] }, "100%": { transform: [{ translateX: -3 }, { translateY: 2 }, { rotate: "-6deg" }] } }, 900)}><Icon name="pencil" size={21} color={INK} /></Moving>;
    // Linked points pulsing as the plan connects tasks.
    case "connecting": return <Moving still={still} motion={loop({ "0%": { transform: [{ scale: 0.92 }], opacity: 0.7 }, "50%": { transform: [{ scale: 1.06 }], opacity: 1 }, "100%": { transform: [{ scale: 0.92 }], opacity: 0.7 } }, 1200)}><Icon name="point.3.connected.trianglepath.dotted" size={22} color={INK} /></Moving>;
    case "done": return <Icon name="checkmark" size={22} color={INK} />;
    // Sona Live with the microphone on, and off.
    case "mic": return <MicRing level={level} still={still} />;
    case "muted": return <Icon name="mic.slash" size={22} color={INK} />;
    default: return <BrandIcon name="mic" size={26} color={INK} strokeWidth={1.9} />;
  }
}

/** Glyph for the current activity; keyed so each change morphs on the spring (a crossfade with Reduce Motion). */
export function OrbGlyph({ activity, still = false, level }: { activity: OrbActivity; still?: boolean; level?: SharedValue<number> }) {
  return <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
    <View style={{ position: "absolute", width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.55)", boxShadow: "0 0 12px rgba(255,255,255,0.7)" }} />
    <Animated.View key={activity} entering={still ? FadeIn.duration(150) : activity === "stop" ? stopIn : glyphIn} exiting={still ? FadeOut.duration(120) : glyphOut} style={{ alignItems: "center", justifyContent: "center" }}>
      <Glyph activity={activity} still={still} level={level} />
    </Animated.View>
  </View>;
}
