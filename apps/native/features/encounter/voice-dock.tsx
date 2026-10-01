import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { Text } from "@/components/sona/text";
import { useLive } from "@/features/live";
import { useVoiceInput } from "@/features/live/voice-input";
import { palette, type, radius } from "@/components/sona/theme";
import { Icon } from "@/components/sona/ui";
import { SampleLabel } from "@/components/sona/model-answer";
import { RoundAction, useAccessibleEffects } from "@/components/sona/ui";
import { EASE_OUT_CSS, riseIn } from "@/components/sona/motion";
import { LiquidVeil } from "@/components/sona/liquid-veil";
import { GlassOrb } from "@/components/sona/glass-orb";
import { Bars, OrbGlyph, type OrbActivity } from "@/components/sona/orb-glyph";
import { loudness } from "@/features/live/turn";
import { HalftoneGlint, HalftoneShimmer } from "@/components/sona/halftone-shimmer";
import { BrandIcon, type BrandIconName } from "@/components/sona/brand-icon";
import { AttachmentStack, AttachmentStrip } from "@/components/sona/attachment-stack";
import { AttachmentsMenu, MENU_CLOSE, MENU_SPRING, type Attachment } from "@/components/sona/attachments-menu";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AccessibilityInfo, ActivityIndicator, Keyboard, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, FadeOut, interpolate, useAnimatedReaction, withDelay, withSequence, withSpring, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type EntryAnimationsValues } from "react-native-reanimated";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ORB = 64;

type Mode = "idle" | "holding" | "handsfree" | "composing";
/** Silence after the last heard word before a hands-free request is sent. */
const ENDPOINT_MS = 1300;
const NONE: Attachment[] = [];
/** The coach mark shows once per app session, on whichever dock first has room for it. */
let coachSeen = false;
type Props = {
  /** Status text while a response is being prepared. Undefined when idle. */
  thinking?: string;
  /** What the orb shows while Sona works (or a brief "done"). */
  activity?: OrbActivity;
  onCancel: () => void;
  onSubmit: (prompt: string) => void;
  /** Demo mode: the authored words the voice sample "hears" (live mode records the microphone instead). */
  spokenPrompt: string;
  placeholder: string;
  draft: string;
  onDraft: (value: string) => void;
  voiceEnabled: boolean;
  onVoiceDisabled: () => void;
  /** Live mode: why speech didn't become words (microphone off, nothing heard, model starting); the page shows it. */
  onVoiceError?: (message: string) => void;
  /** The visit's tools (the + menu and the composer's X-ray, recorder and note buttons); pages outside a visit leave them out. */
  onImage?: () => void;
  onConsultation?: () => void;
  onNote?: () => void;
  above?: ReactNode;
  /** The page's ✦ suggestion, carried in the idle bar between the keyboard and the orb; without one the bar shows the placeholder and opens the composer. */
  suggestion?: { text: string; onPress: () => void; label?: string };
  /** Hides the first-run coach mark while something else sits above the dock. */
  quiet?: boolean;
  /** A photo, capture or file chosen from the attachments menu. */
  /** Attachments waiting to be sent with the next question. */
  attachments?: Attachment[];
  onAttachmentsChange?: (items: Attachment[]) => void;
  /** Screen content captured for the liquid hold-to-talk veil. */
  backdrop: RefObject<View | null>;
};

function haptic(kind: "light" | "select") {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "light" ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync()).catch(() => {});
}

// Dock bar <-> composer morph (after Monogram's keyboard icon morph): one bottom-anchored
// surface grows from the button row into the composer card, driven by the system keyboard's
// own progress so both move together. With a hardware keyboard (no on-screen keyboard) a
// timed fallback drives the same progress.
const BAR_H = 76, BAR_R = 38, CARD_R = 26, CARD_INSET = -8;
// Close to the iOS keyboard slide so the fallback reads the same.
const FALLBACK = { duration: 260, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };

