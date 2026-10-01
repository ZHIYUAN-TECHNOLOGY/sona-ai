import { Blur, Canvas, Circle, Group, Oval, RadialGradient, vec } from "@shopify/react-native-skia";
import { BlurView } from "expo-blur";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, useAnimatedProps, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useT } from "@/lib/i18n";
import { orbPad, SonaOrb } from "@/lib/orb";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import "./strings";

/**
 * Opening Sona Care (after Wabi's soothing load, 60fps.design): while the session and the patient's record
 * load, the Sona orb blooms in exactly where the welcome screen's orb rests and breathes, a soft azure glow
 * behind it and a violet horizon below, under "Sona Care" and one honest line that changes in place (opening,
 * then getting the plan ready, then saying when it is slow). When ready it dissolves, slowly and without
 * bounce: Sona's layer fades as the next screen comes up through a blur that clears. Signed out, the welcome's
 * own orb is already under this one, so nothing moves. Reduce Motion: no bloom, breath or blur, a short fade.
 *
 * 100% smooth (as Wabi holds its ambient load until the screen is whole): the next screen mounts under the opaque
 * layer as soon as the session is known (`ready`), so its mount and first layout never land in the dissolve; the
 * layer holds until that screen's data has arrived too (`settled`, at most 5 s after ready), so no tile pops in
 * after the reveal; then it dissolves while the screen settles from 0.97 to full size, and the dock comes in with it.
 */
const SLOW = Easing.inOut(Easing.cubic);
const BREATH = 3200;
const AnimatedBlur = Animated.createAnimatedComponent(BlurView);

// Where the welcome screen's orb rests (features/sign-in/welcome.tsx): top padding 8, the 48 pt back-button
// row, then the hero (12 pt margin, 250 pt tall) with its 180 pt orb in the middle; the wordmark 8 pt below.
const HERO = { above: 8 + 48 + 12, height: 250, size: 180 };
// The longest the layer waits on the screen's data once the session is known: a slow call shows in place, not under Sona.
const HOLD = 5000;

// Whether the opening has revealed the app, for chrome that must arrive with it (the dock), never before.
let revealed = false;
const listeners = new Set<() => void>();
const reveal = (on: boolean) => { if (revealed === on) return; revealed = on; listeners.forEach(l => l()); };
export const useRevealed = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => revealed);

