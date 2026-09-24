import { useEffect } from "react";
import { View } from "react-native";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Circle, Ellipse, G, Line, Rect } from "react-native-svg";
import { palette } from "@/components/sona/theme";
import { Icon, useAccessibleEffects } from "@/components/sona/ui";
import type { MedicineLook } from "./medicine-catalog";

const EDGE = "rgba(20,28,40,0.12)";

/** An illustrative drawing of a dosage form; `ghost` draws it as a dashed outline (not yet confirmed). */
function Form({ look, ghost }: { look: MedicineLook; ghost?: boolean }) {
  const fill = (color: string) => ghost ? "none" : color;
  const stroke = ghost ? "#9AA3B0" : EDGE;
  const line = { stroke, strokeWidth: ghost ? 1.3 : 1, strokeDasharray: ghost ? "2.5 2.2" : undefined };
  switch (look.form) {
    case "inhaler": return <Svg width={44} height={44} viewBox="0 0 44 44">
      <Rect x={19.5} y={5} width={10} height={16} rx={3} fill={fill(look.accent)} {...line} />
      <Rect x={17} y={16} width={15} height={22} rx={4} fill={fill(look.body)} {...line} />
      <Rect x={7} y={28} width={14} height={9} rx={3} fill={fill(look.body)} {...line} />
      {!ghost && <Rect x={19.5} y={19} width={2.2} height={15} rx={1.1} fill="rgba(255,255,255,0.4)" />}
    </Svg>;
    case "tablet": return <Svg width={44} height={44} viewBox="0 0 44 44">
      {!ghost && <Ellipse cx={22} cy={24.5} rx={13} ry={13} fill={look.accent} />}
      <Circle cx={22} cy={22} r={13} fill={fill(look.body)} {...line} />
      <Line x1={22} y1={13} x2={22} y2={31} stroke={ghost ? "#9AA3B0" : look.accent} strokeWidth={1.2} strokeLinecap="round" strokeDasharray={line.strokeDasharray} />
    </Svg>;
    case "caplet": return <Svg width={44} height={44} viewBox="0 0 44 44">
      <G rotation={-30} origin="22, 22">
        {!ghost && <Rect x={7} y={17.5} width={30} height={13} rx={6.5} fill={look.accent} />}
        <Rect x={7} y={15} width={30} height={13} rx={6.5} fill={fill(look.body)} {...line} />
        <Line x1={22} y1={17} x2={22} y2={26} stroke={ghost ? "#9AA3B0" : look.accent} strokeWidth={1.2} strokeLinecap="round" />
      </G>
    </Svg>;
    case "capsule": return <Svg width={44} height={44} viewBox="0 0 44 44">
      <G rotation={-35} origin="22, 22">
        <Rect x={20} y={16} width={17} height={12} rx={6} fill={fill(look.accent)} {...line} />
        <Rect x={7} y={16} width={17} height={12} rx={6} fill={fill(look.body)} {...line} />
      </G>
    </Svg>;
    case "liquid": return <Svg width={44} height={44} viewBox="0 0 44 44">
      <Rect x={18} y={6} width={8} height={5} rx={1.5} fill={fill(look.accent)} {...line} />
      <Rect x={13} y={11} width={18} height={27} rx={5} fill={fill(look.body)} {...line} />
      {!ghost && <Rect x={13} y={24} width={18} height={14} rx={5} fill={look.accent} />}
    </Svg>;
    default: return <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.3, borderStyle: "dashed", borderColor: "#9AA3B0", alignItems: "center", justifyContent: "center" }}><Icon name="questionmark" size={11} color="#8A929E" /></View>
    </View>;
  }
}

/**
 * A medicine's thumbnail, resolved by the app from its catalogue (never chosen by the model).
 * Unconfirmed it is a dashed outline of the reported form; on confirmation the outline turns away
 * and the drawn medicine springs in with a check badge (after Fold's placeholder-to-logo morph:
 * rotate + fade out, spring scale-in with a slight overshoot).
 */
export function MedicineThumb({ look, confirmed, badge = true }: { look: MedicineLook; confirmed: boolean; badge?: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  const p = useSharedValue(confirmed ? 1 : 0);
  useEffect(() => { p.set(reducedMotion ? withTiming(confirmed ? 1 : 0, { duration: 160 }) : withSpring(confirmed ? 1 : 0, { duration: 380, dampingRatio: 0.72 })); }, [confirmed, reducedMotion, p]);
  const ghost = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.6], [1, 0], "clamp"), transform: reducedMotion ? [] : [{ rotate: `${-14 * p.value}deg` }, { scale: 1 + 0.1 * p.value }] }));
  const solid = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.1, 0.6], [0, 1], "clamp"), transform: reducedMotion ? [] : [{ rotate: `${10 * (1 - p.value)}deg` }, { scale: 0.72 + 0.28 * p.value }] }));
  const check = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.3, 0.8], [0, 1], "clamp"), transform: [{ scale: reducedMotion ? 1 : interpolate(p.value, [0, 1], [0.6, 1]) }] }));
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 44, height: 44 }}>
    <Animated.View style={[{ position: "absolute", inset: 0, borderRadius: 13, borderCurve: "continuous", backgroundColor: "rgba(20,28,40,0.035)" }, ghost]}><Form look={look} ghost /></Animated.View>
    <Animated.View style={[{ position: "absolute", inset: 0, borderRadius: 13, borderCurve: "continuous", backgroundColor: look.tint }, solid]}><Form look={look} /></Animated.View>
    {badge && <Animated.View style={[{ position: "absolute", right: -3, bottom: -3, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: palette.white, backgroundColor: palette.blue, alignItems: "center", justifyContent: "center" }, check]}>
      <Icon name="checkmark" size={8} color={palette.white} />
    </Animated.View>}
  </View>;
}
