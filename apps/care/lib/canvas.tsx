import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import { StyleSheet, useWindowDimensions, View } from "react-native";

/**
 * The calm canvas behind every screen: pale grey with a few still pools of ice blue and teal light,
 * so the glass cards have colour to catch. Still, unlike the clinician app's drifting wash: a patient
 * opens this briefly, and nothing here should compete with what needs them.
 */
const pools = [
  { x: 0.05, y: 0.4, r: 0.95, color: "rgba(196,236,238,0.7)" },
  { x: 0.95, y: 0.3, r: 0.85, color: "rgba(214,221,252,0.8)" },
  { x: 0.55, y: 1.0, r: 0.9, color: "rgba(205,224,252,0.75)" },
];

export function CalmCanvas() {
  const { width, height } = useWindowDimensions();
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Canvas style={StyleSheet.absoluteFill}>
      {pools.map((p, i) => { const c = vec(p.x * width, p.y * height), r = p.r * Math.max(width, height) * 0.62;
        return <Circle key={i} c={c} r={r}><RadialGradient c={c} r={r} colors={[p.color, "rgba(255,255,255,0)"]} /></Circle>; })}
    </Canvas>
  </View>;
}
