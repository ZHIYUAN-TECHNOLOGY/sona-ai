import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeInRight, FadeOut, FadeOutLeft, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Circle } from "react-native-svg";
import { EASE_OUT, riseIn } from "@/components/sona/motion";
import { DrawnCheck, Mark } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Icon, glass, pillStyle, useAccessibleEffects } from "@/components/sona/ui";
import { LockedAction } from "@/features/live/roles";
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

/** Checks left, as the prescribe card's ring counts them: amber once a recorded risk stops the case, a check when none are left. */
function Ring({ left, total, stop }: { left: number; total: number; stop: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  const r = 13, length = 2 * Math.PI * r;
  const done = total - left;
  const p = useSharedValue(total ? done / total : 0);
  useEffect(() => { p.set(reducedMotion ? done / total : withTiming(done / total, { duration: 420, easing: EASE_OUT })); }, [done, total, reducedMotion, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - p.value) }));
  return <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
    <Svg width={32} height={32} style={StyleSheet.absoluteFill}>
      <Circle cx={16} cy={16} r={r} stroke="rgba(20,28,40,0.1)" strokeWidth={2.5} fill="none" />
      <AnimatedCircle cx={16} cy={16} r={r} stroke={stop ? palette.amber : left ? palette.blue : palette.green} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray={length} animatedProps={props} transform="rotate(-90 16 16)" />
    </Svg>
    {left ? <Text style={{ ...type.overline, color: palette.ink, fontVariant: ["tabular-nums"] }}>{left}</Text> : <DrawnCheck size={14} color={palette.green} strokeWidth={2.2} />}
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
  const last = steps.at(-1)!;
  // The last step is prescribing itself; the ones before it are the card's checks.
  const checks = steps.length - 1, left = steps.slice(0, -1).filter(step => !step.done).length;
  const stop = Boolean(current?.stop);
  const status = !current ? "All steps done" : stop ? "Outside the supported case · not prescribing" : left ? `${left} left before prescribing` : "Ready to prescribe";
  const style = useAnimatedStyle(() => reducedMotion ? { opacity: 1 - p.value } : {
    opacity: interpolate(p.value, [0, 0.6], [1, 0], "clamp"),
    transform: [{ translateY: 40 * p.value }, { scale: 1 - 0.18 * p.value }],
  });
  const swipeUp = Gesture.Pan().activeOffsetY(-12).failOffsetX([-20, 20]).onEnd(e => { if (e.translationY < -24 || e.velocityY < -300) scheduleOnRN(onExpand); });
  const action = current?.action ?? last.action;
  return <GestureDetector gesture={swipeUp}>
    <Animated.View entering={reducedMotion ? FadeIn.duration(160) : riseIn({ distance: 16, scale: 0.94, duration: 360 })} exiting={FadeOut.duration(140)}
      style={[{ ...pillStyle, experimental_backgroundImage: undefined, backgroundColor: "rgba(250,251,253,0.95)", borderRadius: 28, height: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 10, paddingRight: 8 }, style]}>
      <Pressable accessibilityRole="button" accessibilityLabel={current ? `${status}. Next step, ${current.label}` : status} accessibilityHint="Shows every remaining step" onPress={onExpand}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
        <Ring left={left} total={checks} stop={stop} />
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Text numberOfLines={1} style={{ ...type.overline, color: !current ? palette.green : stop ? palette.amber : palette.muted }}>{status}</Text>
          <Animated.View key={current?.id ?? "done"} entering={reducedMotion ? FadeIn.duration(160) : FadeInRight.duration(260)} exiting={reducedMotion ? FadeOut.duration(120) : FadeOutLeft.duration(180)}>
            <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{current?.label ?? "Prescription simulated"}</Text>
          </Animated.View>
        </View>
        <Icon name="chevron.up" size={11} color={palette.muted} />
      </Pressable>
      {/* A role that can't prescribe sees the lock; the sheet's locked row says who can. */}
      {current?.locked ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel="Needs a doctor to prescribe. Locked" accessibilityHint="Shows every remaining step" onPress={onExpand} hitSlop={6}
        style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(20,28,40,0.06)" }}>
        <Icon name="lock.fill" size={12} color={palette.muted} />
        <Text style={{ ...type.callout, fontWeight: "600", color: palette.muted }}>Needs a doctor</Text>
      </Pressable>
      : <Action label={action.label} accessibilityLabel={`${action.label}: ${current?.label ?? "view receipt"}`} onPress={() => onAct(current ?? last)} />}
    </Animated.View>
  </GestureDetector>;
}

