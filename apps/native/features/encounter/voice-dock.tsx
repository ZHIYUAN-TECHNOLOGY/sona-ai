import { Text } from "@/components/sona/text";
import { palette } from "@/components/sona/theme";
import { Icon } from "@/components/sona/ui";
import { useAccessibleEffects } from "@/components/sona/ui";
import { riseIn } from "@/components/sona/motion";
import { LiquidVeil } from "@/components/sona/liquid-veil";
import { GlassOrb } from "@/components/sona/glass-orb";
import { OrbGlyph, type OrbActivity } from "@/components/sona/orb-glyph";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AccessibilityInfo, Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cubicBezier, FadeIn, FadeOut, useAnimatedKeyboard, useAnimatedStyle, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const ORB = 64;

type Mode = "idle" | "holding" | "handsfree" | "composing";
/** Silence after the last heard word before a hands-free request is sent. */
const ENDPOINT_MS = 1300;
type Props = {
  /** Status text while a response is being prepared. Undefined when idle. */
  thinking?: string;
  /** What the orb shows while Sona works (or a brief "done"). */
  activity?: OrbActivity;
  onCancel: () => void;
  onSubmit: (prompt: string) => void;
  /** Authored transcript used by the hold-to-talk fixture; no microphone is recorded. */
  spokenPrompt: string;
  placeholder: string;
  draft: string;
  onDraft: (value: string) => void;
  voiceEnabled: boolean;
  onVoiceDisabled: () => void;
  onImage: () => void;
  onConsultation: () => void;
  onNote: () => void;
  above?: ReactNode;
  /** Screen content captured for the liquid hold-to-talk veil. */
  backdrop: RefObject<View | null>;
};

function haptic(kind: "light" | "select") {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "light" ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync()).catch(() => {});
}

// Composer grows out of the dock, anchored at its bottom edge.
function composerEntering() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 14 }, { scale: 0.94 }] },
    animations: { opacity: withTiming(1, { duration: 200 }), transform: [{ translateY: withSpring(0, { duration: 380, dampingRatio: 0.86 }) }, { scale: withSpring(1, { duration: 380, dampingRatio: 0.86 }) }] },
  };
}
function dockEntering() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 10 }, { scale: 0.92 }] },
    animations: { opacity: withTiming(1, { duration: 220 }), transform: [{ translateY: withSpring(0, { duration: 360, dampingRatio: 0.84 }) }, { scale: withSpring(1, { duration: 360, dampingRatio: 0.84 }) }] },
  };
}

