import { Text } from "@/components/sona/text";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { ListRow } from "@/components/sona/list";
import { Chip, Icon, Insight, Tone, canvasImage, useAccessibleEffects } from "@/components/sona/ui";
import { palette, type } from "@/components/sona/theme";
import { GROUPS, letters, listItems, syntheticCensus, type Group, type Item, type Row, type View as Tab } from "@/features/patients/census";
import { useContinue, useContinueState } from "@/features/patients/continue-store";
import { ASK_SPACE, AskBar } from "@/features/ask";
import { needsYou } from "@/features/ask/answers";
import { defaultMedications } from "./clinical-state";
import { flagsFor, PatientSheet, type Go } from "./patient-sheet";
import { useDayPatients } from "./quick-actions";
import { useEncounter } from "./store";
import { openSession } from "./navigation";

const TABS: { id: Tab; label: string }[] = [
  { id: "needs", label: "Needs you" }, { id: "continue", label: "Continue" }, { id: "mine", label: "My list" }, { id: "ward", label: "Ward 4B" }, { id: "clinic", label: "Clinic today" }, { id: "all", label: "All" },
];
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/**
 * Patients at any census (docs/design-direction.md, "At scale"): nothing lists everyone by default.
 * It opens on "Needs you" in urgency groups (Waiting and Done start folded), with tabs and counts for
 * Continue (where you left off), My list, the ward, today's clinic and All (A–Z with an index). One
 * virtualised list (Legend List), so a thousand rows stay smooth. Search spans everyone.
 */