function RoundButton({ icon, label, onPress, hidden, reduced }: { icon: BrandIconName; label: string; onPress: () => void; hidden?: boolean; reduced?: boolean }) {
  // Liquid Glass on iOS 26+ (it answers the touch itself); a frosted disc before that, solid with Reduce Transparency.
  const { reducedTransparency } = useAccessibleEffects();
  const liquid = process.env.EXPO_OS === "ios" && isLiquidGlassAvailable() && !reducedTransparency;
  // Reduce Motion: the buttons only fade; no shrink.
  return <Animated.View pointerEvents={hidden ? "none" : "auto"} style={{ opacity: hidden ? 0 : 1, transform: [{ scale: hidden && !reduced ? 0.6 : 1 }], transitionProperty: ["opacity", "transform"], transitionDuration: 260, transitionTimingFunction: EASE_OUT_CSS }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityElementsHidden={hidden} onPress={onPress} hitSlop={6}>
      {({ pressed }) => <Animated.View style={{ width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: liquid ? "transparent" : reducedTransparency ? "rgba(255,255,255,0.97)" : "rgba(255,255,255,0.72)", borderWidth: liquid ? 0 : 1, borderColor: "rgba(255,255,255,0.9)", boxShadow: liquid ? undefined : "0 4px 16px rgba(40,70,140,0.10)", transform: [{ scale: pressed && !reduced ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 }}>
        {liquid && <GlassView colorScheme="light" glassEffectStyle="regular" isInteractive tintColor="rgba(255,255,255,0.2)" style={[StyleSheet.absoluteFill, { borderRadius: 25 }]} />}
        <BrandIcon name={icon} size={23} />
      </Animated.View>}
    </Pressable>
  </Animated.View>;
}

// On release the orb folds into a dark loading pill while the words are read (after Monogram's mic → loading pill),
// on the stop glyph's spring (Apple Messages: response 0.4 s, damping 0.8). It starts as the orb's own circle and
// grows left (the frame animates, so the origin moves with the width to keep the right edge on the orb's).
const MORPH = { duration: 400, dampingRatio: 0.8 }, PILL_H = 40;
function pillIn(v: EntryAnimationsValues) {
  "worklet";
  return {
    initialValues: { originX: v.targetOriginX + v.targetWidth - ORB, originY: v.targetOriginY - (ORB - PILL_H) / 2, width: ORB, height: ORB, borderRadius: ORB / 2, opacity: 0 },
    animations: {
      originX: withSpring(v.targetOriginX, MORPH), originY: withSpring(v.targetOriginY, MORPH), width: withSpring(v.targetWidth, MORPH), height: withSpring(PILL_H, MORPH),
      borderRadius: withSpring(PILL_H / 2, MORPH), opacity: withTiming(1, { duration: 160 }),
    },
  };
}

/** Heard words, each fading in as it arrives (after Monogram's live transcript). Only the last 36, so a long turn never climbs the screen. */
function Words({ text, reduced }: { text: string; reduced: boolean }) {
  const all = text.split(/\s+/), from = Math.max(0, all.length - 36);
  return <View accessible accessibilityLabel={text} accessibilityLiveRegion="polite" style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: 7 }}>
    {all.slice(from).map((word, i) => <Animated.View key={from + i} entering={reduced ? FadeIn.duration(150) : riseIn({ distance: 6, duration: 300 })}>
      <Text style={{ ...type.display, fontWeight: "500", color: palette.ink }}>{word}</Text>
    </Animated.View>)}
  </View>;
}

/** Composer tool: bare icon at rest, a small glass bubble under the finger. */
function ToolButton({ icon, label, onPress }: { icon: BrandIconName; label: string; onPress: () => void }) {
  const reduced = useReduceMotionPreference();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}>
    {({ pressed }) => <Animated.View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0)", transform: [{ scale: pressed && !reduced ? 0.96 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 120 }}>
      <BrandIcon name={icon} size={21} color={palette.muted} />
    </Animated.View>}
  </Pressable>;
}

