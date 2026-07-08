import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

// Resolve the best backdrop ONCE (module scope) — never per-render, never animated.
const IS_IOS = process.env.EXPO_OS === "ios";
const HAS_LIQUID = IS_IOS && isLiquidGlassAvailable();

/**
 * Real translucent glass backdrop, degrading by capability:
 *   iOS 26+  → expo-glass-effect GlassView (true liquid glass, system-composited)
 *   iOS 18-25→ expo-blur BlurView (native gaussian blur)
 *   Android  → translucent solid (no cheap system blur)
 *
 * Perf: both native paths composite off the JS thread. Keep the effect STATIC —
 * do not animate glassEffectStyle / intensity (that's the expensive part).
 */
export function GlassSurface({ children, style }: { children?: ReactNode; style?: ViewStyle }) {
  if (HAS_LIQUID) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme="light" style={style}>
        {children}
      </GlassView>
    );
  }
  if (IS_IOS) {
    // Lazy-require so the native module is only touched on iOS 18-25 devices that
    // actually render it (our iOS 26 demo device uses GlassView above and never
    // reaches here). Keeps the bundle safe if expo-blur isn't natively linked.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BlurView } = require("expo-blur") as typeof import("expo-blur");
    return (
      <BlurView tint="light" intensity={36} style={style}>
        {children}
      </BlurView>
    );
  }
  return <View style={[style, styles.androidFallback]}>{children}</View>;
}

const styles = StyleSheet.create({
  androidFallback: { backgroundColor: "rgba(245,249,247,0.94)" },
});
