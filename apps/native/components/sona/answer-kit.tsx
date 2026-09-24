import * as Haptics from "expo-haptics";
import { createContext, use, useEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { MarkedText } from "./marked-text";
import { LAYOUT, riseIn } from "./motion";
import { Section } from "./sections";
import { Text } from "./text";
import { palette, type } from "./theme";
import { Expand, Icon, Surface, pillStyle, useAccessibleEffects } from "./ui";

/**
 * Answer structure (digest first, detail on demand, section tabs when long):
 * - `Takeaways`: the three things that matter, colour-coded, at the top of an answer.
 * - `Fold`: a section collapsed to one preview line that opens in place.
 * - `Anchor`: a section that stays open but still appears in the tabs.
 * Sections register with the nearest `AnswerSections`, which the session screen turns into a
 * pinned tab bar for the latest answer.
 */
type Registered = { id: string; title: string; ref: RefObject<View | null>; open?: () => void };
type Registry = { register: (section: Registered) => () => void };
const SectionsContext = createContext<Registry | null>(null);

export function AnswerSections({ children, onChange }: { children: ReactNode; onChange: (sections: Registered[]) => void }) {
  const list = useRef<Registered[]>([]);
  const [registry] = useState<Registry>(() => ({
    register: section => {
      list.current = [...list.current.filter(s => s.id !== section.id), section];
      onChange(list.current);
      return () => { list.current = list.current.filter(s => s.id !== section.id); onChange(list.current); };
    },
  }));
  return <SectionsContext value={registry}>{children}</SectionsContext>;
}
export type AnswerSection = Registered;

function useRegister(id: string, title: string, open?: () => void) {
  const registry = use(SectionsContext);
  const ref = useRef<View>(null);
  const openRef = useRef(open); openRef.current = open;
  useEffect(() => registry?.register({ id, title, ref, open: () => openRef.current?.() }), [registry, id, title]);
  return ref;
}

export type Takeaway = { tone: "caution" | "good" | "info"; text: string };
const TONES = {
  caution: { glyph: "!", color: "#8B5518", wash: "rgba(196,120,20,0.15)" },
  good: { glyph: "+", color: "#0F6E66", wash: "rgba(20,140,130,0.13)" },
  info: { glyph: "i", color: palette.blue, wash: "rgba(36,91,204,0.11)" },
} as const;

/** The answer's digest: at most three lines, each with a toned marker, key terms tinted. */
export function Takeaways({ items }: { items: Takeaway[] }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Surface feature style={{ padding: 16, gap: 12 }}>
    {items.slice(0, 3).map((item, i) => <Animated.View key={item.text} entering={reducedMotion ? undefined : riseIn({ delay: 80 + i * 70, distance: 6, duration: 300 })} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, marginTop: 1, alignItems: "center", justifyContent: "center", backgroundColor: TONES[item.tone].wash }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: TONES[item.tone].color }}>{TONES[item.tone].glyph}</Text>
      </View>
      <MarkedText text={item.text} style={{ flex: 1, ...type.callout, color: palette.ink }} />
    </Animated.View>)}
  </Surface>;
}