/** Every step toward the simulation, in order, each with its own action. Drag down or tap outside to close. */
export function NextStepSheet({ steps, p, onClose, onAct }: { steps: Step[]; p: SharedValue<number>; onClose: () => void; onAct: (step: Step) => void }) {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const drag = useSharedValue(0);
  const current = steps.find(step => !step.done);
  const left = steps.slice(0, -1).filter(step => !step.done).length;
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
      <Animated.View accessibilityViewIsModal onAccessibilityEscape={onClose} style={[{ position: "absolute", left: 10, right: 10, bottom: Math.max(insets.bottom, 12), borderRadius: radius.sheet, borderCurve: "continuous", borderWidth: 1, borderColor: glass.rim, backgroundColor: palette.surface, boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 18px 48px rgba(24,32,48,0.18)", paddingTop: 8, paddingBottom: 14 }, sheet]}>
        {/* The grabber is the sheet's Close, so VoiceOver finds it inside the sheet (the backdrop is outside the modal region). */}
        <Pressable accessibilityRole="button" accessibilityLabel="Close steps" onPress={onClose} hitSlop={{ top: 12, bottom: 16, left: 40, right: 40 }} style={{ alignSelf: "center" }}><View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: "rgba(20,28,40,0.14)" }} /></Pressable>
        <View style={{ flexDirection: "row", alignItems: "baseline", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 }}>
          <Text accessibilityRole="header" style={{ flex: 1, ...type.heading, color: palette.ink }}>Before prescribing</Text>
          <Text style={{ ...type.footnote, color: palette.muted, fontVariant: ["tabular-nums"] }}>{left ? `${left} left` : "Checks passed"}</Text>
        </View>
        {steps.map((step, i) => {
          const now = step.id === current?.id;
          return <Animated.View key={step.id} entering={reducedMotion ? undefined : riseIn({ delay: 60 + i * 40, distance: 10, duration: 300 })}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 10, paddingHorizontal: 10, paddingVertical: 11, borderRadius: radius.group, borderCurve: "continuous", backgroundColor: now ? "rgba(36,91,204,0.07)" : "transparent" }}>
            <Mark state={step.done ? "done" : step.stop ? "blocked" : now ? "pending" : "open"} size={22} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ ...type.subhead, fontWeight: now ? "600" : "500", color: step.done ? palette.muted : palette.ink, textDecorationLine: step.done ? "line-through" : "none" }}>{step.label}</Text>
              <Text numberOfLines={1} style={{ ...type.caption, color: palette.muted }}>{step.detail}</Text>
            </View>
            {step.locked ? <LockedAction label="Needs a doctor" path="prescribing.simulate" height={34} />
            // A compact 34 pt row button: Action is 46 pt and would grow every row.
            : (!step.done || step.action.type === "receipt") && <Pressable accessibilityRole="button" accessibilityLabel={`${step.action.label}: ${step.label}`} onPress={() => onAct(step)} hitSlop={8}>
              {({ pressed }) => <Animated.View style={{ minHeight: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: "center", backgroundColor: now ? palette.ink : "rgba(20,28,40,0.06)", transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 }}>
                <Text style={{ ...type.subhead, fontWeight: "600", color: now ? palette.white : palette.ink }}>{step.action.label}</Text>
              </Animated.View>}
            </Pressable>}
          </Animated.View>;
        })}
      </Animated.View>
    </GestureDetector>
  </View>;
}
