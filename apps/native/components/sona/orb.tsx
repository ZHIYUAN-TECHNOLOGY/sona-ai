import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import { View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { palette } from "./theme";

const dots = Array.from({ length: 25 * 21 }, (_, i) => {
  const x = (i % 25) * 12 + 6, y = Math.floor(i / 25) * 12 + 6;
  const distance = Math.hypot(x - 150, y - 126);
  return { x, y, opacity: Math.max(0, 1 - distance / 148) * 0.22 };
});
export function SonaMark({ light = false, size = 24 }: { light?: boolean; size?: number }) {
  return <View accessibilityElementsHidden style={{ width: size, height: size, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: size * 0.1 }}>{[0.35, 0.7, 1, 0.55].map((height, i) => <View key={i} style={{ width: size * 0.13, height: size * height, borderRadius: size, backgroundColor: light ? "white" : palette.ink }} />)}</View>;
}
export function Orb({ active = false, compact = false }: { active?: boolean; compact?: boolean }) {
  const reduced = useReduceMotionPreference(); const size = compact ? 46 : 84;
  return <View accessibilityElementsHidden style={{ width: compact ? 46 : 300, height: compact ? 46 : 152, alignItems: "center", justifyContent: "center" }}>
    {!compact && <Canvas style={{ position: "absolute", width: 300, height: 252, top: -50 }}>{dots.map((dot, i) => <Circle key={i} cx={dot.x} cy={dot.y} r={0.85} color={`rgba(63,82,110,${dot.opacity})`} />)}</Canvas>}
    <Animated.View style={{ width: size, height: size, borderRadius: size / 2, boxShadow: "0 8px 24px rgba(80,112,171,0.16)", animationName: active && !reduced ? { "0%": { transform: [{ scale: 1 }] }, "50%": { transform: [{ scale: 1.045 }] }, "100%": { transform: [{ scale: 1 }] } } : undefined, animationDuration: "1800ms", animationIterationCount: "infinite" }}>
      <Canvas style={{ width: size, height: size }}><Circle cx={size / 2} cy={size / 2} r={size / 2 - 1}><RadialGradient c={vec(size * 0.32, size * 0.2)} r={size * 0.9} colors={["#F2F9FF", "#B4D5FE", "#6495E3", "#A9C8F3"]} positions={[0, 0.35, 0.76, 1]} /></Circle><Circle cx={size / 2} cy={size / 2} r={size / 2 - 0.7} color="rgba(255,255,255,0.85)" style="stroke" strokeWidth={1} /></Canvas>
      <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}><SonaMark light size={compact ? 20 : 31} /></View>
    </Animated.View>
  </View>;
}
