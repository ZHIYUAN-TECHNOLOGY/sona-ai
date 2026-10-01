import { View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import { follow, pushHistory, STEP_MS } from "./veil-signal";

/**
 * The voice, drawn big in the middle of the listening screen (after Perplexity's audio player: bars that rise and fall
 * with the speech, ease in and out, no spring). Symmetric: the newest loudness is the centre bar and older readings
 * move out to both edges, so a sentence reads as a wave spreading from the middle. Blue into violet like the veil.
 * Fed the dock's live level (0..1, UI thread), smoothed with the veil's own follower (80 ms up, 350 ms down) and
 * sampled every 70 ms. Reduce Motion: the bars stand still and only their opacity follows the voice.
 */
const SIDE = 16, BAR = 4, GAP = 4, MIN = 6, MAX = 52;

export function VoiceWave({ level, still }: { level: SharedValue<number>; still: boolean }) {
  const loud = useSharedValue(0), since = useSharedValue(0);
  const history = useSharedValue<number[]>(Array(SIDE + 1).fill(0));
  useFrameCallback(({ timeSincePreviousFrame }) => {
    const dt = timeSincePreviousFrame ?? 16;
    const env = follow(loud.get(), level.get(), dt);
    loud.set(env);
    since.set(since.get() + dt);
    if (since.get() < STEP_MS) return;
    since.set(0);
    history.modify(h => { "worklet"; return pushHistory(h, env); });
  });
  return <View accessible={false} pointerEvents="none" style={{ height: MAX, flexDirection: "row", alignItems: "center", gap: GAP }}>
    {Array.from({ length: SIDE * 2 + 1 }, (_, i) => <Bar key={i} at={Math.abs(i - SIDE)} history={history} loud={loud} still={still} />)}
  </View>;
}

function Bar({ at, history, loud, still }: { at: number; history: SharedValue<number[]>; loud: SharedValue<number>; still: boolean }) {
  // Bars further from the centre are a touch shorter and fainter, so the wave tapers into the glass.
  const taper = 1 - (at / SIDE) * 0.45;
  const style = useAnimatedStyle(() => {
    if (still) return { height: MIN + (MAX - MIN) * 0.35 * taper, opacity: 0.35 + 0.6 * loud.get() };
    const v = history.get()[at] ?? 0;
    return { height: MIN + (MAX - MIN) * Math.min(1, Math.pow(v, 0.75)) * taper, opacity: 0.45 + 0.55 * taper };
  });
  return <Animated.View style={[{ width: BAR, borderRadius: BAR / 2, borderCurve: "continuous", experimental_backgroundImage: "linear-gradient(180deg, #7FA0FF 0%, #5B6FF0 55%, #9B7BFF 100%)" } as ViewStyle, style]} />;
}
