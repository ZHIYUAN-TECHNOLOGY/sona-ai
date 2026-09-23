import { Easing, withDelay, withTiming } from "react-native-reanimated";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Entering animation: fade up from a small offset, optionally scaled, on a strong ease-out. */
export function riseIn({ delay = 0, distance = 12, scale = 1, duration = 360 }: { delay?: number; distance?: number; scale?: number; duration?: number } = {}) {
  return () => {
    "worklet";
    const config = { duration, easing: EASE_OUT };
    return {
      initialValues: { opacity: 0, transform: [{ translateY: distance }, { scale }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: Math.min(duration, 260) })),
        transform: [{ translateY: withDelay(delay, withTiming(0, config)) }, { scale: withDelay(delay, withTiming(1, config)) }],
      },
    };
  };
}
