import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeIn, interpolate, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { Text } from "./text";
import { palette, type } from "./theme";
import { useAccessibleEffects } from "./ui";

/**
 * Capture scan (after CapWords' snap-and-mask): the shutter freezes the photo, a band of blue
 * halftone dots sweeps up it (1.1 s, ease-in-out), the surround dims to a focus frame, and a glass
 * sheet springs up (0.45 s, damping 0.72) asking what the image is before it is attached.
 * The sweep is an overlay that fades away; the photo's own pixels are never tinted or altered.
 * Nothing is read from the image here: the type is the clinician's choice, suggested as chest X-ray.
 */
export const IMAGE_TYPES = ["Chest X-ray", "Skin", "Wound", "Document", "Other"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const band = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float p;
half4 main(float2 q) {
  float y = 1.0 - q.y / res.y;
  float d = y - mix(-0.2, 1.15, p);
  float lead = exp(-pow(d / 0.05, 2.0));
  float trail = d < 0.0 ? exp(d / 0.2) * 0.7 : 0.0;
  float a = max(lead, trail) * (1.0 - smoothstep(0.92, 1.0, p));
  float r = 0.46 * sqrt(a);
  if (r < 0.06) { return half4(0.0); }
  float dotShape = 1.0 - smoothstep(r - 0.08, r + 0.04, length(fract(q / 5.0) - 0.5));
  half3 hue = mix(half3(0.38, 0.66, 1.0), half3(0.85, 0.92, 1.0), lead);
  float alpha = dotShape * (0.5 + 0.5 * lead);
  return half4(hue * alpha, alpha);
}`)!;

function Sweep({ width, height, progress }: { width: number; height: number; progress: ReturnType<typeof useSharedValue<number>> }) {
  const uniforms = useDerivedValue(() => ({ res: [width, height], p: progress.value }));
  return <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
    <Fill><Shader source={band} uniforms={uniforms} /></Fill>
  </Canvas>;
}

export function CaptureScan({ source, width, height, onRetake, onAttach }: { source: number | { uri: string }; width: number; height: number; onRetake: () => void; onAttach: (kind: ImageType) => void }) {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const [kind, setKind] = useState<ImageType>("Chest X-ray");
  const [ready, setReady] = useState(reducedMotion);
  const scan = useSharedValue(0), dim = useSharedValue(0), sheet = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) { dim.set(withTiming(1, { duration: 200 })); sheet.set(withTiming(1, { duration: 200 })); return; }
    scan.set(withTiming(1, { duration: 1100, easing: Easing.bezier(0.65, 0, 0.35, 1) }, done => { "worklet"; if (done) scheduleOnRN(setReady, true); }));
    dim.set(withDelay(700, withTiming(1, { duration: 420 })));
    sheet.set(withDelay(820, withSpring(1, { duration: 450, dampingRatio: 0.72 })));
    const tap = setTimeout(() => { if (process.env.EXPO_OS === "ios") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {}); }, 1100);
    return () => clearTimeout(tap);
  }, [reducedMotion, scan, dim, sheet]);

  // The focus frame: everything outside it dims; the frame's corners mark what will be attached.
  const frame = { left: 20, top: 20, width: width - 40, height: height * 0.56 };
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value * 0.55 }));
  const cornerStyle = useAnimatedStyle(() => ({ opacity: dim.value, transform: [{ scale: interpolate(dim.value, [0, 1], [1.04, 1]) }] }));
  const sheetStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheet.value, [0, 0.4], [0, 1], "clamp"), transform: [{ translateY: (1 - sheet.value) * 220 }] }));
  const shade = { position: "absolute", backgroundColor: "#05070B" } as const;

  return <View style={StyleSheet.absoluteFill}>
    <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Captured photo" />
    {!reducedMotion && <Sweep width={width} height={height} progress={scan} />}
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, dimStyle]}>
      <View style={[shade, { left: 0, right: 0, top: 0, height: frame.top }]} />
      <View style={[shade, { left: 0, right: 0, top: frame.top + frame.height, bottom: 0 }]} />
      <View style={[shade, { left: 0, width: frame.left, top: frame.top, height: frame.height }]} />
      <View style={[shade, { right: 0, width: frame.left, top: frame.top, height: frame.height }]} />
    </Animated.View>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", ...frame }, cornerStyle]}>
      {([["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const).map(([v, h]) => <View key={v + h}
        style={{ position: "absolute", [v]: 0, [h]: 0, width: 26, height: 26, borderColor: palette.white, [`border${v === "top" ? "Top" : "Bottom"}Width`]: 3, [`border${h === "left" ? "Left" : "Right"}Width`]: 3, [`border${v === "top" ? "Top" : "Bottom"}${h === "left" ? "Left" : "Right"}Radius`]: 14 }} />)}
    </Animated.View>

    <Animated.View style={[{ position: "absolute", left: 10, right: 10, bottom: Math.max(insets.bottom, 12), borderRadius: 32, borderCurve: "continuous", backgroundColor: "rgba(250,251,253,0.97)", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", boxShadow: "0 18px 48px rgba(0,0,0,0.3)", padding: 18, gap: 14 }, sheetStyle]}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ ...type.heading, color: palette.ink }}>What is this image?</Text>
        <Text style={{ ...type.footnote, color: palette.muted }}>{ready ? "Analysis depends on the type. Suggested from your request; change it if needed." : "Preparing the capture…"}</Text>
      </View>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {IMAGE_TYPES.map((item, i) => <Animated.View key={item} entering={reducedMotion ? undefined : FadeIn.delay(900 + i * 40).duration(220)}>
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: item === kind }} onPress={() => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); setKind(item); }} hitSlop={{ top: 4, bottom: 4 }}
            style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: "center", borderWidth: 1, borderColor: item === kind ? palette.ink : "rgba(20,28,40,0.1)", backgroundColor: item === kind ? palette.ink : palette.white, transitionProperty: ["backgroundColor", "borderColor"], transitionDuration: 150 } as never}>
            <Text style={{ fontSize: 15, fontWeight: "500", color: item === kind ? palette.white : palette.ink, transitionProperty: "color", transitionDuration: 150 } as never}>{item}</Text>
          </Pressable>
        </Animated.View>)}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retake photo" onPress={onRetake} style={({ pressed }) => ({ flex: 1, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,28,40,0.06)", opacity: pressed ? 0.8 : 1 })}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: palette.ink }}>Retake</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Attach as ${kind}`} onPress={() => onAttach(kind)} style={({ pressed }) => ({ flex: 2, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: palette.ink, transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>Attach as {kind}</Text>
        </Pressable>
      </View>
    </Animated.View>
  </View>;
}
