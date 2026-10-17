import type { CameraView } from "expo-camera";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Text } from "./text";
import { palette, type } from "./theme";

/**
 * Sona's one camera: Vision Camera in the app, expo-camera in Expo Go (which has no Vision Camera).
 * It only takes the photo; straightening happens after capture (`CropStage`), so both entry points
 * (the chat's attachments menu and the library's page scan) capture the same way. Both camera
 * modules load when a camera first opens, not with the app.
 */
const EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
/** Cropping writes a new file through native image code, so Expo Go shows the photo as taken. */
export const canCrop = !EXPO_GO;

export type CameraHandle = { takePhoto(): Promise<string | undefined> };
type Props = { ref?: Ref<CameraHandle>; torch?: boolean; onLive?: (live: boolean) => void; why: string };

export function SonaCamera(props: Props) {
  return EXPO_GO ? <ExpoCamera {...props} /> : <VisionCamera {...props} />;
}

function VisionCamera({ ref, torch = false, onLive, why }: Props) {
  const VC = require("react-native-vision-camera") as typeof import("react-native-vision-camera");
  const permission = VC.useCameraPermission();
  const photos = VC.usePhotoOutput({ quality: 0.9 });
  useEffect(() => { if (!permission.hasPermission && permission.canRequestPermission) void permission.requestPermission(); }, [permission.hasPermission, permission.canRequestPermission]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onLive?.(permission.hasPermission); }, [permission.hasPermission]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({
    async takePhoto() {
      const photo = await photos.capturePhoto({ enableShutterSound: false }, {});
      try {
        // Upright pixels (orientation applied), so the crop and every viewer agree without EXIF.
        const image = await photo.toImageAsync();
        // Free each 12 MP buffer at once; the garbage collector can't see native image sizes.
        try { return `file://${await image.saveToTemporaryFileAsync("jpg", 90)}`; } finally { image.dispose(); }
      } finally { photo.dispose(); }
    },
  }), [photos]);
  if (!permission.hasPermission) return <NeedsCamera why={why} onAllow={() => void (permission.canRequestPermission ? permission.requestPermission() : Linking.openSettings())} />;
  return <VC.Camera style={StyleSheet.absoluteFill} isActive device="back" outputs={[photos]} torchMode={torch ? "on" : "off"} />;
}

function ExpoCamera({ ref, torch = false, onLive, why }: Props) {
  const EC = require("expo-camera") as typeof import("expo-camera");
  const [permission, request] = EC.useCameraPermissions();
  const camera = useRef<CameraView>(null);
  useEffect(() => { if (permission && !permission.granted && permission.canAskAgain) void request(); }, [permission, request]);
  useEffect(() => { onLive?.(Boolean(permission?.granted)); }, [permission?.granted]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({ takePhoto: async () => (await camera.current?.takePictureAsync({ quality: 0.8 }))?.uri }), []);
  if (!permission?.granted) return <NeedsCamera why={why} onAllow={() => void (permission?.canAskAgain ? request() : Linking.openSettings())} />;
  return <EC.CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} />;
}

function NeedsCamera({ why, onAllow }: { why: string; onAllow: () => void }) {
  return <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", padding: 40, gap: 12 }]}>
    <Text style={{ ...type.callout, color: "rgba(255,255,255,0.85)", textAlign: "center" }}>{why}</Text>
    <Pressable accessibilityRole="button" onPress={onAllow} style={{ minHeight: 44, paddingHorizontal: 20, borderRadius: 22, justifyContent: "center", backgroundColor: palette.white }}>
      <Text style={{ ...type.callout, fontWeight: "600", color: palette.ink }}>Allow camera</Text>
    </Pressable>
  </View>;
}
