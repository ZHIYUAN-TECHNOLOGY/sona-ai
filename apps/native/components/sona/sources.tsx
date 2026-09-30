import * as Haptics from "expo-haptics";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import { Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import Animated, { withSpring, withTiming } from "react-native-reanimated";
import { EASE_OUT, riseIn } from "./motion";
import { Text } from "./text";
import { palette, type, radius } from "./theme";
import { Icon, SourceLink, glass, useAccessibleEffects } from "./ui";

/**
 * Sources gathered per section. Any `SourceLink`, `SourceRef` or `IconRow` source inside a
 * `SourceScope` registers here instead of drawing its own link, and the section shows one quiet
 * pill ("3 sources", stacked badges) that opens a native sheet listing them, grouped by kind,
 * with a filter once there are many. Ten or twenty sources cost the page one pill.
 */
export type SourceKind = "record" | "reference" | "fixture";
/** `id` identifies the source (defaults to the label); `detail` tells same-label entries apart. */
export type SourceEntry = { id?: string; label: string; detail?: string; kind?: SourceKind; onPress: () => void };
type Registered = SourceEntry & { id: string };
type Scope = { add: (entry: Registered) => () => void };
const ScopeContext = createContext<Scope | null>(null);

export function useSourceScope() { return use(ScopeContext); }

/** Registers a source with the enclosing scope; returns true when it was captured. */
export function useCapturedSource(entry: SourceEntry | undefined) {
  const scope = use(ScopeContext);
  const latest = useRef(entry); latest.current = entry;
  const { label, detail, kind } = entry ?? {};
  const id = entry?.id ?? label;
  useEffect(() => {
    if (!scope || !id || !label) return;
    return scope.add({ id, label, detail, kind, onPress: () => latest.current?.onPress() });
  }, [scope, id, label, detail, kind]);
  return Boolean(scope && entry);
}

/** A source with an id, detail line or kind: captured inside a scope, a plain link outside one. */
export function SourceRef(entry: SourceEntry) {
  if (useCapturedSource(entry)) return null;
  return <SourceLink label={entry.label} onPress={entry.onPress} />;
}

/** Provides a source scope; the child function receives the collected sources (to place a pill). */
export function SourceScope({ children }: { children: (sources: SourceEntry[]) => ReactNode }) {
  // Every registration is kept (two links may cite one source, and either may unmount first); the list shows each id once.
  const [registered, setRegistered] = useState<Registered[]>([]);
  const add = useCallback((entry: Registered) => {
    setRegistered(list => [...list, entry]);
    return () => setRegistered(list => list.filter(s => s !== entry));
  }, []);
  const sources = useMemo(() => { const seen = new Set<string>(); return registered.filter(s => !seen.has(s.id) && seen.add(s.id)); }, [registered]);
  const scope = useMemo(() => ({ add }), [add]);
  return <ScopeContext value={scope}>{children(sources)}</ScopeContext>;
}

// The sheet is a route (a fit-to-content form sheet), so the tapped section's sources are handed over here.
// ponytail: one module slot holds the open sheet's sources; fine while only one sheet shows at a time.
let open: SourceEntry[] = [];

const KIND_ICON: Record<SourceKind, string> = { record: "doc.text", reference: "book.closed", fixture: "info.circle" };

// The count rolls through a clipped slot, up when it grows and down when it shrinks (a ticker, not a swap).
const DIGIT = 16;
const rollIn = (from: number) => () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ translateY: from }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ translateY: withSpring(0, { duration: 300, dampingRatio: 0.85 }) }] } };
};
const rollOut = (to: number) => () => {
  "worklet";
  return { initialValues: { opacity: 1, transform: [{ translateY: 0 }] }, animations: { opacity: withTiming(0, { duration: 120 }), transform: [{ translateY: withTiming(to, { duration: 200, easing: EASE_OUT }) }] } };
};

