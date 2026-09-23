import { Text } from "@/components/sona/text";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import Animated, { interpolate, interpolateColor, type SharedValue, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { palette } from "./theme";
import { Icon, surfaceStyle } from "./ui";

export type TimelineItem = { id: string; label: string; icon: string; glyph: string; title: string; meta: string; body: string };

const GAP = 12;
function tick() { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); }

function TrackLabel({ item, index, progress, x, onPress }: { item: TimelineItem; index: number; progress: SharedValue<number>; x: number; onPress: () => void }) {
  const style = useAnimatedStyle(() => ({ color: interpolateColor(Math.min(1, Math.abs(progress.value - index)), [0, 1], [palette.ink, "#9AA0A8"]) }));
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.label}: ${item.title}`} onPress={onPress} hitSlop={10} style={{ position: "absolute", left: x - 45, width: 90, alignItems: "center" }}>
    <Animated.Text numberOfLines={1} style={[{ fontSize: 12, fontWeight: "600" }, style]}>{item.label}</Animated.Text>
  </Pressable>;
}

function Node({ item, index, progress, x }: { item: TimelineItem; index: number; progress: SharedValue<number>; x: number }) {
  const style = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(progress.value - index), [0, 0.6], [0, 1], "clamp") }));
  return <Animated.View style={[{ position: "absolute", left: x - 12, top: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: palette.canvas, alignItems: "center", justifyContent: "center" }, style]}>
    <Icon name={item.icon} size={12} color="#9AA0A8" />
  </Animated.View>;
}

function Card({ item, index, progress, width }: { item: TimelineItem; index: number; progress: SharedValue<number>; width: number }) {
  const style = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(progress.value - index));
    return { opacity: 1 - d * 0.45, transform: [{ scale: 1 - d * 0.06 }] };
  });
  return <Animated.View accessible accessibilityLabel={`${item.label}. ${item.title}. ${item.meta}. ${item.body}`} style={[{ width, minHeight: 208, padding: 18, gap: 10, ...surfaceStyle }, style]}>
    <Text style={{ fontSize: 40 }}>{item.glyph}</Text>
    <View style={{ flex: 1 }} />
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 17, fontWeight: "600", letterSpacing: -0.3, color: palette.ink }}>{item.title}</Text>
      <Text style={{ fontSize: 13, color: palette.muted }}>{item.meta}</Text>
    </View>
    <Text selectable style={{ fontSize: 14, lineHeight: 20, color: "#4A515B" }}>{item.body}</Text>
  </Animated.View>;
}

/**
 * Paged cards with a synced timeline: the indicator glides with the scroll offset
 * (UI thread, no React renders) and settles on the milestone of the snapped card.
 */
export function TimelineCarousel({ items }: { items: TimelineItem[] }) {
  const { width: screen } = useWindowDimensions();
  const cardWidth = Math.min(268, screen - 110);
  const step = cardWidth + GAP;
  const side = (screen - cardWidth) / 2;
  const progress = useSharedValue(0);
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const [track, setTrack] = useState(0);
  const onScroll = useAnimatedScrollHandler(event => { progress.set(event.contentOffset.x / step); });
  useAnimatedReaction(() => Math.round(progress.value), (now, before) => { if (before !== null && now !== before) scheduleOnRN(tick); });
  const inset = 22, span = Math.max(0, track - inset * 2), gapX = items.length > 1 ? span / (items.length - 1) : 0;
  const positions = items.map((_, i) => inset + (items.length > 1 ? gapX * i : span / 2));
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: inset + (items.length > 1 ? Math.min(Math.max(progress.value, 0), items.length - 1) * gapX : span / 2) - 13 }] }));
  const fill = useAnimatedStyle(() => ({ width: items.length > 1 ? Math.min(Math.max(progress.value, 0), items.length - 1) * gapX : 0 }));
  const jump = (i: number) => scroller.current?.scrollTo({ x: i * step, animated: true });

  return <View style={{ gap: 16 }}>
    <View onLayout={event => setTrack(event.nativeEvent.layout.width)} style={{ gap: 10 }}>
      <View style={{ height: 18 }}>{track > 0 && items.map((item, i) => <TrackLabel key={item.id} item={item} index={i} progress={progress} x={positions[i]!} onPress={() => jump(i)} />)}</View>
      <View style={{ height: 24 }}>
        {track > 0 && <>
          <View style={{ position: "absolute", left: inset, right: inset, top: 11, height: 2, borderRadius: 1, backgroundColor: "#E1E4E9" }} />
          <Animated.View style={[{ position: "absolute", left: inset, top: 11, height: 2, borderRadius: 1, backgroundColor: palette.ink }, fill]} />
          {items.map((item, i) => <Node key={item.id} item={item} index={i} progress={progress} x={positions[i]!} />)}
          <Animated.View pointerEvents="none" style={[{ position: "absolute", top: -1, left: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: palette.white, borderWidth: 1.5, borderColor: palette.ink, boxShadow: "0 2px 6px rgba(24,32,48,0.14)", alignItems: "center", justifyContent: "center" }, indicator]}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.ink }} /></Animated.View>
        </>}
      </View>
    </View>
    <Animated.ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={step} disableIntervalMomentum onScroll={onScroll} scrollEventThrottle={16}
      style={{ marginHorizontal: -20, marginVertical: -14 }} contentContainerStyle={{ paddingHorizontal: side, paddingVertical: 24, gap: GAP }}>
      {items.map((item, i) => <Card key={item.id} item={item} index={i} progress={progress} width={cardWidth} />)}
    </Animated.ScrollView>
  </View>;
}