/** Voice-first dock: tap to talk hands-free, or hold to talk and release to send; keyboard morphs into a composer. */
export function VoiceDock(props: Props) {
  const glass = process.env.EXPO_OS === "ios" && isLiquidGlassAvailable();
  const { thinking, activity, onCancel, onSubmit, spokenPrompt, placeholder, draft, onDraft, voiceEnabled, onVoiceDisabled, above, backdrop, quiet, suggestion } = props;
  const insets = useSafeAreaInsets();
  const { reducedMotion, reducedTransparency } = useAccessibleEffects();
  const [mode, setMode] = useState<Mode>("idle");
  const [used, setUsed] = useState(false);
  // The coach mark says its piece and steps aside, so it never sits over the actions on the page behind it.
  const [coached, setCoached] = useState(coachSeen);
  const [menu, setMenu] = useState(false);
  const menuProgress = useSharedValue(0), menuExtend = useSharedValue(0);
  const [armed, setArmed] = useState(false);
  const [words, setWords] = useState(0);
  const [flooding, setFlooding] = useState(false);
  const [veilFailed, setVeilFailed] = useState(false);
  const modeRef = useRef(mode); modeRef.current = mode;
  const wordsRef = useRef(words); wordsRef.current = words;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const screenReader = useRef(false);
  const transcript = spokenPrompt.split(" ");
  // Live mode hears the microphone (Sona speech on the server); demo mode plays the labelled sample.
  const { on: live } = useLive();
  const mic = useVoiceInput({
    onHeard: (text, how) => {
      // Holding sends at once; a tap puts the words in the text box to check before sending.
      if (how === "hold") { haptic("select"); setFlooding(true); onSubmit(text); }
      else { onDraft(text); setMode("composing"); }
    },
    onError: message => { setMode(current => (current === "holding" || current === "handsfree" ? "idle" : current)); props.onVoiceError?.(message); },
  });
  // Each burst of speech is one gust of light in the veil, as each sample word is.
  const [gusts, setGusts] = useState(0);
  useEffect(() => { if (mic.speaking) setGusts(g => g + 1); }, [mic.speaking]);
  // The voice bars' level, on the UI thread: live, the recorder's metering (10 a second, eased between readings); the
  // sample pulses once per scripted word. Only the shared value changes, so the bars never re-render.
  const level = useSharedValue(0);
  useEffect(() => { if (live) level.set(withTiming(mic.state === "listening" ? loudness(mic.level) : 0, { duration: 100 })); }, [live, mic.level, mic.state]);
  useEffect(() => { if (!live && words) level.set(withSequence(withTiming(0.8, { duration: 90 }), withTiming(0.2, { duration: 260 }))); }, [live, words]);
  // The orb stays "listening" through reading the words, then settles once the microphone is done.
  const wasHearing = useRef(false);
  useEffect(() => {
    if (mic.state !== "idle") { wasHearing.current = true; return; }
    if (wasHearing.current) { wasHearing.current = false; setMode(current => (current === "holding" || current === "handsfree" ? "idle" : current)); }
  }, [mic.state]);
  const { width: screenW } = useWindowDimensions();
  // Keyboard-synced morph progress: follows the on-screen keyboard frame by frame when there is one.
  const composing = useSharedValue(0);
  const kbHeight = useSharedValue(0), kbProgress = useSharedValue(0), soft = useSharedValue(0), fallback = useSharedValue(0);
  useKeyboardHandler({
    onStart: e => { "worklet"; if (e.height > 0) soft.set(1); },
    onMove: e => { "worklet"; kbHeight.set(e.height); kbProgress.set(e.progress); },
    onInteractive: e => { "worklet"; kbHeight.set(e.height); kbProgress.set(e.progress); },
    onEnd: e => { "worklet"; kbHeight.set(e.height); kbProgress.set(e.progress); if (e.height === 0) soft.set(0); },
  }, []);
  // The on-screen keyboard drives the morph whenever there is one; the fallback only covers a
  // hardware keyboard. It starts a beat late so a real keyboard's onStart claims it first.
  const morph = useDerivedValue(() => (soft.value ? kbProgress.value : fallback.value));
  const cardH = useSharedValue(112);
  const [composerMounted, setComposerMounted] = useState(false);

  useEffect(() => {
    composing.set(mode === "composing" ? 1 : 0);
    if (mode === "composing") setComposerMounted(true);
    fallback.set(reducedMotion ? (mode === "composing" ? 1 : 0) : mode === "composing" ? withDelay(140, withTiming(1, FALLBACK)) : withTiming(0, FALLBACK));
  }, [mode, reducedMotion]);
  // Keep the composer mounted until the surface has folded back into the bar.
  useAnimatedReaction(() => morph.value < 0.01 && !composing.value, (closed, was) => { if (closed && was === false) scheduleOnRN(setComposerMounted, false); });

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clear, []);
  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(value => { screenReader.current = value; });
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", value => { screenReader.current = value; });
    return () => sub.remove();
  }, []);
  useEffect(() => { if (thinking) { clear(); setMode(current => current === "composing" ? current : "idle"); } }, [thinking]);
  // VoiceOver hears that work started once; the workspace announces when the answer is ready.
  useEffect(() => { if (thinking) AccessibilityInfo.announceForAccessibility(thinking); }, [Boolean(thinking)]);

  const listen = (next: "holding" | "handsfree") => {
    clear(); setUsed(true); coachSeen = true; setWords(0); setFlooding(false); setMode(next); haptic("light");
    if (live) { void mic.start(next === "holding" ? "hold" : "tap"); return; }
    transcript.forEach((_, i) => timers.current.push(setTimeout(() => {
      setWords(i + 1);
      // Hands-free ends on a pause after the last word, like a real voice endpoint.
      if (next === "handsfree" && i === transcript.length - 1) timers.current.push(setTimeout(() => finish(true), ENDPOINT_MS));
    }, 380 + i * 170)));
  };
  const finish = (send: boolean) => {
    clear();
    if (live) { void mic.stop(send); return; }
    const heard = wordsRef.current;
    setWords(0); setMode("idle");
    if (send && heard > 0) { haptic("select"); setFlooding(true); onSubmit(spokenPrompt); }
  };
  const tapOrb = () => {
    if (!voiceEnabled) { onVoiceDisabled(); return; }
    if (screenReader.current && !live) { onSubmit(spokenPrompt); return; }
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

  const holding = mode === "holding" || mode === "handsfree", handsfree = mode === "handsfree" && mic.state !== "reading", busy = Boolean(thinking);
  const reading = live && mic.state === "reading";
  const liquid = !reducedTransparency && !veilFailed;
  const scrim = busy || (holding && !liquid);
  const veil = holding ? "listening" : flooding && busy ? "flood" : "idle";
  // Tapping anywhere outside the composer closes it, even when no software keyboard is showing
  // (hardware keyboard), where the input would otherwise never blur. The draft is kept.
  const closeComposer = () => { Keyboard.dismiss(); setMode(current => current === "composing" ? "idle" : current); };
  // Tools open another screen: close the chatbox first, or iOS hands the keyboard back to it on return.
  const leave = (go: () => void) => () => { closeComposer(); go(); };
  const attachments = props.attachments ?? NONE;
  const tools = Boolean(props.onImage && props.onConsultation && props.onNote);
  // Attachments alone can be sent; the question then defaults to reviewing them.
  const coach = !used && !coached && !quiet && !suggestion && !busy && mode === "idle" && !attachments.length;
  // Once it has shown, no other dock this session shows it again.
  useEffect(() => { if (!coach) return; coachSeen = true; const timer = setTimeout(() => setCoached(true), 6000); return () => clearTimeout(timer); }, [coach]);
  const send = () => { const value = draft.trim(); if (!value && !attachments.length) return; onSubmit(value || `Review the attached ${attachments.length === 1 ? "image" : "images"}`); Keyboard.dismiss(); };

  // Attachments: the plus morphs into the menu; closing from any depth is one spring back.
  const openMenu = () => { setMenu(true); haptic("light"); menuProgress.set(reducedMotion ? 1 : withSpring(1, MENU_SPRING)); };
  const closeMenu = () => {
    menuExtend.set(reducedMotion ? 0 : withTiming(0, MENU_CLOSE));
    menuProgress.set(reducedMotion ? 0 : withTiming(0, MENU_CLOSE, finished => { "worklet"; if (finished) { menuExtend.set(0); scheduleOnRN(setMenu, false); } }));
    if (reducedMotion) setMenu(false);
  };
  // Chosen items join the carousel at the top of the menu; the menu stays open to pick more.
  const addAttachments = (items: Attachment[]) => { haptic("select"); props.onAttachmentsChange?.([...attachments, ...items.filter(item => !attachments.some(a => a.uri === item.uri))]); };
  const removeAttachment = (item: Attachment) => { haptic("select"); props.onAttachmentsChange?.(attachments.filter(a => a.uri !== item.uri)); };

  // Lift so the card rests 8 pt above the keyboard; the bar stays where it is.
  const restBottom = Math.max(insets.bottom, 12) + 4;
  const shellStyle = useAnimatedStyle(() => {
    const m = morph.value, lift = Math.max(0, kbHeight.value + 8 - restBottom);
    return {
      left: interpolate(m, [0, 1], [0, CARD_INSET]), right: interpolate(m, [0, 1], [0, CARD_INSET]),
      height: interpolate(m, [0, 1], [BAR_H, cardH.value]), borderRadius: interpolate(m, [0, 1], [BAR_R, CARD_R]),
      opacity: interpolate(m, [0, 0.25], [0, 1], "clamp"), transform: [{ translateY: -lift }],
    };
  });
  const dockStyle = useAnimatedStyle(() => {
    const m = morph.value;
    // Reduce Motion: the bar only fades out; no drop or shrink.
    return { opacity: 1 - Math.min(1, m / 0.4), transform: [{ translateY: reducedMotion ? 0 : m * 14 }, { scale: reducedMotion ? 1 : 1 - 0.08 * m }] };
  });
  const composerStyle = useAnimatedStyle(() => {
    const m = morph.value, lift = Math.max(0, kbHeight.value + 8 - restBottom);
    return { opacity: Math.min(1, Math.max(0, (m - 0.45) / 0.5)), transform: [{ translateY: -lift + (reducedMotion ? 0 : (1 - m) * 10) }] };
  });

  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {liquid && <LiquidVeil backdrop={backdrop} state={veil} armed={armed && !busy} words={live ? gusts : words} voiceLevel={level} reducedMotion={reducedMotion} onUnavailable={() => setVeilFailed(true)} />}
    {/* Frosted focus layer: a static blur crossfaded by opacity. */}
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: scrim ? 1 : 0, transitionProperty: "opacity", transitionDuration: scrim ? 320 : 240, transitionTimingFunction: EASE_OUT_CSS }]}>
      {reducedTransparency ? <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(236,239,244,0.94)" }]} /> : <BlurView tint="light" intensity={38} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(232,236,243,0.28)" }]} />
    </Animated.View>

    {holding && <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)} pointerEvents="none" style={{ position: "absolute", left: 32, right: 32, bottom: insets.bottom + 132, alignItems: "center" }}>
      {/* The words grow above the dock as they are heard (live: a partial reading every 1.5 s; the sample: its script),
          with the voice bars beside the hint. */}
      {(live ? mic.partial : words) ? <Words text={live ? mic.partial : transcript.slice(0, words).join(" ")} reduced={reducedMotion} />
        : <Text accessibilityLiveRegion="polite" style={{ textAlign: "center", ...type.display, fontWeight: "500", color: palette.muted }}>{mic.state === "reading" ? "Reading what you said…" : "Listening…"}</Text>}
      {mic.state !== "reading" && <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Bars still={reducedMotion} level={level} color={palette.muted} />
        <Text style={{ ...type.footnote, fontWeight: "500", color: palette.ink }}>{handsfree ? live ? "Pause, or tap stop, to check your words" : "Pause or tap stop to send" : "Release to send"}</Text>
      </View>}
      {!live && <View style={{ marginTop: 4 }}><SampleLabel source="fixture" what="voice" /></View>}
    </Animated.View>}

    {mode === "composing" && <Pressable accessibilityRole="button" accessibilityLabel="Close message composer" onPress={closeComposer} style={StyleSheet.absoluteFill} />}

    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 12) + 4, gap: 10 }}>
      {mode !== "composing" && above && <View pointerEvents="box-none" style={{ paddingHorizontal: 20, gap: 8 }}>{above}</View>}

      {/* One surface for both states: bar at rest, composer card while typing. */}
      <View pointerEvents="box-none" style={{ height: BAR_H, marginHorizontal: 20 }}>
        {/* Liquid glass (native on iOS 26+, frosted blur before that, solid with Reduce Transparency).
            The dots are only accents: a glint on the top rim and the shimmer while it morphs. */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", bottom: 0, overflow: "hidden", borderCurve: "continuous", borderWidth: 1, borderColor: reducedTransparency ? "rgba(20,28,40,0.06)" : "rgba(255,255,255,0.95)", backgroundColor: reducedTransparency ? "rgba(255,255,255,0.97)" : glass ? "transparent" : "rgba(250,251,255,0.55)", boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 6px 20px rgba(40,70,140,0.08), inset 0 1px 0 #FFFFFF, inset 0 12px 20px -14px rgba(255,255,255,1), inset 0 -14px 24px -14px rgba(90,130,220,0.2)" }, shellStyle]}>
          {!reducedTransparency && (glass
            // Frost under the glass keeps typed text legible over busy answers; the glass adds rim light and refraction.
            // Clear glass: a light frost (keeps typed text legible), a white gradient brighter at the top, native glass for rim light.
            ? <><BlurView tint="systemUltraThinMaterialLight" intensity={30} style={StyleSheet.absoluteFill} /><View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: "linear-gradient(170deg, rgba(255,255,255,0.6) 0%, rgba(246,249,255,0.55) 55%, rgba(234,241,255,0.5) 100%)" }]} /><GlassView colorScheme="light" glassEffectStyle="regular" tintColor="rgba(236,243,255,0.22)" style={[StyleSheet.absoluteFill, { borderRadius: CARD_R }]} /></>
            : <><BlurView tint="systemUltraThinMaterialLight" intensity={45} style={StyleSheet.absoluteFill} /><View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: "linear-gradient(170deg, rgba(255,255,255,0.6) 0%, rgba(244,248,255,0.42) 55%, rgba(226,236,255,0.4) 100%)" }]} /></>)}
          {!reducedTransparency && <HalftoneGlint width={screenW} height={22} origin={[28, 0]} reach={[screenW * 0.5, 18]} strength={0.45} style={{ top: 0, left: 0 }} />}
          {!reducedMotion && <HalftoneShimmer width={screenW} height={220} progress={morph} />}
        </Animated.View>

        <Animated.View pointerEvents={mode === "composing" ? "none" : "box-none"} style={[StyleSheet.absoluteFill, { justifyContent: "center" }, dockStyle]}>
          {/* One bar: [+ in a visit] [keyboard] [✦ suggestion, or the placeholder] [orb]. */}
          <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 13, paddingRight: 6 }}>
            {handsfree ? <RoundButton icon="close" label="Cancel voice input" onPress={() => finish(false)} /> : tools && <View accessibilityElementsHidden={menu} importantForAccessibility={menu ? "no-hide-descendants" : "auto"} style={{ opacity: menu ? 0 : 1 }}><RoundButton icon="add" label="Attach a photo, camera capture or file" onPress={openMenu} hidden={holding || busy} reduced={reducedMotion} /></View>}
            <RoundButton icon="keyboard" label="Type a message" onPress={() => setMode("composing")} hidden={holding || busy} reduced={reducedMotion} />
            {/* One line at every text size (the full text is the label), capped so the bar never grows. */}
            <Animated.View pointerEvents={holding || busy ? "none" : "auto"} accessibilityElementsHidden={holding || busy} importantForAccessibility={holding || busy ? "no-hide-descendants" : "auto"} style={{ flex: 1, opacity: holding || busy ? 0 : 1, transitionProperty: "opacity", transitionDuration: 200, transitionTimingFunction: EASE_OUT_CSS }}>
              <Pressable accessibilityRole="button" accessibilityLabel={suggestion ? suggestion.label ?? `Ask Sona: ${suggestion.text}` : placeholder} accessibilityHint={suggestion ? "Opens Sona's answer" : "Opens the message composer"}
                onPress={suggestion ? () => { haptic("select"); suggestion.onPress(); } : () => setMode("composing")}>
                {({ pressed }) => <Animated.View style={{ minHeight: 50, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 25, borderCurve: "continuous", backgroundColor: pressed ? "rgba(240,244,252,0.96)" : "rgba(255,255,255,0.92)", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", boxShadow: "0 4px 16px rgba(40,70,140,0.10)", transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 }}>
                  {suggestion && <Text maxFontSizeMultiplier={2} style={{ ...type.subhead, color: palette.blue }}>✦</Text>}
                  <Text numberOfLines={1} maxFontSizeMultiplier={2} style={{ flex: 1, ...type.subhead, fontWeight: suggestion ? "600" : "400", color: suggestion ? palette.blue : palette.placeholder }}>{suggestion?.text ?? placeholder}</Text>
                </Animated.View>}
              </Pressable>
            </Animated.View>
            <View style={{ width: ORB, height: ORB }}>
            <GestureDetector gesture={micGesture}>
              {/* While the words are read, the orb gives way to the loading pill below. Activate goes through tapOrb, so
                  VoiceOver starts and stops listening in live mode (the sample answers at once). */}
              <Animated.View accessible accessibilityRole="button" accessibilityLabel={busy ? `${thinking}. Stop response` : reading ? "Transcribing" : handsfree ? "Stop" : "Talk to Sona"} accessibilityHint={busy || reading ? undefined : handsfree ? "Double-tap to send what you said." : "Tap to talk hands-free, or hold and release to send. With VoiceOver, double-tap to use the sample command."} accessibilityActions={[{ name: "activate" }]} onAccessibilityAction={() => busy ? onCancel() : tapOrb()}
                style={{ width: ORB, height: ORB, borderRadius: ORB / 2, alignItems: "center", justifyContent: "center", opacity: reading ? 0 : 1, transform: [{ scale: reading && !reducedMotion ? 0.9 : holding && !reducedMotion ? 1.12 : 1 }], transitionProperty: ["opacity", "transform"], transitionDuration: [reading ? 160 : 240, 320], transitionTimingFunction: EASE_OUT_CSS } as never}>
                {/* Two pre-shadowed layers crossfaded by opacity: animating boxShadow would repaint it every frame. */}
                <Animated.View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: ORB / 2, backgroundColor: palette.white, boxShadow: "0 8px 22px rgba(40,70,140,0.22)", opacity: holding ? 0 : 1, transitionProperty: "opacity", transitionDuration: 320, transitionTimingFunction: EASE_OUT_CSS }} />
                <Animated.View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: ORB / 2, backgroundColor: palette.white, boxShadow: "0 10px 28px rgba(60,100,200,0.32)", opacity: holding ? 1 : 0, transitionProperty: "opacity", transitionDuration: 320, transitionTimingFunction: EASE_OUT_CSS }} />
                <View style={{ position: "absolute", inset: 0 }}><GlassOrb size={ORB} energy={holding ? 1 : busy ? 0.7 : 0} still={reducedMotion} /></View>
                {/* Tap-to-talk shows a stop square (tapping it sends); hold-to-talk keeps the bars, following the voice. */}
                <OrbGlyph activity={mode === "handsfree" ? "stop" : holding ? "listening" : activity ?? (busy ? "searching" : "idle")} still={reducedMotion} level={level} />
              </Animated.View>
            </GestureDetector>
            {reading && <Animated.View entering={reducedMotion ? FadeIn.duration(150) : pillIn} exiting={FadeOut.duration(140)} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
              style={{ position: "absolute", right: 0, top: (ORB - PILL_H) / 2, height: PILL_H, borderRadius: PILL_H / 2, overflow: "hidden", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, backgroundColor: palette.ink }}>
              <ActivityIndicator size="small" color={palette.white} />
              <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ ...type.footnote, fontWeight: "600", color: palette.white }}>Transcribing…</Text>
            </Animated.View>}
            </View>
          </View>

          {/* Attachments waiting to send: a small deck above the mic (after Airbnb's photo pop and slide). */}
          {!busy && mode === "idle" && !holding && attachments.length > 0 && <Animated.View entering={reducedMotion ? FadeIn.duration(120) : riseIn({ distance: 10, scale: 0.8, duration: 320 })} exiting={FadeOut.duration(140)} pointerEvents="box-none"
            style={{ position: "absolute", bottom: BAR_H + 4, alignSelf: "center" }}>
            <AttachmentStack items={attachments} reduced={reducedMotion} onPress={openMenu} />
          </Animated.View>}
          {/* Coach mark once per app session, above the orb, and never while the bar carries a suggestion. */}
          {coach && <Animated.View entering={reducedMotion ? FadeIn.duration(120) : riseIn({ delay: 600, distance: 6, scale: 0.96, duration: 320 })} exiting={FadeOut.duration(140)} pointerEvents="none"
            style={{ position: "absolute", bottom: BAR_H + 8, right: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 6, paddingRight: 14, paddingVertical: 6, borderRadius: radius.group, backgroundColor: "rgba(255,255,255,0.94)", boxShadow: "0 6px 20px rgba(24,32,48,0.1)", transformOrigin: "bottom right" }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#E4EDFD", alignItems: "center", justifyContent: "center" }}><BrandIcon name="wave" size={14} color={palette.blue} strokeWidth={1.8} /></View>
            <Text style={{ ...type.footnote, fontWeight: "500", color: palette.ink }}>Tap or hold to talk</Text>
          </Animated.View>}

          <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" }}>
            {busy && <Animated.View key={thinking} entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 6, scale: 0.96, duration: 240 })} exiting={FadeOut.duration(120)} pointerEvents="none"
              style={{ position: "absolute", bottom: BAR_H + 6, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.control, backgroundColor: "rgba(255,255,255,0.9)", boxShadow: "0 4px 14px rgba(24,32,48,0.1)" }}>
              <Icon name="stop.fill" size={9} color={palette.muted} />
              <Animated.Text numberOfLines={1} style={{ ...type.footnote, fontWeight: "500", color: palette.ink, animationName: reducedMotion ? undefined : { "0%": { opacity: 1 }, "50%": { opacity: 0.5 }, "100%": { opacity: 1 } }, animationDuration: 1600, animationIterationCount: "infinite" }}>{thinking}</Animated.Text>
            </Animated.View>}
          </View>
        </Animated.View>

        {composerMounted && <Animated.View pointerEvents={mode === "composing" ? "box-none" : "none"} onLayout={e => cardH.set(e.nativeEvent.layout.height)}
          style={[{ position: "absolute", bottom: 0, left: CARD_INSET, right: CARD_INSET, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 12 }, composerStyle]}>
          {attachments.length > 0 && <AttachmentStrip items={attachments} onRemove={removeAttachment} size={84} />}
          <TextInput autoFocus onBlur={() => setMode(current => current === "composing" ? "idle" : current)} accessibilityLabel="Ask Sona" value={draft} onChangeText={onDraft} placeholder={placeholder} placeholderTextColor="#7D8591" multiline style={{ ...type.headline, fontWeight: "400", lineHeight: 22, color: palette.ink, maxHeight: 120, minHeight: 26 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {tools && <>
              <ToolButton icon="image" label="Attach or review a chest X-ray" onPress={leave(props.onImage!)} />
              <ToolButton icon="wave" label="Start the consultation recorder" onPress={leave(props.onConsultation!)} />
              <ToolButton icon="note" label="Open the consultation note" onPress={leave(props.onNote!)} />
            </>}
            <View style={{ flex: 1 }} />
            <RoundAction icon="send" label="Send message" ready={Boolean(draft.trim()) || attachments.length > 0} onPress={send} />
          </View>
        </Animated.View>}
      </View>
    </View>

    {tools && <AttachmentsMenu hint={draft} visible={menu} progress={menuProgress} extend={menuExtend} anchor={{ left: 34, bottom: Math.max(insets.bottom, 12) + 4 + (BAR_H - 50) / 2, size: 50 }} reducedMotion={reducedMotion} onClose={closeMenu} attached={attachments} onAdd={addAttachments} onRemove={removeAttachment} />}

  </View>;
}
