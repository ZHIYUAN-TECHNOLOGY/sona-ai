import { memo, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { requireOptionalNativeModule } from "expo";
import Animated, { Easing, Extrapolation, interpolate, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { orbPad, SonaOrb } from "./orb";

// The folding light needs its native view (a development or TestFlight build); Expo Go keeps the pearl.
const FoldingLight: typeof import("./orb-shader").FoldingLight | undefined = requireOptionalNativeModule("NativeSpringsShaderOverlay") ? require("./orb-shader").FoldingLight : undefined;
const MORPH = { duration: 800, easing: Easing.bezier(0.77, 0, 0.175, 1) };
// The lift follows the voice like a held object: critically damped, so it eases between the mic's 100 ms readings.
const FOLLOW = { duration: 280, dampingRatio: 1 };
const CLAMP = Extrapolation.CLAMP;
// The light speaks above 0.22 and listens again only after 0.7 s under 0.08, so a pause between two words never
// flips its look (each flip re-eases the shader's whole look).
const SPEAK_ON = 0.22, SPEAK_OFF = 0.08, SPEAK_HOLD_MS = 700;
// Creating the light's Metal view (and compiling its shader, once per launch) holds the main thread for a few frames,
// so it is created once the screen has arrived and then parked off screen while unused: the shader skips any frame
// whose view sits outside the window, so a parked light costs nothing but its display-link tick.
const SETTLE_MS = 700, PARK = -100_000;

/**
 * The Sona orb that hears the patient (trial, 9 Oct; smoothed 9 Oct evening). At rest it is the pearl, unchanged (./orb).
 * While voice is on (`hearing`) the pearl dissolves into its halftone dots and shrinks into its centre while the folding
 * light (./orb-shader) unfolds from that centre, so the two overlap and the orb never blinks out; when voice ends it folds
 * back. One shared value runs the morph on the UI thread (800 ms, ease-in-out, reversible mid-way).
 * Smoothness: the light is created once the screen has arrived and parked off screen while unused (it draws nothing
 * there), so no morph waits on its creation; once the light covers the pearl the pearl stops (`covered`: its clock and
 * its voice-driven dots), so only one of the two draws; the voice reaches the light in 10 % steps and its look changes
 * with hysteresis, so a pause between two words never re-eases it.
 * `level` (0–1, the voice: the mic while the patient talks, Sona's reading aloud) steers the light's pulse and lifts it
 * up to 12 %. Parked, the light draws nothing, so the resting pearl keeps its idle rest (./idle).
 * `awake` keeps the pearl moving on a screen nobody touches (voice mode), as on SonaOrb.
 * Reduce Motion or Expo Go: the pearl alone, with `flood` as before.
 */
export const VoiceOrb = memo(function VoiceOrb({ size, flood, hearing, level, awake = false }: { size: number; flood?: SharedValue<number>; hearing: boolean; level: SharedValue<number>; awake?: boolean }) {
  const still = useReducedMotion();
  const live = !!FoldingLight && !still;
  const morph = useSharedValue(0);
  const [shown, setShown] = useState(false);
  const [covered, setCovered] = useState(false);
  const [voice, setVoice] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  // Create the light once the screen has settled (or at once, if voice starts sooner), then keep it, parked while unused.
  useEffect(() => {
    if (!live || shown) return;
    const t = setTimeout(() => setShown(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [live, shown]);

  useEffect(() => {
    if (!live) return;
    if (!hearing) { setCovered(false); morph.set(withTiming(0, MORPH)); return; }
    if (!shown) { setShown(true); return; } // create the light first; this effect runs again once it is there
    const frame = requestAnimationFrame(() => morph.set(withTiming(1, MORPH)));
    return () => cancelAnimationFrame(frame);
  }, [hearing, live, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the light covers it, the pearl stops: its clock, and its dots (which follow the voice), so it never redraws unseen.
  useAnimatedReaction(() => morph.get() === 1, (over, was) => { if (over && was === false) scheduleOnRN(setCovered, true); });

  // While parked (`morph` 0, off screen) the light follows nothing: each voice step re-rendered it and each lift frame
  // committed its style for a view nobody sees (a live call's thinking phase, where the mic still ticks: 36 % app CPU in
  // the simulator, 10 Oct). It picks the voice up again the moment it starts to unfold (at opacity 0).
  const parked = () => { "worklet"; return morph.get() === 0; };
  // The light's pulse takes a JS number and eases it natively, so it gets the voice in 10 % steps.
  useAnimatedReaction(() => parked() ? -1 : Math.round(level.get() * 10) / 10, (v, was) => { if (v >= 0 && v !== was) scheduleOnRN(setVoice, v); });
  // Its look, with hysteresis.
  const talking = useSharedValue(0), quietSince = useSharedValue(0);
  useAnimatedReaction(() => level.get(), v => {
    const now = Date.now();
    if (talking.get() === 0 && v > SPEAK_ON) { talking.set(1); quietSince.set(0); scheduleOnRN(setSpeaking, true); }
    else if (talking.get() === 1) {
      if (v >= SPEAK_OFF) quietSince.set(0);
      else if (quietSince.get() === 0) quietSince.set(now);
      else if (now - quietSince.get() > SPEAK_HOLD_MS) { talking.set(0); scheduleOnRN(setSpeaking, false); }
    }
  });

  const lift = useSharedValue(0);
  useAnimatedReaction(() => parked() ? -1 : level.get(), (v, was) => { if (v >= 0) lift.set(was === null || was < 0 ? v : withSpring(v, FOLLOW)); });

  const zero = useSharedValue(0);
  // The pearl's own sunbeam dots flood it over the first half of the morph: it dissolves into dots, then fades.
  const dots = useDerivedValue(() => Math.max((flood ?? zero).get(), Math.min(1, morph.get() * 2)));
  const pearl = useAnimatedStyle(() => ({
    opacity: interpolate(morph.get(), [0.45, 1], [1, 0], CLAMP),
    transform: [{ scale: interpolate(morph.get(), [0, 1], [1, 0.55]) }],
  }));
  const light = useAnimatedStyle(() => ({
    opacity: interpolate(morph.get(), [0, 0.4], [0, 1], CLAMP),
    transform: [{ translateY: morph.get() === 0 ? PARK : 0 }, { scale: interpolate(morph.get(), [0, 1], [0.9, 1]) * (1 + 0.12 * lift.get()) }],
  }));
  const full = useSharedValue(1);
  const W = size + orbPad(size) * 2;
  return <View pointerEvents="none" style={{ width: W, height: W }}>
    <Animated.View style={[StyleSheet.absoluteFill, pearl]}><SonaOrb size={size} flood={covered ? full : dots as SharedValue<number>} awake={awake || hearing} covered={covered} /></Animated.View>
    {shown && FoldingLight && <Animated.View style={[StyleSheet.absoluteFill, light]}>
      <FoldingLight size={size} state={speaking ? "speaking" : "listening"} speechLevel={voice} />
    </Animated.View>}
  </View>;
});
