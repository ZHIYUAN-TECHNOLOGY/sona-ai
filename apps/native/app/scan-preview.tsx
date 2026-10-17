import { Redirect, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Caption } from "@/components/sona/parts";
import { Chip, Screen } from "@/components/sona/ui";
import { OriginalImageViewer, Preview } from "@/features/imaging";
import type { ScanState } from "@/features/imaging/upload";

// Developer preview only (dev builds, or a bundle built with EXPO_PUBLIC_SCAN_PREVIEW=true): the reading scan over the
// bundled reference film, with the reading toggled by hand, so it can be seen without uploading a film to a server.
const FILM = { id: "scan-preview", source: require("@/features/imaging/assets/normal-pa-chest.jpg"), title: "Reference film (preview)", attribution: "Mikael Häggström · Wikimedia Commons · 2017", license: "CC0 1.0", sourceUrl: "" };
const ON = __DEV__ || process.env.EXPO_PUBLIC_SCAN_PREVIEW === "true";

export default function ScanPreview() {
  const [scan, setScan] = useState<ScanState>("off");
  if (!ON) return <Redirect href="/" />;
  return <Screen>
    <Stack.Screen options={{ title: "Reading scan" }} />
    <Caption icon={null}>Developer preview · no image is read; the states are toggled by hand</Caption>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Chip label="Reading" selected={scan === "reading"} onPress={() => setScan("reading")} />
      <Chip label="Reading lands" selected={scan === "read"} onPress={() => setScan("read")} />
      <Chip label="Off (read failed)" selected={scan === "off"} onPress={() => setScan("off")} />
    </View>
    <Preview source={FILM.source} label="Reference film" scan={scan} onPress={() => {}} />
    <OriginalImageViewer asset={FILM} scan={scan} />
  </Screen>;
}
