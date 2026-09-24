import { Text } from "@/components/sona/text";
import { LegendList } from "@legendapp/list/react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library/legacy";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { Easing, interpolate, interpolateColor, type SharedValue, useAnimatedStyle, useDerivedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { BrandIcon, type BrandIconName } from "./brand-icon";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { HalftoneGlint, HalftoneShimmer } from "./halftone-shimmer";
import { AttachmentStrip } from "./attachment-stack";
import { useAccessibleEffects } from "./ui";
import { palette } from "./theme";

/**
 * Attachments menu (after the ChatGPT-style plus morph): the dock's plus button grows into a
 * floating menu, which can extend near full-screen into a recycled photo grid or a live camera.
 * Geometry is one continuous blend of three states —
 *   value = closed + (open − closed)·progress + (extended − open)·extend
 * — so closing from anywhere is a single spring straight back into the plus.
 */
export type Attachment = { uri: string; name: string; kind: "image" | "file" };
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
const TEACHING = require("@/features/imaging/assets/normal-pa-chest.jpg");
type Tile = { id: string; uri?: string; source?: number; name: string };

function tick() { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); }

export function AttachmentsMenu({ visible, progress, extend, anchor, reducedMotion, onClose, attached, onAdd, onRemove }: {
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
  const [tiles, setTiles] = useState<Tile[]>([{ id: "teaching", source: TEACHING, name: "Teaching chest X-ray" }]);
  const [libraryNote, setLibraryNote] = useState<string>();
  const [camPermission, requestCam] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  // Photos are multi-select: tap to pick, then Add.
  const [picked, setPicked] = useState<Tile[]>([]);
  const togglePick = (tile: Tile) => { tick(); setPicked(current => current.some(t => t.id === tile.id) ? current.filter(t => t.id !== tile.id) : [...current, tile]); };

  useEffect(() => { if (!visible) { setExtended(false); setPicked([]); } }, [visible]);

  const loadPhotos = async () => {
    const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]).catch(() => null);
    if (!permission?.granted) { setLibraryNote("Photo access is off. The teaching X-ray is still available."); return; }
    const page = await MediaLibrary.getAssetsAsync({ first: 60, mediaType: ["photo"], sortBy: [MediaLibrary.SortBy.creationTime] }).catch(() => null);
    setLibraryNote(undefined);
    if (page) setTiles(current => [current[0]!, ...page.assets.map(asset => ({ id: asset.id, uri: asset.uri, name: asset.filename }))]);
  };

  const open = (action: Surface | "files") => {
    tick();
    if (action === "files") {
      DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], copyToCacheDirectory: true }).then(result => {
        const file = result.canceled ? undefined : result.assets[0];
        if (file) onAdd([{ uri: file.uri, name: file.name, kind: file.mimeType?.startsWith("image/") ? "image" : "file" }]);
      }).catch(() => {});
      return;
    }
    setSurface(action); setExtended(true);
    extend.set(reducedMotion ? 1 : withSpring(1, MENU_SPRING));
    if (action === "photos") loadPhotos();
    if (action === "camera" && !camPermission?.granted) requestCam();
  };
  const backToMenu = () => {
    extend.set(reducedMotion ? 0 : withSpring(0, MENU_SPRING, finished => { "worklet"; if (finished) scheduleOnRN(setExtended, false); }));
    if (reducedMotion) setExtended(false);
  };
  const capture = async () => {
    tick();
    const photo = await camera.current?.takePictureAsync({ quality: 0.8 }).catch(() => undefined);
    if (photo?.uri) { onAdd([{ uri: photo.uri, name: "Camera capture", kind: "image" }]); backToMenu(); }
  };

  // Three key states, blended continuously.
  // With attachments chosen, the menu widens and a carousel of them sits above the items.
  const STRIP = attached.length ? 128 : 0;
  const menuW = attached.length ? W - 40 : 212, menuH = 184 + STRIP;
  const addPicked = () => { tick(); onAdd(picked.map(t => ({ uri: t.uri ?? "teaching", name: t.name, kind: "image" as const }))); setPicked([]); backToMenu(); };
  const openLeft = anchor.left - 14, openBottom = anchor.bottom - 8;
  const extTop = insets.top + 64, extBottom = 8;
  // Read both drivers directly in the worklet: Reanimated tracks shared values it can see here,
  // not ones read inside a helper.
  const geo = (closed: number, opened: number, full: number, p: number, x: number) => {
    "worklet";
    return closed + (opened - closed) * p + (full - opened) * x;
  };
  const shell = useAnimatedStyle(() => {
    const p = Math.max(0, progress.value), x = Math.max(0, extend.value);
    return {
      left: geo(anchor.left, openLeft, 8, p, x),
      bottom: geo(anchor.bottom, openBottom, extBottom, p, x),
      width: geo(anchor.size, menuW, W - 16, p, x),
      height: geo(anchor.size, menuH, H - extTop - extBottom, p, x),
      borderRadius: geo(anchor.size / 2, 30, 34, p, x),
      // Same glass as the plus it grows from: frost shows through, the bright rim stays.
      backgroundColor: interpolateColor(p, [0, 0.35], ["rgba(255,255,255,0.72)", reducedTransparency ? "rgba(255,255,255,0.97)" : "rgba(250,251,255,0.45)"]),
      borderColor: "rgba(255,255,255,0.9)",
    };
  });
  // The plus spins toward a close mark as the glass grows over it.
  const plusStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.45], [1, 0], "clamp"), transform: [{ rotate: `${interpolate(progress.value, [0, 0.6], [0, 135], "clamp")}deg` }] }));
  // The screen behind frosts over for focus: a static blur, crossfaded by opacity.
  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.6], [0, 1], "clamp") }));
  const itemsStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - extend.value * 2),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.75, 1]) }],
  }));
  // Items arrive top first, each rising from the bottom edge as the glass opens, and leave in reverse.
  const item0 = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0.35, 0.75], [0, 1], "clamp"), transform: [{ translateY: interpolate(progress.value, [0.35, 0.75], [12, 0], "clamp") }, { scale: interpolate(progress.value, [0.35, 0.75], [0.9, 1], "clamp") }] }));
  const item1 = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0.5, 0.9], [0, 1], "clamp"), transform: [{ translateY: interpolate(progress.value, [0.5, 0.9], [12, 0], "clamp") }, { scale: interpolate(progress.value, [0.5, 0.9], [0.9, 1], "clamp") }] }));
  const item2 = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0.65, 1], [0, 1], "clamp"), transform: [{ translateY: interpolate(progress.value, [0.65, 1], [12, 0], "clamp") }, { scale: interpolate(progress.value, [0.65, 1], [0.9, 1], "clamp") }] }));
  const itemStyles = [item0, item1, item2];
  const glintStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, interpolate(progress.value, [0.5, 1], [0, 1], "clamp") - extend.value * 2) }));
  const surfaceStyle = useAnimatedStyle(() => ({ opacity: interpolate(extend.value, [0.6, 1], [0, 1], "clamp") }));
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(extend.value, [0.8, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(extend.value, [0.8, 1], [16, 0], "clamp") }],
  }));
  // The dithered sweep rides whichever morph is in motion.
  const sweep = useDerivedValue(() => (extend.value > 0.001 && extend.value < 0.999 ? extend.value : progress.value));

  if (!visible) return null;
  const cell = (W - 16 - 2) / 3;
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, scrimStyle]}>
      {reducedTransparency ? <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(236,239,244,0.85)" }]} /> : <BlurView tint="light" intensity={28} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(232,236,243,0.3)" }]} />
    </Animated.View>
    <Pressable accessibilityRole="button" accessibilityLabel="Close attachments" onPress={onClose} style={StyleSheet.absoluteFill} />

    <Animated.View style={[{ position: "absolute", overflow: "hidden", borderCurve: "continuous", borderWidth: 1, boxShadow: "0 8px 28px rgba(40,70,140,0.14)" }, shell]}>
      {!reducedTransparency && (glass
        ? <><BlurView tint="systemThinMaterialLight" intensity={70} style={StyleSheet.absoluteFill} /><GlassView colorScheme="light" glassEffectStyle="regular" tintColor="rgba(250,251,255,0.4)" style={[StyleSheet.absoluteFill, { borderRadius: 30 }]} /></>
        : <BlurView tint="systemUltraThinMaterialLight" intensity={60} style={StyleSheet.absoluteFill} />)}
      {!reducedTransparency && <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0 }, glintStyle]}><HalftoneGlint width={menuW} height={40} origin={[24, 0]} reach={[menuW * 0.7, 30]} strength={0.45} /></Animated.View>}
      {!reducedMotion && <HalftoneShimmer width={W} height={H} progress={sweep} />}

      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, bottom: 0, width: anchor.size, height: anchor.size, alignItems: "center", justifyContent: "center" }, plusStyle]}>
        <BrandIcon name="add" size={23} />
      </Animated.View>

      {attached.length > 0 && <Animated.View pointerEvents={extended ? "none" : "auto"} style={[{ position: "absolute", left: 16, right: 0, bottom: 184, height: STRIP, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: "rgba(20,28,40,0.07)", marginRight: 16 }, itemsStyle]}>
        <AttachmentStrip items={attached} onRemove={onRemove} />
      </Animated.View>}
      <Animated.View pointerEvents={extended ? "none" : "auto"} style={[{ position: "absolute", left: 0, bottom: 0, width: 212, height: 184, paddingHorizontal: 20, paddingVertical: 16, justifyContent: "space-between", transformOrigin: "left bottom" }, itemsStyle]}>
        {ITEMS.map((item, i) => <Animated.View key={item.label} style={[{ transformOrigin: "bottom left" }, itemStyles[i]]}>
          <Pressable accessibilityRole="button" accessibilityLabel={item.label} onPress={() => open(item.action)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 44, transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
            <BrandIcon name={item.icon} size={22} color={palette.ink} />
            <Text style={{ fontSize: 17, color: palette.ink }}>{item.label}</Text>
          </Pressable>
        </Animated.View>)}
      </Animated.View>

      {extended && <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: palette.surface }, surfaceStyle]}>
        {surface === "camera"
          ? <View style={{ flex: 1, backgroundColor: "#0C0F14" }}>
            {camPermission?.granted ? <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
              : <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 }}><Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Camera access needed</Text><Text style={{ color: "rgba(255,255,255,0.7)", textAlign: "center" }}>Allow the camera to photograph a film or document for review.</Text></View>}
          </View>
          : <LegendList data={tiles} keyExtractor={tile => tile.id} numColumns={3} estimatedItemSize={cell} recycleItems showsVerticalScrollIndicator={false}
            columnWrapperStyle={{ gap: 1 }} contentContainerStyle={{ paddingBottom: 96 }}
            ListHeaderComponent={libraryNote ? <Text style={{ padding: 16, fontSize: 13, color: palette.muted }}>{libraryNote}</Text> : null}
            extraData={picked}
            renderItem={({ item }) => { const order = picked.findIndex(t => t.id === item.id); return <Pressable accessibilityRole="button" accessibilityLabel={`${order >= 0 ? "Deselect" : "Select"} ${item.name}`} accessibilityState={{ selected: order >= 0 }} onPress={() => togglePick(item)} style={{ flex: 1, aspectRatio: 1, marginBottom: 1 }}>
              <Image source={item.source ?? { uri: item.uri }} contentFit="cover" recyclingKey={item.id} style={{ flex: 1, backgroundColor: "rgba(120,120,128,0.12)", opacity: order >= 0 ? 0.82 : 1 }} />
              <View pointerEvents="none" style={{ position: "absolute", right: 8, bottom: 8, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: palette.white, alignItems: "center", justifyContent: "center", backgroundColor: order >= 0 ? palette.blue : "rgba(0,0,0,0.18)", transform: [{ scale: order >= 0 ? 1 : 0.9 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 160 } as never}>
                {order >= 0 && <Text style={{ fontSize: 12, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{order + 1}</Text>}
              </View>
            </Pressable>; }} />}
      </Animated.View>}
    </Animated.View>

    {extended && <Animated.View pointerEvents="box-none" style={[{ position: "absolute", left: 28, right: 28, bottom: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, controlsStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to attachment options" onPress={backToMenu} hitSlop={6}
        style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: surface === "camera" ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.92)", boxShadow: "0 4px 14px rgba(24,32,48,0.14)" }}>
        <BrandIcon name="back" size={22} color={surface === "camera" ? palette.white : palette.ink} />
      </Pressable>
      {surface === "camera" && camPermission?.granted && <Pressable accessibilityRole="button" accessibilityLabel="Take photo" onPress={capture}
        style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 4, borderColor: palette.white, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: palette.white }} />
      </Pressable>}
      {surface === "photos" && picked.length > 0
        ? <Pressable accessibilityRole="button" accessibilityLabel={`Add ${picked.length} ${picked.length === 1 ? "photo" : "photos"}`} onPress={addPicked}
          style={({ pressed }) => ({ height: 48, paddingHorizontal: 22, borderRadius: 24, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.ink, boxShadow: "0 6px 16px rgba(24,32,48,0.2)", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <BrandIcon name="check" size={18} color={palette.white} strokeWidth={2.2} />
          <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>Add {picked.length}</Text>
        </Pressable>
        : <View style={{ width: 48 }} />}
    </Animated.View>}
  </View>;
}