/** Stacked badges plus a count; tapping opens the sources sheet. Nothing renders without sources. */
export function SourcesPill({ sources }: { sources: SourceEntry[] }) {
  const { reducedMotion } = useAccessibleEffects();
  const count = sources.length;
  const previous = useRef(count);
  const direction = count > previous.current ? 1 : count < previous.current ? -1 : 0;
  useEffect(() => { previous.current = count; }, [count]);
  if (!count) return null;
  const roll = direction !== 0 && !reducedMotion;
  const show = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); open = sources; router.push("/sources"); };
  const noun = count === 1 ? "source" : "sources";
  return <Pressable accessibilityRole="button" accessibilityLabel={`${count} ${noun}`} accessibilityHint="Lists the sources for this section" onPress={show} hitSlop={8}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 4, paddingRight: 10, borderRadius: 14, borderWidth: 1, borderColor: glass.hairline, backgroundColor: "rgba(255,255,255,0.7)", transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
    <View style={{ flexDirection: "row" }}>
      {sources.slice(0, 3).map((source, i) => <Animated.View key={source.id ?? source.label} entering={reducedMotion ? undefined : riseIn({ delay: i * 40, distance: 0, scale: 0.6, duration: 260 })}
        style={{ width: 20, height: 20, borderRadius: 10, marginLeft: i ? -7 : 0, borderWidth: 1.5, borderColor: palette.white, backgroundColor: ["#E6EEFC", "#E8F4F2", "#F1ECFB"][i], alignItems: "center", justifyContent: "center", zIndex: 3 - i }}>
        <Icon name={KIND_ICON[source.kind ?? "record"]} size={10} color={palette.blue} />
      </Animated.View>)}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <View style={{ height: DIGIT, overflow: "hidden" }}>
        <Animated.Text key={count} entering={roll ? rollIn(direction * DIGIT) : undefined} exiting={roll ? rollOut(-direction * DIGIT) : undefined}
          style={{ ...type.caption, lineHeight: DIGIT, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{count}</Animated.Text>
      </View>
      <Text style={{ ...type.caption, lineHeight: DIGIT, fontWeight: "600", color: palette.muted }}>{noun}</Text>
    </View>
  </Pressable>;
}

const GROUPS: [SourceKind | undefined, string][] = [["record", "From the record"], ["reference", "Published references"], ["fixture", "Demo notes"], [undefined, "Other"]];

/**
 * The sources sheet (route `/sources`): sized to its list, rows grouped by kind under small
 * overlines once there is more than one kind, and a filter once there are more than six.
 * Rows rise in on a short, capped stagger so twenty sources settle as quickly as five.
 */
export function SourcesSheet() {
  const [sources] = useState(open);
  const [query, setQuery] = useState("");
  const { height } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const q = query.trim().toLowerCase();
  const shown = sources.filter(s => `${s.label} ${s.detail ?? ""}`.toLowerCase().includes(q));
  const groups = GROUPS.map(([kind, title]) => ({ title, rows: shown.filter(s => s.kind === kind) })).filter(g => g.rows.length);
  // Dismiss first so the source detail presents over the page, not over this sheet.
  const pick = (source: SourceEntry) => { router.back(); setTimeout(source.onPress, 350); };
  let order = 0;
  return <View style={{ paddingTop: 36, paddingBottom: 34, gap: 18 }}>
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20 }}>
      <Text accessibilityRole="header" style={{ flex: 1, ...type.heading, color: palette.ink }}>Sources <Text style={{ color: palette.muted, fontWeight: "500" }}>{sources.length}</Text></Text>
    </View>
    {sources.length > 6 && <View style={{ paddingHorizontal: 20 }}>
      <TextInput value={query} onChangeText={setQuery} placeholder="Filter sources" placeholderTextColor={palette.placeholder} accessibilityLabel="Filter sources" clearButtonMode="while-editing"
        style={{ height: 40, borderRadius: 12, paddingHorizontal: 12, ...type.body, color: palette.ink, backgroundColor: "rgba(20,28,40,0.05)" }} />
    </View>}
    <ScrollView style={{ maxHeight: height * 0.6, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      {groups.map(group => <View key={group.title} style={{ gap: 6 }}>
        {groups.length > 1 && <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted, paddingHorizontal: 4 }}>{group.title}</Text>}
        <View style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, overflow: "hidden" }}>
          {group.rows.map((source, i) => <Animated.View key={source.id ?? source.label} entering={reducedMotion ? undefined : riseIn({ delay: Math.min(order++, 8) * 30, distance: 8, duration: 280 })}>
            <Pressable accessibilityRole="link" accessibilityLabel={source.detail ? `${source.label}, ${source.detail}` : source.label} onPress={() => pick(source)}
              style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: glass.hairline, backgroundColor: pressed ? "rgba(20,28,40,0.04)" : "transparent" })}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#E6EEFC", alignItems: "center", justifyContent: "center" }}><Icon name={KIND_ICON[source.kind ?? "record"]} size={13} color={palette.blue} /></View>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ ...type.subhead, color: palette.ink }}>{source.label}</Text>
                {source.detail && <Text style={{ ...type.caption, color: palette.muted }}>{source.detail}</Text>}
              </View>
              <Icon name="chevron.right" size={12} color={palette.muted} />
            </Pressable>
          </Animated.View>)}
        </View>
      </View>)}
      {!shown.length && <View style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white }}>
        <Text style={{ padding: 16, ...type.footnote, color: palette.muted }}>{sources.length ? `No source matches “${query}”.` : "No sources."}</Text>
      </View>}
    </ScrollView>
  </View>;
}