/** A section collapsed to its title and a one-line preview; tapping opens it in place. */
export function Fold({ id, title, preview, defaultOpen = false, children }: { id: string; title: string; preview: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRegister(id, title, () => setOpen(true));
  const { reducedMotion } = useAccessibleEffects();
  const toggle = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); setOpen(value => !value); };
  return <Surface layout={reducedMotion ? undefined : LAYOUT}>
    <View ref={ref} collapsable={false}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}. ${preview}`} onPress={toggle}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>{title}</Text>
          {!open && <Animated.Text entering={FadeIn.duration(160)} exiting={FadeOut.duration(100)} numberOfLines={1} style={{ ...type.footnote, color: palette.muted }}>{preview}</Animated.Text>}
        </View>
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }], transitionProperty: "transform", transitionDuration: 240 } as never}><Icon name="chevron.right" size={13} color={palette.muted} /></View>
      </Pressable>
    </View>
    {open && <Expand style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 14 }}>{children}</Expand>}
  </Surface>;
}

/** An always-open section that still gets a tab; with an icon it draws a section header (and sources pill). */
export function Anchor({ id, title, icon, tone, children }: { id: string; title: string; icon?: string; tone?: ComponentProps<typeof Section>["tone"]; children: ReactNode }) {
  const ref = useRegister(id, title);
  return <View ref={ref} collapsable={false}>{icon ? <Section icon={icon} tone={tone} title={title}>{children}</Section> : children}</View>;
}

/**
 * Pinned section tabs for the latest answer (after Queue's sticky tabs): a glass track whose ink
 * thumb springs to the active section (0.38 s, no bounce). Tapping glides the page there and opens
 * the section if it is folded.
 */
export function SectionTabs({ sections, active, onPick }: { sections: AnswerSection[]; active: number; onPick: (index: number) => void }) {
  const { width } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const tabW = Math.min(110, (width - 40 - 8) / sections.length);
  const x = useSharedValue(active * tabW);
  useEffect(() => { x.set(reducedMotion ? active * tabW : withSpring(active * tabW, { duration: 380, dampingRatio: 1 })); }, [active, tabW, reducedMotion, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <Animated.View entering={reducedMotion ? FadeIn.duration(120) : riseIn({ distance: -6, duration: 280 })} exiting={FadeOut.duration(140)}
    style={{ alignSelf: "center", ...pillStyle, experimental_backgroundImage: undefined, backgroundColor: "rgba(247,249,252,0.94)", borderRadius: 18, padding: 4 }}>
    <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false}>
      <View accessibilityRole="tablist" style={{ flexDirection: "row" }}>
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, bottom: 0, width: tabW, borderRadius: 14, backgroundColor: palette.ink }, thumb]} />
        {sections.map((section, i) => <Pressable key={section.id} accessibilityRole="tab" accessibilityState={{ selected: i === active }} onPress={() => onPick(i)} style={{ width: tabW, height: 32, alignItems: "center", justifyContent: "center" }}>
          <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: "600", color: i === active ? palette.white : palette.muted, transitionProperty: "color", transitionDuration: 180 } as never}>{section.title}</Text>
        </Pressable>)}
      </View>
    </ScrollView>
  </Animated.View>;
}

/**
 * An answer split into swipeable pages (after Monogram's rich response card swipe): segmented
 * progress on top, pages snap one at a time, and the pages beside the current one sit back
 * slightly (0.96, dimmed). Page heights follow their content.
 */
export function AnswerDeck({ pages }: { pages: { title: string; content: ReactNode }[] }) {
  const { width } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const [index, setIndex] = useState(0);
  const pageW = width - 40 - 28, gap = 12;
  const settle = (x: number) => { const next = Math.round(x / (pageW + gap)); if (next !== index) { setIndex(next); if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); } };
  return <View style={{ gap: 12 }}>
    <View accessibilityRole="adjustable" accessibilityLabel={`Page ${index + 1} of ${pages.length}, ${pages[index]?.title}`} style={{ flexDirection: "row", gap: 4 }}>
      {pages.map((page, i) => <View key={page.title} style={{ flex: 1, gap: 6 }}>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: "rgba(20,28,40,0.1)", overflow: "hidden" }}>
          <View style={{ height: 3, backgroundColor: palette.ink, transformOrigin: "left", transform: [{ scaleX: i <= index ? 1 : 0 }], transitionProperty: "transform", transitionDuration: reducedMotion ? 0 : 320 } as never} />
        </View>
        <Text numberOfLines={1} style={{ ...type.caption, fontWeight: i === index ? "600" : "500", color: i === index ? palette.ink : palette.muted }}>{page.title}</Text>
      </View>)}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={pageW + gap} snapToAlignment="start"
      onMomentumScrollEnd={e => settle(e.nativeEvent.contentOffset.x)} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap, alignItems: "flex-start" }}>
      {pages.map((page, i) => <View key={page.title} style={{ width: pageW, opacity: i === index ? 1 : 0.55, transform: [{ scale: i === index || reducedMotion ? 1 : 0.96 }], transitionProperty: ["opacity", "transform"], transitionDuration: 300 } as never}>
        {page.content}
      </View>)}
    </ScrollView>
  </View>;
}