export function PatientScreen() {
  const { patients, patient, encounter, encounters, updateEncounter } = useEncounter();
  const { next, view, prompt, switch: switching, tab: startTab } = useLocalSearchParams<{ next?: string; view?: string; prompt?: string; switch?: string; tab?: string }>();
  const [open, setOpen] = useState<string>();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>(TABS.some(t => t.id === startTab) ? startTab as Tab : "needs");
  const [opened, setOpened] = useState<ReadonlySet<Group>>(new Set());
  const list = useRef<LegendListRef>(null);
  const { census } = useContinueState();
  const { entries, toSign } = useContinue();
  const select = (id: string, go: Go = {}) => {
    // Choosing a patient opens their session (switching from a session replaces it); a pending
    // question or tool page is carried along and runs once the visit is open.
    const proceed = () => { router.back(); setTimeout(() => go.to ? router.push(go.to) : openSession(id, { next: go.next ?? next, prompt: go.next ? undefined : prompt, view: go.view ?? view }, switching === "1"), 250); };
    if (id !== patient?.id && (encounter?.recording === "recording" || encounter?.recording === "paused")) {
      Alert.alert("Stop this consultation?", "Stop the current playback before switching patients. Your transcript and note will be kept.", [{ text: "Keep this patient", style: "cancel" }, { text: "Stop & switch", onPress: () => { updateEncounter(current => ({ ...current, recording: "stopped" })); proceed(); } }]);
    } else proceed();
  };

  // Today's visits as rows: what needs attention leads, then who starts within the hour; the synthetic census joins when switched on in Settings.
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  // Today's visits come from the same schedule as Today (the server's appointments in live mode), so the two pages agree.
  const day = useDayPatients(patients);
  const real: Row[] = patients.map(p => {
    const visit = day.find(d => d.id === p.id);
    const flags = flagsFor(p, (encounters[p.id]?.medicationEntries ?? defaultMedications(p)).filter(m => !m.confirmed).length);
    const answers = encounters[p.id]?.requests.length ?? 0;
    const soon = Boolean(visit) && !answers && minutes(visit!.time) - now >= 0 && minutes(visit!.time) - now <= 60;
    const [group, reason, tone]: [Group, string, Row["tone"]] = flags.length ? ["needs", flags[0]!.label, flags[0]!.tone === "urgent" ? "urgent" : "soon"]
      : soon ? ["next", `Starts in ${minutes(visit!.time) - now} min`, "good"] : answers ? ["waiting", `In progress · ${answers} ${answers === 1 ? "answer" : "answers"}`, "calm"] : ["waiting", p.subtitle, "calm"];
    return { id: p.id, name: p.name, initials: p.initials, where: visit?.time ?? "", group, reason, tone, mine: true, ward: false, clinic: Boolean(visit), open: true };
  });
  const synthetic = useMemo(() => (census ? syntheticCensus(106) : []), [census]);
  const rows = useMemo(() => [...real, ...synthetic], [real, synthetic]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (t: Tab) => t === "continue" ? entries.length : t === "needs" ? rows.filter(r => r.group === "needs").length : t === "all" ? rows.length : rows.filter(r => r[t]).length;
  const tabs = TABS.filter(t => t.id === "needs" || t.id === "all" || count(t.id) > 0);

  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return rows.filter(r => `${r.name} ${r.id} ${r.where}`.toLowerCase().includes(q)).map(row => ({ key: `r:${row.id}`, kind: "row" as const, row }));
    if (tab === "continue") return entries.map(e => ({ key: `r:${e.id}`, kind: "row" as const, row: { id: e.id, name: e.patient.name, initials: e.patient.initials, where: e.patient.time, group: "needs" as Group, reason: [e.why === "open" ? "In visit" : e.why === "pinned" ? "Pinned" : "", e.left].filter(Boolean).join(" · "), tone: e.left ? "soon" as const : "calm" as const, mine: true, ward: false, clinic: true, open: true } }));
    return listItems(rows, tab, opened);
  }, [rows, tab, opened, query, entries]);

  // Insight first: where the list stands, for the tab in view.
  const needs = count("needs");
  const upNext = [...day].sort((x, y) => x.time.localeCompare(y.time)).find(p => !encounters[p.id]?.requests.length);
  const insight: ReactNode[] = tab === "continue"
    ? [entries.length ? `${entries.length} unfinished` : "Nothing unfinished", toSign ? <Tone key="sign" of="soon">{toSign} {toSign === 1 ? "note" : "notes"} to sign</Tone> : null].filter(Boolean)
    : [rows.length === patients.length ? (day.length ? `${day.length} ${day.length === 1 ? "visit" : "visits"} today` : "No visits today") : `${rows.length} patients`, needs ? <Tone key="needs" of="urgent">{needs} {needs === 1 ? "needs" : "need"} you</Tone> : null, upNext ? <Fragment key="next">next <Tone of="next">{upNext.name.split(" ")[0]} at {upNext.time}</Tone></Fragment> : null].filter(Boolean);

  const renderItem = useCallback(({ item, index }: { item: Item; index: number }) => {
    if (item.kind === "header") return <Text accessibilityRole="header" style={{ ...type.footnote, fontWeight: "600", color: palette.muted, paddingTop: index ? 18 : 4, paddingBottom: 6, paddingHorizontal: 4 }}>{item.title} · {item.count}</Text>;
    const first = index === 0 || items[index - 1]!.kind === "header";
    const last = index === items.length - 1 || items[index + 1]!.kind === "header";
    const shape = { backgroundColor: palette.white, borderTopLeftRadius: first ? 20 : 0, borderTopRightRadius: first ? 20 : 0, borderBottomLeftRadius: last ? 20 : 0, borderBottomRightRadius: last ? 20 : 0, borderTopWidth: first ? 0 : 1, borderColor: "rgba(20,28,40,0.06)" };
    if (item.kind === "more") return <Pressable accessibilityRole="button" accessibilityLabel={`Show ${item.hidden} more in ${GROUPS.find(g => g.id === item.group)!.title}`} onPress={() => setOpened(o => new Set([...o, item.group]))}
      style={({ pressed }) => ({ ...shape, minHeight: 48, justifyContent: "center", paddingHorizontal: 16, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ ...type.subhead, fontWeight: "600", color: palette.blue }}>{GROUPS.find(g => g.id === item.group)!.shown ? `Show ${item.hidden} more` : `Show ${item.hidden}`}</Text>
    </Pressable>;
    const r = item.row;
    return <ListRow title={r.name} badge={r.id === patient?.id ? <Text style={{ fontWeight: "500", color: palette.blue }}>  · current</Text> : undefined} detail={r.reason} tone={r.tone} initials={r.initials} trailing={r.where.replace(/^(Clinic|Bed) /, "")}
      edges={{ first, last }} onPress={r.open ? () => setOpen(r.id) : undefined} accessibilityHint={r.open ? "Shows the patient summary and actions" : undefined}
      accessibilityLabel={`${r.name}, ${r.where}, ${r.reason}${r.open ? "" : ". Synthetic census row"}`} />;
  }, [items, patient?.id]);

  const chosen = patients.find(p => p.id === open);
  // Opened to pick a visit for something (a question, a tool, a switch) it says so; from the sidebar it is the Patients page.
  const picking = Boolean(next || view || prompt || switching);
  const header = <View style={{ gap: 14, paddingBottom: 14 }}>
    <Stack.Screen options={{ title: picking ? "Choose a patient" : "Patients" }} />
    <Insight>{insight.map((part, i) => [i ? " · " : "", part])}</Insight>
    <View style={{ borderRadius: 18, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}><Icon name="magnifyingglass" color={palette.muted} size={18} /><TextInput accessibilityLabel="Search patients" placeholder={`Search ${rows.length} patients by name, ID or bed`} value={query} onChangeText={setQuery} placeholderTextColor={palette.muted} clearButtonMode="while-editing" style={{ flex: 1, minHeight: 52, fontSize: 17, color: palette.ink }} /></View>
    {!query && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ marginHorizontal: -20 }} contentInset={{ left: 20, right: 20 }} contentOffset={{ x: -20, y: 0 }}>
      {/* The design system's pill: the picked tab is ink, like every picked option. */}
      {tabs.map(t => <Chip key={t.id} label={`${t.label} ${count(t.id)}`} selected={t.id === tab} accessibilityLabel={`${t.label}, ${count(t.id)}`} onPress={() => setTab(t.id)} />)}
    </ScrollView>}
    {!items.length && <Text style={{ ...type.callout, color: palette.muted, paddingHorizontal: 4 }}>{query ? "No one matches. Try a name, patient ID or bed." : tab === "continue" ? "Nothing unfinished. Visits you work on show here for 24 hours, and pinned patients stay." : "Nobody here right now."}</Text>}
  </View>;

  return <View style={{ flex: 1 }}>
    <LegendList ref={list} data={items} keyExtractor={i => i.key} getItemType={i => i.kind} renderItem={renderItem} recycleItems estimatedItemSize={64}
      ListHeaderComponent={header} style={{ flex: 1, backgroundColor: palette.canvas, experimental_backgroundImage: canvasImage }} contentContainerStyle={{ padding: 20, paddingBottom: 44 + ASK_SPACE }}
      contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" />
    {tab === "all" && !query && <AtoZ rows={rows} items={items} list={list} />}
    {!chosen && <AskBar scope="patients" onTab={t => { setQuery(""); setTab(t as Tab); }} answers={[needsYou(rows.filter(r => r.group === "needs").slice(0, 12).map(r => ({ id: r.id, title: r.name, detail: r.reason, tone: r.tone, ...(r.open ? { op: `open:${r.id}` } : {}) })))]} />}
    {chosen && <PatientSheet key={chosen.id} patient={chosen} onClose={() => setOpen(undefined)} onGo={go => select(chosen.id, go)} />}
  </View>;
}

/** The A–Z index on the right edge of "All": tapping a letter scrolls to its section. */
function AtoZ({ rows, items, list }: { rows: Row[]; items: Item[]; list: RefObject<LegendListRef | null> }) {
  const { reducedMotion } = useAccessibleEffects();
  const jump = (letter: string) => {
    const index = items.findIndex(i => i.kind === "header" && i.title === letter);
    // The sheet's transparent header covers the top ~64 pt, so the letter lands just below it.
    if (index >= 0) void list.current?.scrollToIndex({ index, animated: !reducedMotion, viewOffset: 64 });
  };
  return <View pointerEvents="box-none" style={{ position: "absolute", right: 2, top: 210, bottom: 60, justifyContent: "center" }}>
    <View accessibilityRole="tablist" accessibilityLabel="Jump to a letter" style={{ gap: 2 }}>
      {letters(rows).map(l => <Pressable key={l} accessibilityRole="button" accessibilityLabel={`Jump to ${l}`} hitSlop={{ left: 12, right: 6 }} onPress={() => jump(l)} style={{ paddingHorizontal: 4, paddingVertical: 1 }}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: palette.blue }}>{l}</Text>
      </Pressable>)}
    </View>
  </View>;
}