function RoundButton({ icon, label, onPress, hidden }: { icon: string; label: string; onPress: () => void; hidden?: boolean }) {
  return <Animated.View pointerEvents={hidden ? "none" : "auto"} style={{ opacity: hidden ? 0 : 1, transform: [{ scale: hidden ? 0.6 : 1 }], transitionProperty: ["opacity", "transform"], transitionDuration: 260, transitionTimingFunction: EASE_OUT }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityElementsHidden={hidden} onPress={onPress} hitSlop={6}
      style={({ pressed }) => ({ width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.92)", boxShadow: "0 4px 14px rgba(24,32,48,0.10)", transform: [{ scale: pressed ? 0.94 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
      <Icon name={icon} size={19} />
    </Pressable>
  </Animated.View>;
}

/** Voice-first dock: tap to talk hands-free, or hold to talk and release to send; keyboard morphs into a composer. */
export function VoiceDock(props: Props) {
  const { thinking, activity, onCancel, onSubmit, spokenPrompt, placeholder, draft, onDraft, voiceEnabled, onVoiceDisabled, above, backdrop } = props;
  const insets = useSafeAreaInsets();
  const { reducedMotion, reducedTransparency } = useAccessibleEffects();
  const [mode, setMode] = useState<Mode>("idle");
  const [used, setUsed] = useState(false);
  const [armed, setArmed] = useState(false);
  const [words, setWords] = useState(0);
  const [flooding, setFlooding] = useState(false);
  const [veilFailed, setVeilFailed] = useState(false);
  const modeRef = useRef(mode); modeRef.current = mode;
  const wordsRef = useRef(words); wordsRef.current = words;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const screenReader = useRef(false);
  const transcript = spokenPrompt.split(" ");
  const keyboard = useAnimatedKeyboard();
  const composerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.height.value - insets.bottom) }] }));

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clear, []);
  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(value => { screenReader.current = value; });
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", value => { screenReader.current = value; });
    return () => sub.remove();
  }, []);
  useEffect(() => { if (thinking) { clear(); setMode(current => current === "composing" ? current : "idle"); } }, [thinking]);

  const listen = (next: "holding" | "handsfree") => {
    clear(); setUsed(true); setWords(0); setFlooding(false); setMode(next); haptic("light");
    transcript.forEach((_, i) => timers.current.push(setTimeout(() => {
      setWords(i + 1);
      // Hands-free ends on a pause after the last word, like a real voice endpoint.
      if (next === "handsfree" && i === transcript.length - 1) timers.current.push(setTimeout(() => finish(true), ENDPOINT_MS));
    }, 380 + i * 170)));
  };
  const finish = (send: boolean) => {
    clear();
    const heard = wordsRef.current;
    setWords(0); setMode("idle");
    if (send && heard > 0) { haptic("select"); setFlooding(true); onSubmit(spokenPrompt); }
  };
  const tapOrb = () => {
    if (!voiceEnabled) { onVoiceDisabled(); return; }
    if (screenReader.current) { onSubmit(spokenPrompt); return; }
    if (modeRef.current === "handsfree") finish(true); else listen("handsfree");
  };
  const startHold = () => {
    if (!voiceEnabled) { onVoiceDisabled(); return; }
    if (modeRef.current !== "handsfree") listen("holding");
  };
  const release = () => { if (modeRef.current === "holding") finish(true); };
  // Gestures are built once and call the latest handlers, so re-renders (one per heard word) don't re-attach them.
  const handlers = useRef({ startHold, release, tapOrb, onCancel, arm: (on: boolean) => setArmed(on) });
  handlers.current = { startHold, release, tapOrb, onCancel, arm: (on: boolean) => setArmed(on) };
  const gestures = useMemo(() => {
    const hold = Gesture.LongPress().minDuration(400).maxDistance(60).runOnJS(true)
      .onBegin(() => handlers.current.arm(true)).onStart(() => handlers.current.startHold())
      .onFinalize(() => { handlers.current.arm(false); handlers.current.release(); });
    const tap = Gesture.Tap().runOnJS(true).onEnd(() => handlers.current.tapOrb());
    const stop = Gesture.Tap().runOnJS(true).onEnd(() => handlers.current.onCancel());
    return { listen: Gesture.Exclusive(hold, tap), stop };
  }, []);
  const micGesture = thinking ? gestures.stop : gestures.listen;

  const holding = mode === "holding" || mode === "handsfree", handsfree = mode === "handsfree", busy = Boolean(thinking);
  const liquid = !reducedTransparency && !veilFailed;
  const scrim = busy || (holding && !liquid);
  const veil = holding ? "listening" : flooding && busy ? "flood" : "idle";
  const send = () => { const value = draft.trim(); if (!value) return; onSubmit(value); Keyboard.dismiss(); };

  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {liquid && <LiquidVeil backdrop={backdrop} state={veil} armed={armed && !busy} words={words} reducedMotion={reducedMotion} onUnavailable={() => setVeilFailed(true)} />}
    {/* Frosted focus layer: a static blur crossfaded by opacity. */}
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: scrim ? 1 : 0, transitionProperty: "opacity", transitionDuration: scrim ? 320 : 240, transitionTimingFunction: EASE_OUT }]}>
      {reducedTransparency ? <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(236,239,244,0.94)" }]} /> : <BlurView tint="light" intensity={38} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(232,236,243,0.28)" }]} />
    </Animated.View>

    {holding && <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)} pointerEvents="none" style={{ position: "absolute", left: 32, right: 32, bottom: insets.bottom + 132, alignItems: "center" }}>
      <Text accessibilityLiveRegion="polite" style={{ textAlign: "center", fontSize: 25, lineHeight: 32, letterSpacing: -0.4, fontWeight: "500", color: words ? palette.ink : palette.muted }}>{words ? transcript.slice(0, words).join(" ") : "Listening…"}</Text>
      <Text style={{ marginTop: 10, fontSize: 13, fontWeight: "500", color: palette.ink }}>{handsfree ? "Pause or tap the orb to send" : "Release to send"}</Text>
      <Text style={{ marginTop: 4, fontSize: 12, color: palette.muted }}>Sample voice command · no audio is recorded</Text>
    </Animated.View>}

    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 12) + 4, gap: 10 }}>
      {mode !== "composing" && above && <View pointerEvents="box-none" style={{ paddingHorizontal: 20, gap: 8 }}>{above}</View>}

      {mode === "composing" ? <Animated.View key="composer" entering={reducedMotion ? FadeIn.duration(150) : composerEntering} exiting={FadeOut.duration(120)} style={[{ marginHorizontal: 12, transformOrigin: "bottom" }, composerStyle]}>
        <View style={{ backgroundColor: palette.white, borderRadius: 26, borderCurve: "continuous", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 12, boxShadow: "0 8px 30px rgba(24,32,48,0.12)" }}>
          <TextInput autoFocus onBlur={() => setMode(current => current === "composing" ? "idle" : current)} accessibilityLabel="Ask Sona" value={draft} onChangeText={onDraft} placeholder={placeholder} placeholderTextColor="#8A9099" multiline onSubmitEditing={send} style={{ fontSize: 17, lineHeight: 22, color: palette.ink, maxHeight: 120, minHeight: 26 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Attach or review a chest X-ray" onPress={props.onImage} hitSlop={4} style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}><Icon name="photo" size={20} color={palette.muted} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Start the consultation recorder" onPress={props.onConsultation} hitSlop={4} style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}><Icon name="waveform" size={20} color={palette.muted} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Open the consultation note" onPress={props.onNote} hitSlop={4} style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}><Icon name="doc.text" size={19} color={palette.muted} /></Pressable>
            <View style={{ flex: 1 }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Send message" accessibilityState={{ disabled: !draft.trim() }} disabled={!draft.trim()} onPress={send}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: draft.trim() ? palette.ink : "#C9CDD3", transitionProperty: "backgroundColor", transitionDuration: 160 } as never}>
              <Icon name="arrow.up" size={16} color={palette.white} />
            </Pressable>
          </View>
        </View>
      </Animated.View>
      : <Animated.View key="dock" entering={reducedMotion ? undefined : dockEntering} exiting={FadeOut.duration(100)} style={{ height: 64, marginHorizontal: 20, justifyContent: "center" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          {handsfree ? <RoundButton icon="xmark" label="Cancel voice input" onPress={() => finish(false)} /> : <RoundButton icon="plus" label="Attach or review a chest X-ray" onPress={props.onImage} hidden={holding || busy} />}
          <RoundButton icon="keyboard" label="Type a message" onPress={() => setMode("composing")} hidden={holding || busy} />
        </View>

        {/* Coach mark until the first voice request: states both gestures up front. */}
        {!used && !busy && mode === "idle" && <Animated.View entering={reducedMotion ? FadeIn.duration(120) : riseIn({ delay: 600, distance: 6, scale: 0.96, duration: 320 })} exiting={FadeOut.duration(140)} pointerEvents="none"
          style={{ position: "absolute", bottom: 76, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 6, paddingRight: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.94)", boxShadow: "0 6px 20px rgba(24,32,48,0.1)", transformOrigin: "bottom" }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#E4EDFD", alignItems: "center", justifyContent: "center" }}><Icon name="waveform" size={13} color={palette.blue} /></View>
          <Text style={{ fontSize: 13, fontWeight: "500", color: palette.ink }}>Tap or hold to talk</Text>
        </Animated.View>}

        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, alignItems: "center" }}>
          {busy && <Animated.View key={thinking} entering={riseIn({ distance: 6, scale: 0.96, duration: 240 })} exiting={FadeOut.duration(120)} pointerEvents="none"
            style={{ position: "absolute", bottom: ORB + 10, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.9)", boxShadow: "0 4px 14px rgba(24,32,48,0.1)" }}>
            <Icon name="stop.fill" size={9} color={palette.muted} />
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: palette.ink, animationName: reducedMotion ? undefined : { "0%": { opacity: 1 }, "50%": { opacity: 0.5 }, "100%": { opacity: 1 } }, animationDuration: 1600, animationIterationCount: "infinite" } as never}>{thinking}</Text>
          </Animated.View>}
          <GestureDetector gesture={micGesture}>
            <Animated.View accessible accessibilityRole="button" accessibilityLabel={busy ? `${thinking}. Stop response` : "Talk to Sona"} accessibilityHint={busy ? undefined : handsfree ? "Double-tap to send what you said." : "Tap to talk hands-free, or hold and release to send. With VoiceOver, double-tap to use the sample command."} accessibilityActions={[{ name: "activate" }]} onAccessibilityAction={() => busy ? onCancel() : onSubmit(spokenPrompt)}
              style={{ width: ORB, height: ORB, borderRadius: ORB / 2, alignItems: "center", justifyContent: "center", transform: [{ scale: holding ? 1.12 : 1 }], transitionProperty: "transform", transitionDuration: 320, transitionTimingFunction: EASE_OUT } as never}>
              {/* Two pre-shadowed layers crossfaded by opacity: animating boxShadow would repaint it every frame. */}
              <Animated.View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: ORB / 2, backgroundColor: palette.white, boxShadow: "0 8px 22px rgba(40,70,140,0.22)", opacity: holding ? 0 : 1, transitionProperty: "opacity", transitionDuration: 320, transitionTimingFunction: EASE_OUT }} />
              <Animated.View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: ORB / 2, backgroundColor: palette.white, boxShadow: "0 10px 28px rgba(60,100,200,0.32)", opacity: holding ? 1 : 0, transitionProperty: "opacity", transitionDuration: 320, transitionTimingFunction: EASE_OUT }} />
              <View style={{ position: "absolute", inset: 0 }}><GlassOrb size={ORB} energy={holding ? 1 : busy ? 0.7 : 0} still={reducedMotion} /></View>
              <OrbGlyph activity={holding ? "listening" : activity ?? (busy ? "searching" : "idle")} still={reducedMotion} />
            </Animated.View>
          </GestureDetector>
        </View>
      </Animated.View>}
    </View>
  </View>;
}
