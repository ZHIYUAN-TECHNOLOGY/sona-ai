import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { withSpring, withTiming } from "react-native-reanimated";
import { Icon } from "./ui";

/**
 * Living status glyphs for the aurora orb (after Wabi's animated glass icons): each state has
 * its own small object moving inside the glass, and a change of state morphs one into the next
 * on a gentle spring (response 0.45 s, damping 0.72).
 */
export type OrbActivity =
  | "idle" | "listening" | "searching" | "reading" | "solving" | "breathing"
  | "checking" | "composing" | "connecting" | "done";

const INK = "#16213A";
const SPRING = { duration: 450, dampingRatio: 0.72 };

function glyphIn() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.55 }, { rotate: "-35deg" }] },
    animations: { opacity: withTiming(1, { duration: 180 }), transform: [{ scale: withSpring(1, SPRING) }, { rotate: withSpring("0deg", SPRING) }] },
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

/** Live level bars that rise and fall like a voice. */
function Bars({ still }: { still: boolean }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 3, height: 22 }}>
    {[0.55, 1, 0.75, 0.9, 0.5].map((peak, i) => <Animated.View key={i} style={[{ width: 3.2, height: 22, borderRadius: 2, backgroundColor: INK, transform: [{ scaleY: still ? peak * 0.7 : 0.3 }] },
      still ? null : loop({ "0%": { transform: [{ scaleY: 0.28 }] }, "50%": { transform: [{ scaleY: peak }] }, "100%": { transform: [{ scaleY: 0.28 }] } }, 620 + i * 90, i * 110)]} />)}
  </View>;
}

function Moving({ children, motion, still }: { children: ReactNode; motion: object; still: boolean }) {
  return <Animated.View style={still ? null : motion}>{children}</Animated.View>;
}

function Glyph({ activity, still }: { activity: OrbActivity; still: boolean }) {
  switch (activity) {
    case "listening": return <Bars still={still} />;
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
    default: return <Icon name="mic.fill" size={24} color={INK} />;
  }
}

/** Glyph for the current activity; keyed so each change morphs on the spring. */
export function OrbGlyph({ activity, still = false }: { activity: OrbActivity; still?: boolean }) {
  return <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
    <View style={{ position: "absolute", width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.55)", boxShadow: "0 0 12px rgba(255,255,255,0.7)" }} />
    <Animated.View key={activity} entering={still ? undefined : glyphIn} exiting={still ? undefined : glyphOut} style={{ alignItems: "center", justifyContent: "center" }}>
      <Glyph activity={activity} still={still} />
    </Animated.View>
  </View>;
}
