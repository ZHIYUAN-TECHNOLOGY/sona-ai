import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import { riseIn } from "@/components/sona/motion";
import { Disclosure, IconDisc, Press } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, glass, Icon, Notice, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/scribe/parts";
import { ScannedPages } from "./scan-parts";
import { handOffXray, lastScan } from "./scan-state";

/**
 * Route `/library-scanned`: "What did you scan?", straight after the pages are photographed and cropped.
 * A photo of a page and a photo of a radiograph look alike to the app. Until
 * MedGemma (box ③) is hosted to suggest the kind, the doctor says what it is, and each kind goes
 * where it belongs: documents to OCR and the library, a chest X-ray to a patient's visit (never
 * read as text), a CT photo nowhere. See docs/delivery-plan.md, "Classify before OCR".
 */
export function ScannedSheet() {
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const { reducedMotion } = useAccessibleEffects();
  const [pages] = useState(lastScan);
  const [ct, setCt] = useState(false);
  const n = pages.length;

  const asDocument = () => {
    haptic("tap");
    router.replace({ pathname: "/library-ocr", params: { title: `Scanned pages (${n} page${n === 1 ? "" : "s"})`, scope: scope ?? "me", scanned: "1" } });
  };
  const asXray = () => {
    haptic("tap");
    handOffXray(pages[0]!);
    // Close the scan sheets, then choose whose visit it belongs to; the visit opens on its X-ray page with this image attached.
    router.dismissAll();
    setTimeout(() => router.push({ pathname: "/patients", params: { view: "xray" } }), 300);
  };

  const rows = [
    <Row key="doc" icon="doc.text" title="Printed document" detail="A guideline, protocol or paper. Sona reads it, then adds it to your library" onPress={asDocument} />,
    <Row key="xray" icon="lungs" title="Chest X-ray" detail={`Attach it to a patient's visit. It won't be read as text${n > 1 ? " (first page only)" : ""}`} onPress={asXray} />,
    <Disclosure key="ct" first icon="square.stack.3d.up" title="CT scan" detail="A photo of one slice" open={ct} onToggle={() => setCt(o => !o)}>
      <Notice warning>CT from a photo isn't supported: one slice can't show the whole scan. Attach the study from PACS instead. Nothing from this scan is sent or saved.</Notice>
      <Action label="Done" secondary onPress={() => router.back()} />
    </Disclosure>,
    <Row key="other" icon="questionmark.circle" title="Something else" detail="Nothing is sent or saved" onPress={() => { haptic("tap"); router.back(); }} />,
  ];

  return <ScrollView contentContainerStyle={{ paddingTop: 36, paddingBottom: 34, paddingHorizontal: 20, gap: 16 }}>
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ ...type.heading, color: palette.ink }}>What did you scan?</Text>
      <Text style={{ ...type.subhead, color: palette.muted }}>{n} page{n === 1 ? "" : "s"} scanned and straightened. Sona sends each kind to the right place.</Text>
    </View>
    {n > 0 && <ScannedPages pages={pages} pass="arrive" />}
    <View style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, paddingHorizontal: 14 }}>
      {rows.map((row, i) => <Animated.View key={i} entering={reducedMotion ? undefined : riseIn({ delay: (n ? 560 : 60) + i * 45, distance: 8, duration: 280 })} style={i ? { borderTopWidth: 1, borderColor: glass.hairline } : undefined}>{row}</Animated.View>)}
    </View>
  </ScrollView>;
}

function Row({ icon, title, detail, onPress }: { icon: string; title: string; detail: string; onPress: () => void }) {
  return <Press onPress={onPress} accessibilityLabel={`${title}. ${detail}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 }}>
    <IconDisc icon={icon} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "600", color: palette.ink }}>{title}</Text>
      <Text style={{ fontSize: 14, lineHeight: 20, color: palette.muted }}>{detail}</Text>
    </View>
    <Icon name="chevron.right" size={12} color={palette.muted} />
  </Press>;
}
