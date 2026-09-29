import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeInRight, FadeOut, FadeOutLeft, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Circle } from "react-native-svg";
import { EASE_OUT, riseIn } from "@/components/sona/motion";
import { Mark } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, glass, pillStyle, useAccessibleEffects } from "@/components/sona/ui";
import type { Step } from "./next-steps";

/*
 * "Next step" decision bar (after Moonlitt's floating bottom bar): a glass pill above the dock
 * names the one thing blocking progress and its action. Tap or swipe it up and it sinks away as a
 * sheet of every remaining step rises (0.45 s, damping 0.82); dismissing drops the sheet and the
 * pill springs back with a slight overshoot (0.5 s, damping 0.72). When a step completes, the
 * label slides out left and the next one slides in from the right, like the shot's status morph.
 */
const OPEN = { duration: 450, dampingRatio: 0.82 }, CLOSE = { duration: 500, dampingRatio: 0.72 };
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const haptic = () => { if (process.env.EXPO_OS === "ios") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };

function Ring({ done, total }: { done: number; total: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const r = 13, length = 2 * Math.PI * r;
  const p = useSharedValue(total ? done / total : 0);
  useEffect(() => { p.set(reducedMotion ? done / total : withTiming(done / total, { duration: 420, easing: EASE_OUT })); }, [done, total, reducedMotion, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - p.value) }));
  return <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
    <Svg width={32} height={32} style={StyleSheet.absoluteFill}>
      <Circle cx={16} cy={16} r={r} stroke="rgba(20,28,40,0.1)" strokeWidth={2.5} fill="none" />
      <AnimatedCircle cx={16} cy={16} r={r} stroke={palette.blue} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray={length} animatedProps={props} transform="rotate(-90 16 16)" />
    </Svg>
    <Text style={{ fontSize: 11, fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{done}</Text>
  </View>;
}

export function useNextStep() {
  const p = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const { reducedMotion } = useAccessibleEffects();
  const show = () => { haptic(); setOpen(true); p.set(reducedMotion ? withTiming(1, { duration: 200 }) : withSpring(1, OPEN)); };
  const hide = (then?: () => void) => {
    p.set(reducedMotion ? withTiming(0, { duration: 180 }) : withSpring(0, CLOSE));
    setTimeout(() => { setOpen(false); then?.(); }, reducedMotion ? 200 : 280);
  };
  return { p, open, show, hide };
}

export function NextStepBar({ steps, p, onExpand, onAct }: { steps: Step[]; p: SharedValue<number>; onExpand: () => void; onAct: (step: Step) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const current = steps.find(step => !step.done);
  const done = steps.filter(step => step.done).length;
  const last = steps.at(-1)!;
  const style = useAnimatedStyle(() => reducedMotion ? { opacity: 1 - p.value } : {
    opacity: interpolate(p.value, [0, 0.6], [1, 0], "clamp"),
    transform: [{ translateY: 40 * p.value }, { scale: 1 - 0.18 * p.value }],
  });
  const swipeUp = Gesture.Pan().activeOffsetY(-12).failOffsetX([-20, 20]).onEnd(e => { if (e.translationY < -24 || e.velocityY < -300) scheduleOnRN(onExpand); });
  const action = current?.action ?? last.action;
  return <GestureDetector gesture={swipeUp}>
    <Animated.View entering={reducedMotion ? FadeIn.duration(160) : riseIn({ distance: 16, scale: 0.94, duration: 360 })} exiting={FadeOut.duration(140)}
      style={[{ ...pillStyle, experimental_backgroundImage: undefined, backgroundColor: "rgba(250,251,253,0.95)", borderRadius: 28, height: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 10, paddingRight: 8 }, style]}>
      <Pressable accessibilityRole="button" accessibilityLabel={current ? `Next step, ${current.label}. ${done} of ${steps.length} done` : `All ${steps.length} steps done`} accessibilityHint="Shows every remaining step" onPress={onExpand}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
        <Ring done={done} total={steps.length} />
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Text style={{ ...type.overline, fontSize: 10, color: current ? palette.muted : palette.green }}>{current ? `Next step · ${done}/${steps.length}` : "All steps done"}</Text>
          <Animated.View key={current?.id ?? "done"} entering={reducedMotion ? FadeIn.duration(160) : FadeInRight.duration(260)} exiting={reducedMotion ? FadeOut.duration(120) : FadeOutLeft.duration(180)}>
            <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{current?.label ?? "Prescription simulated"}</Text>
          </Animated.View>
        </View>
        <Icon name="chevron.up" size={11} color={palette.muted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${action.label}: ${current?.label ?? "view receipt"}`} onPress={() => onAct(current ?? last)} hitSlop={6}
        style={({ pressed }) => ({ height: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: "center", backgroundColor: palette.ink, transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
        <Text style={{ ...type.callout, fontWeight: "600", color: palette.white }}>{action.label}</Text>
      </Pressable>
    </Animated.View>
  </GestureDetector>;
}

/** Every step toward the simulation, in order, each with its own action. Drag down or tap outside to close. */
export function NextStepSheet({ steps, p, onClose, onAct }: { steps: Step[]; p: SharedValue<number>; onClose: () => void; onAct: (step: Step) => void }) {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const drag = useSharedValue(0);
  const current = steps.find(step => !step.done);
  const done = steps.filter(step => step.done).length;
  const backdrop = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, p.value)) }));
  const sheet = useAnimatedStyle(() => ({ opacity: reducedMotion ? p.value : 1, transform: [{ translateY: (reducedMotion ? 0 : (1 - p.value) * 520) + drag.value }] }));
  const pull = Gesture.Pan().activeOffsetY(8).onUpdate(e => { drag.set(Math.max(0, e.translationY)); }).onEnd(e => {
    if (drag.value > 110 || e.velocityY > 800) { drag.set(withTiming(0, { duration: 280 })); scheduleOnRN(onClose); }
    else drag.set(withSpring(0, { duration: 350, dampingRatio: 0.8 }));
  });
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(20,28,40,0.18)" }, backdrop]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close steps" onPress={onClose} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <GestureDetector gesture={pull}>
      <Animated.View accessibilityViewIsModal style={[{ position: "absolute", left: 10, right: 10, bottom: Math.max(insets.bottom, 12), borderRadius: 34, borderCurve: "continuous", borderWidth: 1, borderColor: glass.rim, backgroundColor: "#FAFBFD", boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 18px 48px rgba(24,32,48,0.18)", paddingTop: 8, paddingBottom: 14 }, sheet]}>
        <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "rgba(20,28,40,0.14)" }} />
        <View style={{ flexDirection: "row", alignItems: "baseline", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 }}>
          <Text accessibilityRole="header" style={{ flex: 1, ...type.heading, color: palette.ink }}>Before prescribing</Text>
          <Text style={{ ...type.footnote, color: palette.muted, fontVariant: ["tabular-nums"] }}>{done} of {steps.length} done</Text>
        </View>
        {steps.map((step, i) => {
          const now = step.id === current?.id;
          return <Animated.View key={step.id} entering={reducedMotion ? undefined : riseIn({ delay: 60 + i * 40, distance: 10, duration: 300 })}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 10, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 18, borderCurve: "continuous", backgroundColor: now ? "rgba(36,91,204,0.07)" : "transparent" }}>
            <Mark state={step.done ? "done" : now ? "pending" : "open"} size={22} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ ...type.subhead, fontWeight: now ? "600" : "500", color: step.done ? palette.muted : palette.ink, textDecorationLine: step.done ? "line-through" : "none" }}>{step.label}</Text>
              <Text numberOfLines={1} style={{ ...type.caption, color: palette.muted }}>{step.detail}</Text>
            </View>
            {(!step.done || step.action.type === "receipt") && <Pressable accessibilityRole="button" accessibilityLabel={`${step.action.label}: ${step.label}`} onPress={() => onAct(step)} hitSlop={8}
              style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: "center", backgroundColor: now ? palette.ink : "rgba(20,28,40,0.06)", opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ ...type.subhead, fontWeight: "600", color: now ? palette.white : palette.ink }}>{step.action.label}</Text>
            </Pressable>}
          </Animated.View>;
        })}
      </Animated.View>
    </GestureDetector>
  </View>;
}
