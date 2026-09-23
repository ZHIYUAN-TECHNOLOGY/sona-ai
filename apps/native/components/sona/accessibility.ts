import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/** Keep JS-controlled effects in sync with changes made while the app is open. */
export function useReduceMotionPreference() {
  const initial = useReducedMotion();
  const [reduced, setReduced] = useState(initial);
  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduced(value); });
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return reduced;
}
