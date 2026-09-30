import { cubicBezier, Easing, type EntryAnimationsValues, type ExitAnimationsValues, LinearTransition, withDelay, withSpring, withTiming } from "react-native-reanimated";

/** Motion tokens: entrances and exits ease out; things moving on screen share one spring. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/** `EASE_OUT` for CSS transitions (`transitionTimingFunction`), which take a `cubicBezier`, not a worklet easing. */
export const EASE_OUT_CSS = cubicBezier(0.23, 1, 0.32, 1);

/** Layout spring (no bounce): cards resizing, rows reflowing, panels opening. */
export const LAYOUT_SPRING = { duration: 380, dampingRatio: 1 };
export const LAYOUT = LinearTransition.springify().duration(LAYOUT_SPRING.duration).dampingRatio(LAYOUT_SPRING.dampingRatio);

/** Accordion open: the clip grows from zero on the layout spring, content fades in just behind it. */
export function unfold(values: EntryAnimationsValues) {
  "worklet";
  return {
    initialValues: { height: 0, opacity: 0 },
    animations: { height: withSpring(values.targetHeight, LAYOUT_SPRING), opacity: withDelay(60, withTiming(1, { duration: 200, easing: EASE_OUT })) },
  };
}
/** Accordion close: content fades first, the clip folds on the same spring. */
export function fold(values: ExitAnimationsValues) {
  "worklet";
  return {
    initialValues: { height: values.currentHeight, opacity: 1 },
    animations: { height: withSpring(0, LAYOUT_SPRING), opacity: withTiming(0, { duration: 120, easing: EASE_OUT }) },
  };
}

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
