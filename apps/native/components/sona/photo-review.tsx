import { Image } from "expo-image";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { attachmentSource } from "./attachment-stack";
import type { Attachment } from "./attachments-menu";
import { TypeChips } from "./capture-scan";
import { CT_NOTE, NOT_ATTACHED, type ImageType } from "./image-type";
import { LAYOUT, riseIn } from "./motion";
import { Press } from "./parts";
import { Text } from "./text";
import { palette, type, radius } from "./theme";
import { Action, Expand, Icon, useAccessibleEffects } from "./ui";

/**
 * Photos picked from the library, typed before they are attached. Most batches are one kind, so one
 * row of chips sets them all; a photo that differs opens in place to take its own type. A CT or MRI
 * photo stays behind with the reason. Later a hosted classifier preselects each type; the doctor
 * still confirms here.
 */
export function PhotoReview({ photos, suggested, bottom, onAttach, onBack }: { photos: Attachment[]; suggested: ImageType; bottom: number; onAttach: (items: Attachment[]) => void; onBack: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const insets = useSafeAreaInsets();
  const [types, setTypes] = useState<ImageType[]>(() => photos.map(() => suggested));
  const [open, setOpen] = useState<number>();
  const all = types.every(t => t === types[0]) ? types[0] : undefined;
  const kept = photos.flatMap((p, i) => types[i] === NOT_ATTACHED ? [] : [{ ...p, imageType: types[i] }]);
  const setAll = (t: ImageType) => { setTypes(photos.map(() => t)); setOpen(undefined); };
  const setOne = (i: number, t: ImageType) => { setTypes(ts => ts.map((x, j) => (j === i ? t : x))); setOpen(undefined); };

  return <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: bottom + 90, gap: 18 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ ...type.heading, color: palette.ink }}>{photos.length === 1 ? "What is this image?" : "What are these images?"}</Text>
        <Text style={{ ...type.footnote, color: palette.muted }}>{photos.length === 1 ? "Analysis depends on the type." : "Set them all at once, then tap any that differ. Analysis depends on the type."}</Text>
      </View>
      <View style={{ gap: 8 }}>
        {photos.length > 1 && <Text style={{ ...type.caption, fontWeight: "600", color: palette.muted }}>All {photos.length}</Text>}
        <TypeChips value={all} onChange={setAll} />
      </View>
      {photos.length > 1 && <View style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, paddingHorizontal: 14 }}>
        {photos.map((p, i) => <Animated.View key={p.uri} entering={reducedMotion ? undefined : riseIn({ delay: 60 + i * 40, distance: 8, duration: 280 })} layout={reducedMotion ? undefined : LAYOUT} style={i ? { borderTopWidth: 1, borderColor: "rgba(20,28,40,0.07)" } : undefined}>
          <Press accessibilityLabel={`Image ${i + 1}, ${types[i]}`} accessibilityHint="Changes this image's type" expanded={open === i} onPress={() => setOpen(o => (o === i ? undefined : i))}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
            <Image source={attachmentSource(p)} contentFit="cover" style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: "rgba(120,120,128,0.12)" }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.body, lineHeight: 22, fontWeight: "600", color: types[i] === NOT_ATTACHED ? palette.amber : palette.ink }}>{types[i]}</Text>
              <Text style={{ ...type.footnote, color: palette.muted }}>{types[i] === NOT_ATTACHED ? "Not attached" : `Image ${i + 1}`}</Text>
            </View>
            <Animated.View style={{ transform: [{ rotate: open === i ? "180deg" : "0deg" }], transitionProperty: "transform", transitionDuration: reducedMotion ? 0 : 240 }}>
              <Icon name="chevron.down" size={13} color={palette.muted} />
            </Animated.View>
          </Press>
          {open === i && <Expand style={{ paddingBottom: 14 }}><TypeChips value={types[i]} onChange={t => setOne(i, t)} /></Expand>}
        </Animated.View>)}
      </View>}
      {photos.length === 1 && <Image source={attachmentSource(photos[0]!)} contentFit="contain" style={{ height: 320, borderRadius: radius.group, backgroundColor: "#0C0F14" }} />}
      {kept.length < photos.length && <Text style={{ ...type.footnote, color: palette.amber }}>{CT_NOTE}</Text>}
    </ScrollView>

    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: bottom, backgroundColor: palette.surface, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
      <View style={{ flex: 1 }}><Action secondary label="Back" accessibilityLabel="Back to attachment options" onPress={onBack} /></View>
      <View style={{ flex: 2 }}><Action disabled={!kept.length} onPress={() => onAttach(kept)} label={!kept.length ? "Not attached" : photos.length === 1 ? `Attach as ${kept[0]!.imageType}` : `Attach ${kept.length} image${kept.length === 1 ? "" : "s"}`} /></View>
    </View>
  </View>;
}
