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
import { HalftoneShimmer } from "./halftone-shimmer";
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

export const MENU_SPRING = { duration: 450, dampingRatio: 0.86 };
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

export function AttachmentsMenu({ visible, progress, extend, anchor, reducedMotion, onClose, onAttach }: {
  visible: boolean;
  /** 0 → 1: plus → menu. */
  progress: SharedValue<number>;
  /** 0 → 1: menu → photo grid / camera. */
  extend: SharedValue<number>;
  /** The plus button's frame in screen space (bottom-left origin). */
  anchor: { left: number; bottom: number; size: number };
  reducedMotion: boolean;
  onClose: () => void;
  onAttach: (item: Attachment) => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [surface, setSurface] = useState<Surface>("photos");
  const [extended, setExtended] = useState(false);
  const [tiles, setTiles] = useState<Tile[]>([{ id: "teaching", source: TEACHING, name: "Teaching chest X-ray" }]);
  const [libraryNote, setLibraryNote] = useState<string>();
  const [camPermission, requestCam] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  useEffect(() => { if (!visible) setExtended(false); }, [visible]);

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
        if (file) onAttach({ uri: file.uri, name: file.name, kind: file.mimeType?.startsWith("image/") ? "image" : "file" });
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
    if (photo?.uri) onAttach({ uri: photo.uri, name: "Camera capture", kind: "image" });
  };

  // Three key states, blended continuously.
  const menuW = 250, menuH = 212;
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
      backgroundColor: interpolateColor(p, [0, 0.35], ["rgba(255,255,255,0.72)", "rgba(255,255,255,0.96)"]),
      borderColor: interpolateColor(p, [0, 0.35], ["rgba(255,255,255,0.9)", "rgba(255,255,255,0)"]),
    };
  });
  const plusStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.3], [1, 0], "clamp"), transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 45], "clamp")}deg` }] }));
  const itemsStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, interpolate(progress.value, [0.6, 1], [0, 1], "clamp") - extend.value * 2),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.75, 1]) }],
  }));
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
    <Pressable accessibilityRole="button" accessibilityLabel="Close attachments" onPress={onClose} style={StyleSheet.absoluteFill} />

    <Animated.View style={[{ position: "absolute", overflow: "hidden", borderCurve: "continuous", borderWidth: 1, boxShadow: "0 8px 28px rgba(40,70,140,0.14)" }, shell]}>
      {!reducedMotion && <HalftoneShimmer width={W} height={H} progress={sweep} />}

      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, bottom: 0, width: anchor.size, height: anchor.size, alignItems: "center", justifyContent: "center" }, plusStyle]}>
        <BrandIcon name="add" size={23} />
      </Animated.View>

      <Animated.View pointerEvents={extended ? "none" : "auto"} style={[{ position: "absolute", left: 0, bottom: 0, width: menuW, height: menuH, paddingHorizontal: 22, paddingVertical: 20, justifyContent: "space-between", transformOrigin: "left bottom" }, itemsStyle]}>
        {ITEMS.map(item => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => open(item.action)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48, transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(36,91,204,0.08)", alignItems: "center", justifyContent: "center" }}><BrandIcon name={item.icon} size={23} color={palette.ink} /></View>
          <Text style={{ fontSize: 18, color: palette.ink }}>{item.label}</Text>
        </Pressable>)}
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
            renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Attach ${item.name}`} onPress={() => { tick(); onAttach({ uri: item.uri ?? "teaching", name: item.name, kind: "image" }); }} style={{ flex: 1, aspectRatio: 1, marginBottom: 1 }}>
              <Image source={item.source ?? { uri: item.uri }} contentFit="cover" recyclingKey={item.id} style={{ flex: 1, backgroundColor: "rgba(120,120,128,0.12)" }} />
            </Pressable>} />}
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
      <View style={{ width: 48 }} />
    </Animated.View>}
  </View>;
}