export function Opening({ ready: known, settled, step, children }: { ready: boolean; settled: boolean; step: "session" | "record"; children: ReactNode }) {
  const still = useReducedMotion();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // The layer stays mounted through its dissolve, then goes.
  const [shown, setShown] = useState(!(known && settled));
  const [slow, setSlow] = useState(false);
  // Only the first line waits for the orb to bloom; a changed line replaces the old one at once.
  const [firstLine, setFirstLine] = useState(true);
  // The session is known (mount what comes next, hidden), and its data is in (or the hold ran out): reveal.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!known || settled) { setHeld(false); return; }
    const timer = setTimeout(() => setHeld(true), HOLD);
    return () => clearTimeout(timer);
  }, [known, settled]);
  const ready = known && (settled || held);
  const veil = useSharedValue(ready ? 0 : 1), blur = useSharedValue(0), bloom = useSharedValue(still ? 1 : 0), breath = useSharedValue(0), flood = useSharedValue(0), grow = useSharedValue(ready ? 1 : 0.97);
  useEffect(() => { reveal(ready); }, [ready]);

  useEffect(() => {
    if (ready) return;
    setShown(true); setSlow(false); setFirstLine(true); grow.set(still ? 1 : 0.97);
    // Back to loading after a screen (signing in): fade the layer in over what was there.
    veil.set(still ? 1 : withTiming(1, { duration: 300, easing: SLOW }));
    bloom.set(still ? 1 : withTiming(1, { duration: 700, easing: SLOW }));
    if (!still) {
      breath.set(withRepeat(withTiming(1, { duration: BREATH, easing: SLOW }), -1, true));
      flood.set(withRepeat(withTiming(0.35, { duration: BREATH, easing: SLOW }), -1, true));
    }
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [ready, still, veil, bloom, breath, flood]);

  useEffect(() => {
    if (!ready || !shown) return;
    const gone = (done?: boolean) => { "worklet"; if (done) scheduleOnRN(setShown, false); };
    if (still) { veil.set(withTiming(0, { duration: 200 }, gone)); return; }
    blur.set(28);
    blur.set(withTiming(0, { duration: 700, easing: SLOW }));
    grow.set(withTiming(1, { duration: 700, easing: SLOW }));
    veil.set(withTiming(0, { duration: 560, easing: SLOW }, gone));
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const W = HERO.size + orbPad(HERO.size) * 2;
  const top = insets.top + HERO.above + (HERO.height - W) / 2;
  const cy = top + W / 2;
  const glow = useDerivedValue(() => 0.55 + 0.35 * breath.get());
  const horizon = useDerivedValue(() => 0.5 + 0.3 * (1 - breath.get()));
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.get() }));
  const screenStyle = useAnimatedStyle(() => ({ transform: [{ scale: grow.get() }] }));
  const orbStyle = useAnimatedStyle(() => ({ opacity: bloom.get(), transform: [{ scale: (0.94 + 0.06 * bloom.get()) * (1 + 0.025 * breath.get()) }] }));
  const blurProps = useAnimatedProps(() => ({ intensity: blur.get() }));
  const line = slow ? t("open.slow") : step === "session" ? t("open.session") : t("open.record");

  return <View style={{ flex: 1 }}>
    {/* Mounted, laid out and fed under the opaque layer; it only settles into full size as the layer dissolves. */}
    {known && <Animated.View style={[{ flex: 1 }, screenStyle]}>{children}</Animated.View>}
    {ready && shown && !still && <AnimatedBlur pointerEvents="none" tint="light" animatedProps={blurProps} style={StyleSheet.absoluteFill} />}
    {shown && <Animated.View pointerEvents={ready ? "none" : "auto"} accessible accessibilityLabel={`Sona Care. ${line}`} style={[StyleSheet.absoluteFill, { backgroundColor: palette.canvas }, veilStyle]}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* The azure glow the orb sits in, and a violet horizon low on the screen, breathing against each other. */}
        <Group opacity={glow}>
          <Circle cx={width / 2} cy={cy} r={W * 0.95}>
            <RadialGradient c={vec(width / 2, cy)} r={W * 0.95} colors={["rgba(92,138,240,0.3)", "rgba(225,198,249,0.2)", "rgba(250,250,250,0)"]} />
          </Circle>
        </Group>
        <Group opacity={horizon}>
          <Oval x={-width * 0.15} y={height * 0.84} width={width * 1.3} height={height * 0.3} color="rgba(225,198,249,0.7)">
            <Blur blur={48} />
          </Oval>
        </Group>
      </Canvas>
      <Animated.View style={[{ position: "absolute", top, left: (width - W) / 2, width: W, height: W }, orbStyle]}>
        <SonaOrb size={HERO.size} flood={flood} />
      </Animated.View>
      <View style={{ position: "absolute", top: insets.top + HERO.above + HERO.height + 8, left: 20, right: 20, alignItems: "center", gap: 10 }}>
        <Animated.View entering={still ? undefined : FadeIn.duration(600).delay(200).easing(SLOW)}>
          <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2, color: palette.ink }}>Sona <Text style={{ color: palette.blue }}>Care</Text></Text>
        </Animated.View>
        {/* One line, replaced in place: the old one fades out as the new one fades in over it. */}
        <View style={{ alignSelf: "stretch", minHeight: 48 }}>
          <Animated.View key={line} onLayout={() => setFirstLine(false)} entering={still ? undefined : firstLine ? FadeIn.duration(500).delay(350).easing(SLOW) : FadeIn.duration(350).easing(Easing.out(Easing.cubic))} exiting={still ? undefined : FadeOut.duration(300).easing(Easing.in(Easing.cubic))} style={{ position: "absolute", left: 0, right: 0 }}>
            <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{line}</Text>
          </Animated.View>
        </View>
      </View>
    </Animated.View>}
  </View>;
}
