import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { FadeOut, useAnimatedStyle, useSharedValue, withSpring, withTiming, ZoomIn } from "react-native-reanimated";
import { BrandIcon } from "./brand-icon";
import { EASE_OUT } from "./motion";
import { palette } from "./theme";
import { Icon } from "./ui";
import type { Attachment } from "./attachments-menu";

const TEACHING = require("@/features/imaging/assets/normal-pa-chest.jpg");
export const attachmentSource = (item: Attachment) => item.uri === "teaching" ? TEACHING : { uri: item.uri };

/** A photo or file thumbnail; files show a document glyph instead of pixels. */
function Thumb({ item, size, radius }: { item: Attachment; size: number; radius: number }) {
  return item.kind === "image"
    ? <Image source={attachmentSource(item)} contentFit="cover" style={{ width: size, height: size, borderRadius: radius, backgroundColor: "rgba(120,120,128,0.12)" }} />
    : <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: "#EEF2F8", alignItems: "center", justifyContent: "center", gap: 4, padding: 6 }}>
      <BrandIcon name="files" size={size * 0.3} color={palette.muted} />
    </View>;
}

/**
 * Selected attachments as a scrollable row of thumbnails, each with a remove button (the attachments
 * menu and the chat composer both show it).
 */
export function AttachmentStrip({ items, onRemove, size = 96 }: { items: Attachment[]; onRemove: (item: Attachment) => void; size?: number }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
    {items.map(item => <Animated.View key={item.uri} entering={ZoomIn.springify().duration(320).dampingRatio(0.8)} exiting={FadeOut.duration(140)}
      style={{ borderRadius: 16, borderCurve: "continuous", overflow: "hidden", boxShadow: "0 0 0 0.5px rgba(20,28,40,0.1), 0 4px 12px rgba(24,32,48,0.08)" }}>
      <Thumb item={item} size={size} radius={16} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} hitSlop={8} onPress={() => onRemove(item)}
        style={({ pressed }) => ({ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.92)", boxShadow: "0 1px 4px rgba(24,32,48,0.18)", transform: [{ scale: pressed ? 0.9 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
        <Icon name="xmark" size={10} color={palette.ink} />
      </Pressable>
    </Animated.View>)}
  </ScrollView>;
}

// After Airbnb's photo pop and slide: the front card springs up, tilts and grows (0.28 s, damping
// 0.68), then tucks behind the deck while the next card comes forward (0.38 s, damping 0.74).
const POP = { duration: 280, dampingRatio: 0.68 };
const SETTLE = { duration: 380, dampingRatio: 0.74 };
const CARD = 52;
/** Resting pose for a card at depth `rel` (0 = front). */
function pose(rel: number) {
  "worklet";
  if (rel === 0) return { x: 0, y: 0, r: 0, s: 1 };
  if (rel === 1) return { x: -12, y: 2, r: -7, s: 0.9 };
  if (rel === 2) return { x: 12, y: 2, r: 7, s: 0.9 };
  return { x: 0, y: 4, r: 0, s: 0.82 };
}

function StackCard({ item, rel, popping, depth, reduced }: { item: Attachment; rel: number; popping: boolean; depth: number; reduced: boolean }) {
  const x = useSharedValue(0), y = useSharedValue(10), r = useSharedValue(0), s = useSharedValue(0.6), o = useSharedValue(0);
  useEffect(() => {
    const target = popping ? { x: -6, y: -34, r: -11, s: 1.06 } : pose(rel);
    const spring = popping ? POP : SETTLE;
    const go = (v: typeof x, to: number) => v.set(reduced ? to : withSpring(to, spring));
    go(x, target.x); go(y, target.y); go(r, target.r); go(s, target.s);
    o.set(withTiming(1, { duration: 160, easing: EASE_OUT }));
  }, [rel, popping, reduced, x, y, r, s, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${r.value}deg` }, { scale: s.value }] }));
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", zIndex: popping ? 100 : depth, borderRadius: 12, borderCurve: "continuous", borderWidth: 2.5, borderColor: palette.white, backgroundColor: palette.white, boxShadow: "0 6px 14px rgba(24,32,48,0.16)" }, style]}>
    <Thumb item={item} size={CARD - 5} radius={10} />
  </Animated.View>;
}

/**
 * Attachments waiting to be sent, as a small deck above the mic. Tapping shuffles it: the front card
 * pops up and tucks behind the rest.
 */
export function AttachmentStack({ items, reduced, onPress }: { items: Attachment[]; reduced: boolean; onPress?: () => void }) {
  const [top, setTop] = useState(0);
  const [popping, setPopping] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setTop(0); }, [items.length]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Tapping pops the front card (the deck's acknowledgement), then opens the attachments menu.
  const shuffle = () => {
    if (popping !== null) return;
    if (items.length < 2) { onPress?.(); return; }
    if (process.env.EXPO_OS === "ios") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPopping(top);
    timer.current = setTimeout(() => { setTop(t => (t + 1) % items.length); setPopping(null); onPress?.(); }, reduced ? 0 : 150);
  };
  const shown = items.slice(0, 4);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${items.length} ${items.length === 1 ? "attachment" : "attachments"} ready to send`} accessibilityHint="Opens the attachments menu" onPress={shuffle}
    hitSlop={10} style={{ width: CARD + 30, height: CARD + 12, alignItems: "center", justifyContent: "center" }}>
    {shown.map((item, i) => {
      const rel = (i - (top % shown.length) + shown.length) % shown.length;
      return <StackCard key={item.uri} item={item} rel={rel} popping={popping !== null && i === popping % shown.length} depth={10 - rel} reduced={reduced} />;
    })}
    {items.length > 1 && <View pointerEvents="none" style={{ position: "absolute", right: 2, top: -4, zIndex: 200, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: palette.ink }}>
      <Animated.Text key={items.length} entering={ZoomIn.duration(200)} style={{ fontSize: 11, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{items.length}</Animated.Text>
    </View>}
  </Pressable>;
}
