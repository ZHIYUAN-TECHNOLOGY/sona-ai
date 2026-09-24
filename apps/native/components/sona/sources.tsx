import * as Haptics from "expo-haptics";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import { Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import { riseIn } from "./motion";
import { Text } from "./text";
import { palette, type } from "./theme";
import { Icon, glass, useAccessibleEffects } from "./ui";

/**
 * Sources gathered per section. Any `SourceLink` or `IconRow` source inside a `SourceScope`
 * registers here instead of drawing its own link, and the section shows one quiet pill
 * ("3 sources", stacked badges, after Slack's summarize pill) that opens a native sheet listing
 * them, with a filter once there are many. Ten or twenty sources cost the page one pill.
 */
export type SourceEntry = { label: string; onPress: () => void };
type Scope = { add: (entry: SourceEntry) => () => void };
const ScopeContext = createContext<Scope | null>(null);

export function useSourceScope() { return use(ScopeContext); }

/** Registers a source with the enclosing scope; returns true when it was captured. */
export function useCapturedSource(entry: SourceEntry | undefined) {
  const scope = use(ScopeContext);
  const latest = useRef(entry); latest.current = entry;
  const label = entry?.label;
  useEffect(() => {
    if (!scope || !label) return;
    return scope.add({ label, onPress: () => latest.current?.onPress() });
  }, [scope, label]);
  return Boolean(scope && entry);
}

/** Provides a source scope; the child function receives the collected sources (to place a pill). */
export function SourceScope({ children }: { children: (sources: SourceEntry[]) => ReactNode }) {
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const add = useCallback((entry: SourceEntry) => {
    setSources(list => list.some(s => s.label === entry.label) ? list : [...list, entry]);
    return () => setSources(list => list.filter(s => s.label !== entry.label));
  }, []);
  const scope = useMemo(() => ({ add }), [add]);
  return <ScopeContext value={scope}>{children(sources)}</ScopeContext>;
}

// The sheet is a route (a fit-to-content form sheet), so the tapped section's sources are handed over here.
// ponytail: one module slot holds the open sheet's sources; fine while only one sheet shows at a time.
let open: SourceEntry[] = [];

/** Stacked badges plus a count; tapping opens the sources sheet. Nothing renders without sources. */
export function SourcesPill({ sources }: { sources: SourceEntry[] }) {
  const { reducedMotion } = useAccessibleEffects();
  if (!sources.length) return null;
  const show = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); open = sources; router.push("/sources"); };
  return <Pressable accessibilityRole="button" accessibilityLabel={`${sources.length} ${sources.length === 1 ? "source" : "sources"}`} accessibilityHint="Lists the sources for this section" onPress={show} hitSlop={8}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 4, paddingRight: 10, borderRadius: 14, borderWidth: 1, borderColor: glass.hairline, backgroundColor: "rgba(255,255,255,0.7)", transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
    <View style={{ flexDirection: "row" }}>
      {sources.slice(0, 3).map((source, i) => <Animated.View key={source.label} entering={reducedMotion ? undefined : riseIn({ delay: i * 40, distance: 0, scale: 0.6, duration: 260 })}
        style={{ width: 20, height: 20, borderRadius: 10, marginLeft: i ? -7 : 0, borderWidth: 1.5, borderColor: palette.white, backgroundColor: ["#E6EEFC", "#E8F4F2", "#F1ECFB"][i], alignItems: "center", justifyContent: "center", zIndex: 3 - i }}>
        <Icon name="doc.text" size={10} color={palette.blue} />
      </Animated.View>)}
    </View>
    <Animated.Text key={sources.length} entering={reducedMotion ? undefined : ZoomIn.duration(200)} style={{ ...type.caption, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>
      {sources.length} {sources.length === 1 ? "source" : "sources"}
    </Animated.Text>
  </Pressable>;
}

/** The sources sheet (route `/sources`): sized to its list, with a filter once there are more than six. */
export function SourcesSheet() {
  const [sources] = useState(open);
  const [query, setQuery] = useState("");
  const { height } = useWindowDimensions();
  const shown = sources.filter(s => s.label.toLowerCase().includes(query.trim().toLowerCase()));
  // Dismiss first so the source detail presents over the page, not over this sheet.
  const pick = (source: SourceEntry) => { router.back(); setTimeout(source.onPress, 350); };
  return <View style={{ paddingTop: 22, paddingBottom: 34, gap: 10 }}>
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20 }}>
      <Text accessibilityRole="header" style={{ flex: 1, ...type.heading, color: palette.ink }}>Sources <Text style={{ color: palette.muted, fontWeight: "500" }}>{sources.length}</Text></Text>
    </View>
    {sources.length > 6 && <View style={{ paddingHorizontal: 20 }}>
      <TextInput value={query} onChangeText={setQuery} placeholder="Filter sources" placeholderTextColor="#8A929E" accessibilityLabel="Filter sources" clearButtonMode="while-editing"
        style={{ height: 40, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: palette.ink, backgroundColor: "rgba(20,28,40,0.05)" }} />
    </View>}
    <ScrollView style={{ maxHeight: height * 0.6, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled">
      <View style={{ borderRadius: 18, borderCurve: "continuous", backgroundColor: palette.white, overflow: "hidden" }}>
        {shown.map((source, i) => <Pressable key={source.label} accessibilityRole="link" accessibilityLabel={source.label} onPress={() => pick(source)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: i ? 1 : 0, borderColor: glass.hairline, backgroundColor: pressed ? "rgba(20,28,40,0.04)" : "transparent" })}>
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#E6EEFC", alignItems: "center", justifyContent: "center" }}><Icon name="doc.text" size={13} color={palette.blue} /></View>
          <Text style={{ flex: 1, ...type.subhead, color: palette.ink }}>{source.label}</Text>
          <Icon name="chevron.right" size={12} color={palette.muted} />
        </Pressable>)}
        {!shown.length && <Text style={{ padding: 16, ...type.footnote, color: palette.muted }}>{sources.length ? `No source matches “${query}”.` : "No sources."}</Text>}
      </View>
    </ScrollView>
  </View>;
}
