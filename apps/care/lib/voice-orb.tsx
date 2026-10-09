import { memo, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { requireOptionalNativeModule } from "expo";
import Animated, { Easing, Extrapolation, interpolate, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { orbPad, SonaOrb } from "./orb";

// The folding light needs its native view (a development or TestFlight build); Expo Go keeps the pearl.
const FoldingLight: typeof import("./orb-shader").FoldingLight | undefined = requireOptionalNativeModule("NativeSpringsShaderOverlay") ? require("./orb-shader").FoldingLight : undefined;
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
const CLAMP = Extrapolation.CLAMP;

/**
 * The Sona orb that hears the patient (trial, 9 Oct). At rest it is the pearl, unchanged (./orb). While voice is on
 * (`hearing`) the pearl dissolves into its halftone dots and shrinks into its centre while the folding light (./orb-shader)
 * unfolds from that centre, so the two overlap and the orb never blinks out; when voice ends it folds back. One shared
 * value runs the morph on the UI thread (800 ms, ease-in-out, reversible mid-way).
 * `level` (0–1, the voice: the mic while the patient talks, Sona's reading aloud) steers the light's pulse and lifts it
 * up to 12 %. The light is mounted only while it shows, so the resting pearl keeps its idle rest (./idle).
 * `awake` keeps the pearl moving on a screen nobody touches (voice mode), as on SonaOrb.
 * Reduce Motion or Expo Go: the pearl alone, with `flood` as before.
 */
export const VoiceOrb = memo(function VoiceOrb({ size, flood, hearing, level, awake = false }: { size: number; flood?: SharedValue<number>; hearing: boolean; level: SharedValue<number>; awake?: boolean }) {
  const still = useReducedMotion();
  const live = !!FoldingLight && !still;
  const morph = useSharedValue(0);
  const [shown, setShown] = useState(false);
  const [voice, setVoice] = useState(0);
  useEffect(() => {
    if (!live) return;
    if (hearing) setShown(true);
    morph.set(withTiming(hearing ? 1 : 0, { duration: 800, easing: EASE_IN_OUT }));
  }, [hearing, live]);
  // Unmount the light once it has folded back, so nothing draws at rest.
  useAnimatedReaction(() => morph.get() === 0, (gone, was) => { if (gone && was === false) scheduleOnRN(setShown, false); });
  // The light's pulse takes a JS number: hand it over in 5 % steps (the voice changes about ten times a second).
  useAnimatedReaction(() => Math.round(level.get() * 20) / 20, (v, was) => { if (v !== was) scheduleOnRN(setVoice, v); });

  const zero = useSharedValue(0);
  // The pearl's own sunbeam dots flood it over the first half of the morph: it dissolves into dots, then fades.
  const dots = useDerivedValue(() => Math.max((flood ?? zero).get(), Math.min(1, morph.get() * 2)));
  const pearl = useAnimatedStyle(() => ({
    opacity: interpolate(morph.get(), [0.45, 1], [1, 0], CLAMP),
    transform: [{ scale: interpolate(morph.get(), [0, 1], [1, 0.55]) }],
  }));
  const light = useAnimatedStyle(() => ({
    opacity: interpolate(morph.get(), [0, 0.4], [0, 1], CLAMP),
    transform: [{ scale: interpolate(morph.get(), [0, 1], [0.9, 1]) * (1 + 0.12 * level.get()) }],
  }));
  const W = size + orbPad(size) * 2;
  return <View pointerEvents="none" style={{ width: W, height: W }}>
    <Animated.View style={[StyleSheet.absoluteFill, pearl]}><SonaOrb size={size} flood={dots as SharedValue<number>} awake={awake || hearing} /></Animated.View>
    {shown && FoldingLight && <Animated.View style={[StyleSheet.absoluteFill, light]}>
      <FoldingLight size={size} state={voice > 0.15 ? "speaking" : "listening"} speechLevel={voice} />
    </Animated.View>}
  </View>;
});
