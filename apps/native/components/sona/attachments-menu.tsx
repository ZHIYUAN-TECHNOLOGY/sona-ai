import { Text } from "@/components/sona/text";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, interpolate, interpolateColor, type SharedValue, useAnimatedStyle, useDerivedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { BrandIcon, type BrandIconName } from "./brand-icon";
import { BlurView } from "expo-blur";
import { StatusBar } from "expo-status-bar";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { HalftoneGlint, HalftoneShimmer } from "./halftone-shimmer";
import { AttachmentStrip, attachmentSource } from "./attachment-stack";
import { CaptureScan } from "./capture-scan";
import { PhotoReview } from "./photo-review";
import { ReviewCapsule } from "@/features/library/scan-parts";
import { suggestImageType, type ImageType } from "./image-type";
import { Icon, useAccessibleEffects } from "./ui";
import { setScreenCovered } from "./use-visible";
import { SonaCamera, type CameraHandle } from "./sona-camera";
import { palette, type } from "./theme";

/**
 * Attachments menu (after the ChatGPT-style plus morph): the dock's plus button grows into a
 * floating menu, which can extend near full-screen into a recycled photo grid or a live camera.
 * Camera takes one photo at a time: each is read, cropped and straightened if needed (a document's
 * page, a film's edges) and typed as it is taken, and the camera stays open for the next. Photos
 * types a picked batch at once. Both open full screen: the glass keeps growing past the menu to
 * the screen's edges while the live view fades in inside it (after Avec's button-to-video morph,
 * https://60fps.design/shots/avec-button-morph-scale-to-video-interaction), and the camera's
 * chrome follows Tilt (https://60fps.design/shots/tilt-time-style): edge-to-edge viewfinder, a
 * faint thirds grid, close top left, recent photos · shutter · light along the bottom, and a
 * hint above the shutter until the first photo.
 * Geometry is one continuous blend of three states —
 *   value = closed + (open − closed)·progress + (extended − open)·extend
 * — so closing from anywhere is a single spring straight back into the plus.
 */
export type Attachment = { uri: string; name: string; kind: "image" | "file"; imageType?: ImageType };
type Surface = "photos" | "camera";

// After Whistle's plus menu (spring 0.42 s, damping 0.76), a touch calmer because the glass itself resizes.
export const MENU_SPRING = { duration: 420, dampingRatio: 0.8 };
/**
 * Closing is a system response, not a gesture, so it uses timing on the iOS sheet curve: fast
 * start, long soft landing, no overshoot — the shape eases into the plus instead of arriving.
 * Content clears in the first ~40 % so the shrinking glass reads as one clean shape.
 */
export const MENU_CLOSE = { duration: 380, easing: Easing.bezier(0.32, 0.72, 0, 1) };
const ITEMS: { label: string; icon: BrandIconName; action: Surface | "files" }[] = [
  { label: "Photos", icon: "image", action: "photos" },
  { label: "Camera", icon: "camera", action: "camera" },
  { label: "Files", icon: "files", action: "files" },
];

function tick() { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); }
// Items arrive top first, each rising from the bottom edge as the glass opens, and leave in reverse.
function useItemStyle(progress: SharedValue<number>, from: number) {
  return useAnimatedStyle(() => {
    const t = interpolate(progress.value, [from, Math.min(1, from + 0.36)], [0, 1], "clamp");
    return { opacity: t, transform: [{ translateY: (1 - t) * 12 }, { scale: 0.9 + t * 0.1 }] };
  });
}

