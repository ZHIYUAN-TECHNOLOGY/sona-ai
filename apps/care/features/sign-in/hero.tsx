import { useEffect } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { orbPad, SonaOrb } from "@/lib/orb";

/**
 * Sona Care's welcome hero: the Sona orb (lib/orb.tsx). A step change floods its sunbeam (to 55 % off
 * the options, to the whole sphere for a moment when the code is sent). Drag tilts the core and the
 * light, then it springs back. Still under Reduce Motion.
 */
const BACK = { duration: 700, dampingRatio: 0.55 } as const;
type Step = "options" | "phone" | "code" | "email";

export function HeroOrb({ size = 148, roll }: { size?: number; roll?: Step }) {
  const still = useReducedMotion();
  const tx = useSharedValue(0), ty = useSharedValue(0);
  const flood = useSharedValue(0);

  useEffect(() => {
    const rest = roll === undefined || roll === "options" ? 0 : 0.55;
    if (still) { flood.set(rest); return; }
    if (roll === "code") flood.set(withSequence(withTiming(1, { duration: 500 }), withDelay(900, withTiming(rest, { duration: 2500 }))));
    else flood.set(withTiming(rest, { duration: rest > flood.get() ? 600 : 2500 }));
  }, [roll, still, flood]);

  const drag = Gesture.Pan().enabled(!still)
    .onChange(e => { tx.set(Math.max(-1, Math.min(1, e.translationX / 90))); ty.set(Math.max(-1, Math.min(1, e.translationY / 90))); })
    .onFinalize(() => { tx.set(withSpring(0, BACK)); ty.set(withSpring(0, BACK)); });

  const W = size + orbPad(size) * 2;
  return <GestureDetector gesture={drag}>
    <View accessible accessibilityRole="image" accessibilityLabel="Sona Care" style={{ width: W, height: W }}>
      <SonaOrb size={size} flood={flood} tx={tx} ty={ty} />
    </View>
  </GestureDetector>;
}
