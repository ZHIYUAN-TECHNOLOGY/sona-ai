import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions, type ViewStyle } from "react-native";
import Animated, { Easing, FadeIn, LinearTransition, useAnimatedStyle, useDerivedValue, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { CropStage, type CropHandle } from "@/components/sona/crop-stage";
import { HalftoneGlint } from "@/components/sona/halftone-shimmer";
import { canCrop, SonaCamera, type CameraHandle } from "@/components/sona/sona-camera";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Icon, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/scribe/parts";

/**
 * Route `/library-scan?scope=…`: photograph paper pages for OCR ("Sona glass", chosen 29 Sep 2026
 * from six prototypes). Follows the design system and the camera capture scan spec in
 * docs/design-direction.md: light liquid-glass chrome over a full-bleed camera, one ink primary
 * action, dithering only where Sona is working.
 * - Idle: thin corners over the camera and a hint above the dock; the ink shutter stays plain.
 * - Capture: the frame freezes, the room dims to the page, a blue halftone band reads it bottom to
 *   top in 1.1 s (after "CapWords Snap Mask Interaction"), then the page's corners become handles
 *   to crop and straighten it, and a glass sheet springs up to check it, Retake or Next page.
 * - Continue: an ink capsule in the dock holds the pages as overlapping thumbnails beside "Review",
 *   growing on a spring as pages are added (after "Slack Summarize Pill Pop Avatar Unread Count
 *   Morph Interaction", https://60fps.design/shots/slack-summarize-pill-pop-avatar-unread-count-morph-interaction).
 * Photos stay on the phone until server OCR is hosted.
 * ponytail: no edge detection or blur check; the doctor drags the corners and checks the page. Add both with the OCR model.
 */
import { DeskStandIn, EASE, LightGlass, PageLines, ReviewCapsule, SHEET_SPRING, Sweep, Corner, type Page } from "./scan-parts";
import { keepScan } from "./scan-state";

export function ScanCameraScreen() {
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const camera = useRef<CameraHandle>(null);
  const crop = useRef<CropHandle>(null);
  const [live, setLive] = useState(false);
  const [straightening, setStraightening] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  const [shot, setShot] = useState<Page>();
  const [phase, setPhase] = useState<"idle" | "reading" | "review">("idle");
  const [torch, setTorch] = useState(false);
  const busy = phase !== "idle";

  // The page guide: A4-shaped, between the top bar and the dock.
  const DOCK = 76;
  const frameTop = insets.top + 72;
  const frameH = Math.min(H - frameTop - DOCK - insets.bottom - 92, (W - 48) * 1.414);
  const frameW = frameH / 1.414;
  const frameLeft = (W - frameW) / 2;
  // The captured page sits between the top bar and the check sheet, where its corners crop it.
  const SHEET = 162;
  const stage = { x: 0, y: insets.top + 64, width: W, height: H - insets.top - 64 - SHEET - insets.bottom - 18 };

  const read = useSharedValue(0), dim = useSharedValue(0), sheet = useSharedValue(0), flash = useSharedValue(0);

  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - sheet.value) * 320 }], opacity: sheet.value > 0.01 ? 1 : 0 }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: 1 - sheet.value }));

  const review = () => {
    setPhase("review"); haptic("done");
    sheet.set(reducedMotion ? 1 : withSpring(1, SHEET_SPRING));
  };
  const capture = async () => {
    if (busy) return;
    haptic("tap");
    const photo = await camera.current?.takePhoto().catch(() => undefined);
    // ponytail: simulators have no camera; in development a synthetic page stands in so the flow can be reviewed.
    if (!photo && !__DEV__) return;
    setShot({ id: Date.now(), uri: photo });
    setPhase("reading");
    dim.set(withTiming(1, { duration: reducedMotion ? 0 : 320, easing: EASE }));
    if (reducedMotion) { review(); return; }
    flash.set(withSequence(withTiming(0.4, { duration: 50 }), withTiming(0, { duration: 220 })));
    read.set(0);
    read.set(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }, done => { if (done) scheduleOnRN(review); }));
  };
  const settle = async (keep: boolean) => {
    haptic("tap");
    if (keep && shot) {
      setStraightening(true);
      const flat = await crop.current?.straighten().catch(() => undefined);
      setStraightening(false);
      setPages(p => [...p, { ...shot, uri: flat ?? shot.uri }]);
    }
    setShot(undefined);
    const back = () => setPhase("idle");
    sheet.set(reducedMotion ? 0 : withTiming(0, { duration: 220, easing: EASE }, done => { if (done) scheduleOnRN(back); }));
    dim.set(withTiming(0, { duration: reducedMotion ? 0 : 260 }));
    if (reducedMotion) back();
  };
  const done = () => {
    haptic("tap");
    keepScan(pages.flatMap(p => (p.uri ? [p.uri] : [])));
    router.replace({ pathname: "/library-scanned", params: { scope: scope ?? "me" } });
  };

  const locked = phase !== "idle";
  const hint = !live && !__DEV__ ? "Allow the camera to scan pages" : pages.length ? "Turn the page, then capture" : "Hold the phone flat over one page";
  const count = `${pages.length} page${pages.length === 1 ? "" : "s"}`;

  return <View style={{ flex: 1, backgroundColor: "#07090D" }}>
    <SonaCamera ref={camera} torch={torch} onLive={setLive} why="Sona needs the camera to photograph paper pages for OCR." />
    {!live && __DEV__ && <DeskStandIn frame={{ left: frameLeft, top: frameTop, width: frameW, height: frameH }} />}
    {/* The captured page while Sona reads it and the doctor crops and checks it. */}
    {shot?.uri && <View style={[StyleSheet.absoluteFill, { backgroundColor: "#07090D" }]}>
      <CropStage ref={crop} source={shot.uri} frame={stage} editable={phase === "review" && canCrop}>
        {rect => phase === "reading" && <View pointerEvents="none" style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height }}><Sweep width={rect.width} height={rect.height} progress={read} /></View>}
      </CropStage>
    </View>}
    <LinearGradient pointerEvents="none" colors={["rgba(7,9,13,0.45)", "rgba(7,9,13,0)"]} style={{ position: "absolute", left: 0, right: 0, top: 0, height: insets.top + 100 }} />
    <LinearGradient pointerEvents="none" colors={["rgba(7,9,13,0)", "rgba(7,9,13,0.45)"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: DOCK + insets.bottom + 100 }} />

    {/* The room dims to the guide while a synthetic page is read (development without a camera). */}
    {!shot?.uri && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderColor: "rgba(10,12,18,0.58)", borderTopWidth: frameTop - 6, borderBottomWidth: H - frameTop - frameH - 6, borderLeftWidth: frameLeft - 6, borderRightWidth: frameLeft - 6 }, dimStyle]} />}
    {!shot?.uri && <View pointerEvents="none" style={{ position: "absolute", left: frameLeft, top: frameTop, width: frameW, height: frameH }}>
      <View style={{ position: "absolute", inset: 0, borderRadius: radius.control, overflow: "hidden" }}><Sweep width={frameW} height={frameH} progress={read} /></View>
      {(["tl", "tr", "bl", "br"] as const).map(c => <Corner key={c} corner={c} locked={locked} />)}
    </View>}

    <Animated.View style={[{ position: "absolute", top: insets.top + 10, left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 10 }, chromeStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close scanner" onPress={() => router.back()} hitSlop={6}>
        <LightGlass radius={22} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Icon name="xmark" size={15} color={palette.ink} /></LightGlass>
      </Pressable>
      <LightGlass radius={20} style={{ height: 40, paddingHorizontal: 14, flexDirection: "row", alignItems: "center" }}>
        <Text style={{ ...type.callout, fontWeight: "600", color: palette.ink }}>Scan pages</Text>
        <Text style={{ ...type.callout, color: palette.muted }}> · {pages.length ? `${pages.length} captured` : "none yet"}</Text>
      </LightGlass>
    </Animated.View>

    {phase === "idle" && <Animated.View key={hint} entering={reducedMotion ? undefined : FadeIn.duration(180)} pointerEvents="none" style={{ position: "absolute", alignSelf: "center", bottom: insets.bottom + DOCK + 26 }}>
      <LightGlass radius={18} style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
        <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>{hint}</Text>
      </LightGlass>
    </Animated.View>}


    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.white }, flashStyle]} />

    {/* Dock: Review capsule · ink shutter · torch. */}
    <Animated.View style={[{ position: "absolute", left: 12, right: 12, bottom: insets.bottom + 12 }, chromeStyle]}>
      <LightGlass radius={DOCK / 2} style={{ height: DOCK, paddingHorizontal: 10, flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          {pages.length > 0 && <ReviewCapsule pages={pages} label={count} onPress={done} />}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Capture page" onPress={() => void capture()} disabled={(!live && !__DEV__) || busy}>
          {({ pressed }) => <View style={{ width: 76, height: 76, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never}>
              <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2.5, borderColor: "rgba(255,255,255,0.92)" }} />
            </View>
          </View>}
        </Pressable>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          {live && <Pressable accessibilityRole="button" accessibilityLabel={torch ? "Turn light off" : "Turn light on"} onPress={() => { haptic("tap"); setTorch(t => !t); }} hitSlop={6}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: torch ? palette.ink : "rgba(20,28,40,0.06)" }}>
            <Icon name={torch ? "bolt.fill" : "bolt.slash"} size={16} color={torch ? palette.white : palette.ink} />
          </Pressable>}
        </View>
      </LightGlass>
    </Animated.View>

    {/* The page to check: springs up once it has been read. */}
    <Animated.View pointerEvents={phase === "review" ? "auto" : "none"} style={[{ position: "absolute", left: 10, right: 10, bottom: insets.bottom + 10 }, sheetStyle]}>
      <LightGlass radius={30} style={{ padding: 14, gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 46, height: 64, borderRadius: 7, overflow: "hidden", backgroundColor: "#F6F3EC", borderWidth: 1, borderColor: "rgba(20,28,40,0.1)" }}>
            {shot?.uri ? <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <PageLines small />}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text accessibilityLiveRegion="polite" style={{ ...type.headline, color: palette.ink }}>Page {pages.length + 1} captured</Text>
            <Text style={{ ...type.footnote, color: palette.muted }}>{canCrop && shot?.uri ? "Drag the corners onto the page's edges, then check the text is sharp." : "Check the text is sharp and the whole page is in the frame."}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable accessibilityRole="button" disabled={straightening} onPress={() => void settle(false)} style={({ pressed }) => ({ flex: 1, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(233,238,246,0.95)", borderWidth: 1, borderColor: palette.white, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <Text style={{ ...type.callout, fontWeight: "600", color: palette.ink }}>Retake</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={straightening} onPress={() => void settle(true)} style={({ pressed }) => ({ flex: 1.4, height: 46, borderRadius: 23, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.ink, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <HalftoneGlint width={72} height={46} origin={[10, 2]} reach={[64, 40]} pitch={3} strength={0.7} tint={[0.62, 0.78, 1]} hueShift={0.6} style={{ top: 0, left: 0 }} />
            <Text style={{ ...type.callout, fontWeight: "600", color: palette.white }}>{straightening ? "Straightening…" : "Next page"}</Text>
          </Pressable>
        </View>
      </LightGlass>
    </Animated.View>
  </View>;
}