export function AttachmentsMenu({ visible, progress, extend, anchor, reducedMotion, onClose, attached, onAdd, onRemove, hint }: {
  /** What the clinician has typed so far; preselects the capture's image type. */
  hint?: string;
  visible: boolean;
  /** 0 → 1: plus → menu. */
  progress: SharedValue<number>;
  /** 0 → 1: menu → photo grid / camera. */
  extend: SharedValue<number>;
  /** The plus button's frame in screen space (bottom-left origin). */
  anchor: { left: number; bottom: number; size: number };
  reducedMotion: boolean;
  onClose: () => void;
  /** Attachments chosen so far; shown as a carousel at the top of the menu. */
  attached: Attachment[];
  onAdd: (items: Attachment[]) => void;
  onRemove: (item: Attachment) => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const { reducedTransparency } = useAccessibleEffects();
  const glass = process.env.EXPO_OS === "ios" && isLiquidGlassAvailable();
  const insets = useSafeAreaInsets();
  const [surface, setSurface] = useState<Surface>("photos");
  const [extended, setExtended] = useState(false);
  const [live, setLive] = useState(false);
  const [torch, setTorch] = useState(false);
  const camera = useRef<CameraHandle>(null);
  // The frozen capture under review; "teaching" stands in for the camera on a simulator (dev only).
  const [shot, setShot] = useState<string>();
  // Photos picked from the library, typed on the review surface before they attach.
  const [picked, setPicked] = useState<Attachment[]>([]);
  // Photos attached in this camera session, and the last type chosen (the next photo's default).
  const [taken, setTaken] = useState<Attachment[]>([]);
  const [lastType, setLastType] = useState<ImageType>();
  const suggested = lastType ?? suggestImageType(hint);

  // Full screen, after the morph has landed: the layers underneath (blurs, glass, shimmer) are unmounted and the camera starts.
  const [landed, setLanded] = useState(false);
  useEffect(() => { if (!visible) { setExtended(false); setLanded(false); setShot(undefined); setTaken([]); setTorch(false); } }, [visible]);
  // While the menu is open its frosted scrim hides the screen, so the screen's idle loops (the ambient wash, the orb) pause
  // instead of making the blurs above them re-render every frame.
  useEffect(() => { setScreenCovered(visible); return () => setScreenCovered(false); }, [visible]);

  const open = (action: Surface | "files") => {
    tick();
    if (action === "files") {
      DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], copyToCacheDirectory: true }).then(result => {
        const file = result.canceled ? undefined : result.assets[0];
        if (file) onAdd([{ uri: file.uri, name: file.name, kind: file.mimeType?.startsWith("image/") ? "image" : "file" }]);
      }).catch(() => {});
      return;
    }
    if (action === "photos") {
      // Apple's system photo picker (PHPicker): multi-select, ordered, private (no library permission).
      ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, orderedSelection: true, selectionLimit: 10, quality: 0.8 }).then(result => {
        if (result.canceled || !result.assets.length) return;
        setPicked(result.assets.map((asset, i) => ({ uri: asset.uri, name: asset.fileName ?? `Photo ${i + 1}`, kind: "image" as const })));
        extendTo("photos");
      }).catch(() => {});
      return;
    }
    setTaken([]); extendTo("camera");
  };
  const extendTo = (next: Surface) => {
    setSurface(next); setExtended(true);
    extend.set(reducedMotion ? 1 : withSpring(1, MENU_SPRING, finished => { "worklet"; if (finished) scheduleOnRN(setLanded, true); }));
    if (reducedMotion) setLanded(true);
  };
  const backToMenu = () => {
    setLanded(false); setLive(false);
    extend.set(reducedMotion ? 0 : withSpring(0, MENU_SPRING, finished => { "worklet"; if (finished) scheduleOnRN(setExtended, false); }));
    if (reducedMotion) setExtended(false);
  };
  const capture = async () => {
    tick();
    const photo = await camera.current?.takePhoto().catch(() => undefined);
    // ponytail: simulators have no camera; in development the bundled teaching film stands in so the scan can be reviewed.
    const uri = photo ?? (__DEV__ ? "teaching" : undefined);
    if (uri) setShot(uri);
  };
  // Attaching keeps the camera open for the next photo, with this type as its default; Done returns to the menu.
  const attachShot = (imageType: ImageType, cropped?: string) => {
    if (!shot) return;
    const item = { uri: cropped ?? shot, name: `${imageType} capture`, kind: "image" as const, imageType };
    onAdd([item]); setTaken(t => [...t, item]); setLastType(imageType); setShot(undefined);
  };
  const attachPicked = (chosen: Attachment[]) => {
    onAdd(chosen);
    if (chosen[0]?.imageType) setLastType(chosen[0].imageType);
    backToMenu();
  };

  // Three key states, blended continuously.
  // With attachments chosen, the menu widens and a carousel of them sits above the items.
  const STRIP = attached.length ? 128 : 0;
  const ITEMS_H = 32 + ITEMS.length * 44 + (ITEMS.length - 1) * 10;
  const menuW = attached.length ? W - 40 : 212, menuH = ITEMS_H + STRIP;

  const openLeft = anchor.left - 14, openBottom = anchor.bottom - 8;
  // Extended is the whole screen; the display's own rounded corners finish the shape.
  // Read both drivers directly in the worklet: Reanimated tracks shared values it can see here,
  // not ones read inside a helper.
  const geo = (closed: number, opened: number, full: number, p: number, x: number) => {
    "worklet";
    return closed + (opened - closed) * p + (full - opened) * x;
  };
  const shell = useAnimatedStyle(() => {
    const p = Math.max(0, progress.value), x = Math.max(0, extend.value);
    return {
      left: geo(anchor.left, openLeft, 0, p, x),
      bottom: geo(anchor.bottom, openBottom, 0, p, x),
      width: geo(anchor.size, menuW, W, p, x),
      height: geo(anchor.size, menuH, H, p, x),
      borderRadius: geo(anchor.size / 2, 30, 0, p, x),
      // Same glass as the plus it grows from: frost shows through, the bright rim stays.
      backgroundColor: interpolateColor(p, [0, 0.35], ["rgba(255,255,255,0.72)", reducedTransparency ? "rgba(255,255,255,0.97)" : "rgba(250,251,255,0.45)"]),
      // The rim fades as the glass reaches the screen's edges.
      borderColor: `rgba(255,255,255,${0.9 * (1 - x)})`,
    };
  });
  // The frosted glass keeps the menu's size and fades as the shell grows past it, so no blur resizes on every frame of the morph.
  const glassStyle = useAnimatedStyle(() => {
    const p = Math.max(0, progress.value);
    return { width: anchor.size + (menuW - anchor.size) * p, height: anchor.size + (menuH - anchor.size) * p, opacity: 1 - Math.min(1, Math.max(0, extend.value) * 3) };
  });
  // The plus spins toward a close mark as the glass grows over it.
  const plusStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.45], [1, 0], "clamp"), transform: [{ rotate: `${interpolate(progress.value, [0, 0.6], [0, 135], "clamp")}deg` }] }));
  // The screen behind frosts over for focus: a static blur, crossfaded by opacity.
  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.6], [0, 1], "clamp") }));
  const itemsStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - extend.value * 2),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.75, 1]) }],
  }));
  const itemStyles = [useItemStyle(progress, 0.35), useItemStyle(progress, 0.5), useItemStyle(progress, 0.64)];
  const glintStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, interpolate(progress.value, [0.5, 1], [0, 1], "clamp") - extend.value * 2) }));
  // The live view shows early, inside the still-growing glass, as Avec's video does.
  const surfaceStyle = useAnimatedStyle(() => ({ opacity: interpolate(extend.value, [0.15, 0.55], [0, 1], "clamp") }));
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(extend.value, [0.8, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(extend.value, [0.8, 1], [16, 0], "clamp") }],
  }));
  // The dithered sweep rides whichever morph is in motion.
  const sweep = useDerivedValue(() => (extend.value > 0.001 && extend.value < 0.999 ? extend.value : progress.value));

  if (!visible) return null;
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    {!landed && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, scrimStyle]}>
      {reducedTransparency ? <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(236,239,244,0.85)" }]} /> : <BlurView tint="light" intensity={28} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(232,236,243,0.3)" }]} />
    </Animated.View>}
    <Pressable accessibilityRole="button" accessibilityLabel="Close attachments" onPress={onClose} style={StyleSheet.absoluteFill} />

    <Animated.View style={[{ position: "absolute", overflow: "hidden", borderCurve: "continuous", borderWidth: 1, boxShadow: "0 8px 28px rgba(40,70,140,0.14)" }, shell]}>
      {!reducedTransparency && !landed && <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, bottom: 0 }, glassStyle]}>
        {glass
          ? <><BlurView tint="systemThinMaterialLight" intensity={70} style={StyleSheet.absoluteFill} /><GlassView colorScheme="light" glassEffectStyle="regular" tintColor="rgba(250,251,255,0.4)" style={[StyleSheet.absoluteFill, { borderRadius: 30 }]} /></>
          : <BlurView tint="systemUltraThinMaterialLight" intensity={60} style={StyleSheet.absoluteFill} />}
      </Animated.View>}
      {!reducedTransparency && !landed && <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0 }, glintStyle]}><HalftoneGlint width={menuW} height={40} origin={[24, 0]} reach={[menuW * 0.7, 30]} strength={0.45} /></Animated.View>}
      {!reducedMotion && !landed && <HalftoneShimmer width={W} height={H} progress={sweep} />}

      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, bottom: 0, width: anchor.size, height: anchor.size, alignItems: "center", justifyContent: "center" }, plusStyle]}>
        <BrandIcon name="add" size={23} />
      </Animated.View>

      {attached.length > 0 && <Animated.View pointerEvents={extended ? "none" : "auto"} style={[{ position: "absolute", left: 16, right: 0, bottom: ITEMS_H, height: STRIP, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: "rgba(20,28,40,0.07)", marginRight: 16 }, itemsStyle]}>
        <AttachmentStrip items={attached} onRemove={onRemove} />
      </Animated.View>}
      <Animated.View pointerEvents={extended ? "none" : "auto"} style={[{ position: "absolute", left: 0, bottom: 0, width: 212, height: ITEMS_H, paddingHorizontal: 20, paddingVertical: 16, justifyContent: "space-between", transformOrigin: "left bottom" }, itemsStyle]}>
        {ITEMS.map((item, i) => <Animated.View key={item.label} style={[{ transformOrigin: "bottom left" }, itemStyles[i]]}>
          <Pressable accessibilityRole="button" accessibilityLabel={item.label} onPress={() => open(item.action)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 44, transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
            <BrandIcon name={item.icon} size={22} color={palette.ink} />
            <Text style={{ fontSize: 17, color: palette.ink }}>{item.label}</Text>
          </Pressable>
        </Animated.View>)}
      </Animated.View>

      {/* Pinned at full-screen size and revealed by the growing shell, so its contents never re-lay-out during the morph. */}
      {extended && <Animated.View style={[{ position: "absolute", left: 0, bottom: 0, width: W, height: H, backgroundColor: palette.surface }, surfaceStyle]}>
        {surface === "camera" ? <>
          <View style={{ flex: 1, backgroundColor: "#0C0F14" }}>
            {/* The camera starts once the glass has landed: no session start or preview resize mid-morph. */}
            {landed && <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
              <SonaCamera ref={camera} torch={torch} onLive={setLive} why="Allow the camera to photograph a film, wound, skin or document for review." />
            </Animated.View>}
            {/* A faint thirds grid to square up a film or a page. */}
            {live && !shot && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {[1, 2].map(i => <View key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${(i * 100) / 3}%`, width: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.28)" }} />)}
              {[1, 2].map(i => <View key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: `${(i * 100) / 3}%`, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.28)" }} />)}
            </View>}
          </View>
          {shot && <CaptureScan key={shot} suggested={suggested} source={attachmentSource({ uri: shot, name: "", kind: "image" })} width={W} height={H} onRetake={() => setShot(undefined)} onAttach={attachShot} />}
        </> : <PhotoReview key={picked[0]?.uri} photos={picked} suggested={suggested} bottom={Math.max(insets.bottom, 16)} onAttach={attachPicked} onBack={backToMenu} />}
      </Animated.View>}
    </Animated.View>

    {extended && surface === "camera" && <StatusBar style="light" />}
    {extended && surface === "camera" && !shot && <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, controlsStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={backToMenu} hitSlop={8}
        style={({ pressed }) => ({ position: "absolute", top: insets.top + 8, left: 16, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,24,32,0.42)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
        <Icon name="xmark" size={15} color={palette.white} />
      </Pressable>
      {!taken.length && (live || __DEV__) && <View pointerEvents="none" style={{ position: "absolute", alignSelf: "center", bottom: insets.bottom + 124, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: "rgba(250,251,253,0.92)" }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>A film, wound, skin or page</Text>
      </View>}
      <View style={{ position: "absolute", left: 20, right: 20, bottom: insets.bottom + 24, flexDirection: "row", alignItems: "center" }}>
        {/* What this session attached so far; Done returns to the menu, where the strip shows them all. */}
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          {taken.length > 0 && <ReviewCapsule title="Done" pages={taken.map((a, i) => ({ id: i, uri: a.uri === "teaching" ? undefined : a.uri }))} label={`${taken.length} added`} onPress={backToMenu} />}
        </View>
        {live || __DEV__ ? <Pressable accessibilityRole="button" accessibilityLabel="Take photo" onPress={capture}
          style={({ pressed }) => ({ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: palette.white, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: palette.white }} />
        </Pressable> : <View style={{ width: 76 }} />}
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          {live && <Pressable accessibilityRole="button" accessibilityLabel={torch ? "Turn light off" : "Turn light on"} onPress={() => { tick(); setTorch(t => !t); }} hitSlop={6}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: torch ? palette.white : "rgba(20,24,32,0.42)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" }}>
            <Icon name={torch ? "bolt.fill" : "bolt.slash"} size={16} color={torch ? palette.ink : palette.white} />
          </Pressable>}
        </View>
      </View>
    </Animated.View>}
  </View>;
}
