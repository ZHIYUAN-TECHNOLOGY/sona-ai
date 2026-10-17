import { Canvas, Fill, Shader, Skia, type SkRuntimeEffect } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeIn, interpolate, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { Text } from "./text";
import { palette, type, radius } from "./theme";
import { CT_NOTE, IMAGE_TYPES, NOT_ATTACHED, type ImageType } from "./image-type";
import { CropStage, type CropHandle } from "./crop-stage";
import { canCrop } from "./sona-camera";
import { Action, useAccessibleEffects } from "./ui";

/**
 * Capture scan (after CapWords' snap-and-mask): the shutter freezes the photo, a band of blue
 * halftone dots sweeps up it (1.1 s, ease-in-out), a glass sheet springs up (0.45 s, damping 0.72)
 * asking what the image is, and the photo's corners become handles to crop and straighten it.
 * The sweep is an overlay that fades away; the photo's own pixels are never tinted or altered.
 * Nothing is read from the image here: the type is the clinician's choice, preselected from what they typed.
 */
export { IMAGE_TYPES, type ImageType } from "./image-type";

// Compiled when first drawn, not at app start.
let compiled: SkRuntimeEffect | undefined;
const band = () => compiled ??= Skia.RuntimeEffect.Make(`
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

function Sweep({ rect: { x, y, width, height }, progress }: { rect: { x: number; y: number; width: number; height: number }; progress: ReturnType<typeof useSharedValue<number>> }) {
  const uniforms = useDerivedValue(() => ({ res: [width, height], p: progress.value }));
  return <Canvas pointerEvents="none" style={{ position: "absolute", left: x, top: y, width, height }}>
    <Fill><Shader source={band()} uniforms={uniforms} /></Fill>
  </Canvas>;
}

/** `confirm` replaces the type question when the caller already knows what the image is (a scanned note). */
type Confirm = { title: string; line: string; action: string };
export function CaptureScan({ source, width, height, suggested = "Chest X-ray", confirm, crop: croppable = true, onRetake, onAttach }: { source: number | { uri: string }; suggested?: ImageType; confirm?: Confirm;
  /** Off when the caller sends the original photo on (its own upload), so a crop would be dropped. */
  crop?: boolean; width: number; height: number; onRetake: () => void;
  /** `uri` is the straightened crop, or undefined when the corners were left on the photo's edges. */
  onAttach: (kind: ImageType, uri?: string) => void }) {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const [kind, setKind] = useState<ImageType>(suggested);
  const [ready, setReady] = useState(reducedMotion);
  const [busy, setBusy] = useState(false);
  const [sheetH, setSheetH] = useState(320);
  const crop = useRef<CropHandle>(null);
  const scan = useSharedValue(0), sheet = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) { sheet.set(withTiming(1, { duration: 200 })); return; }
    scan.set(withTiming(1, { duration: 1100, easing: Easing.bezier(0.65, 0, 0.35, 1) }, done => { "worklet"; if (done) scheduleOnRN(setReady, true); }));
    sheet.set(withDelay(820, withSpring(1, { duration: 450, dampingRatio: 0.72 })));
    const tap = setTimeout(() => { if (process.env.EXPO_OS === "ios") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {}); }, 1100);
    return () => clearTimeout(tap);
  }, [reducedMotion, scan, sheet]);
  const attach = async () => {
    setBusy(true);
    const uri = await crop.current?.straighten().catch(() => undefined);
    onAttach(kind, uri);
  };

  // The whole photo sits above the sheet; once it has been read, its corners crop it (a document's page, a film's edges).
  const bottom = Math.max(insets.bottom, 12);
  const top = insets.top + 48;
  const frame = useMemo(() => ({ x: 0, y: top, width, height: Math.max(160, height - top - sheetH - bottom - 12) }), [width, height, top, sheetH, bottom]);
  const editable = ready && canCrop && croppable;
  const sheetStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheet.value, [0, 0.4], [0, 1], "clamp"), transform: [{ translateY: (1 - sheet.value) * 220 }] }));

  return <View style={[StyleSheet.absoluteFill, { backgroundColor: "#05070B" }]}>
    <CropStage ref={crop} source={typeof source === "number" ? source : source.uri} frame={frame} editable={editable}>
      {rect => !reducedMotion && !ready && <Sweep rect={rect} progress={scan} />}
    </CropStage>
    {editable && <Animated.View entering={FadeIn.duration(220)} pointerEvents="none" style={{ position: "absolute", top: insets.top + 8, alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.control, backgroundColor: "rgba(250,251,253,0.9)" }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>Drag a corner to crop</Text>
    </Animated.View>}

    <Animated.View onLayout={e => setSheetH(e.nativeEvent.layout.height)} style={[{ position: "absolute", left: 10, right: 10, bottom, borderRadius: radius.sheet, borderCurve: "continuous", backgroundColor: "rgba(250,251,253,0.97)", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", boxShadow: "0 18px 48px rgba(0,0,0,0.3)", padding: 18, gap: 14 }, sheetStyle]}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ ...type.heading, color: palette.ink }}>{confirm?.title ?? "What is this image?"}</Text>
        <Text style={{ ...type.footnote, color: kind === NOT_ATTACHED ? palette.amber : palette.muted }}>{kind === NOT_ATTACHED ? CT_NOTE : !ready ? "Preparing the capture…" : confirm ? confirm.line : "Analysis depends on the type. Suggested from your request; change it if needed."}</Text>
      </View>
      {!confirm && <TypeChips value={kind} onChange={setKind} enterDelay={reducedMotion ? undefined : 900} />}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Action secondary label="Retake" accessibilityLabel="Retake photo" onPress={onRetake} /></View>
        <View style={{ flex: 2 }}><Action accessibilityLabel={confirm?.action ?? `Attach as ${kind}`} disabled={kind === NOT_ATTACHED || busy} onPress={() => void attach()} label={kind === NOT_ATTACHED ? "Not attached" : busy ? "Straightening…" : confirm?.action ?? `Attach as ${kind}`} /></View>
      </View>
    </Animated.View>
  </View>;
}

/** The image types as ink-when-chosen chips (a radio group); the capture sheet and the photo review share them. */
export function TypeChips({ value, onChange, enterDelay }: { value?: ImageType; onChange: (kind: ImageType) => void; enterDelay?: number }) {
  const { reducedMotion } = useAccessibleEffects();
  return <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
    {IMAGE_TYPES.map((item, i) => <Animated.View key={item} entering={enterDelay === undefined ? undefined : FadeIn.delay(enterDelay + i * 40).duration(220)}>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: item === value }} onPress={() => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); onChange(item); }} hitSlop={{ top: 4, bottom: 4 }}>
        {({ pressed }) => <Animated.View style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: "center", borderWidth: 1, borderColor: item === value ? palette.ink : "rgba(20,28,40,0.1)", backgroundColor: item === value ? palette.ink : palette.white, transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }], transitionProperty: ["transform", "backgroundColor", "borderColor"], transitionDuration: 150 }}>
          <Animated.Text style={{ ...type.callout, fontWeight: "500", color: item === value ? palette.white : palette.ink, transitionProperty: "color", transitionDuration: 150 }}>{item}</Animated.Text>
        </Animated.View>}
      </Pressable>
    </Animated.View>)}
  </View>;
}
