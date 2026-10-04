import { Text } from "@/components/sona/text";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { ListRow } from "@/components/sona/list";
import { Chip, Icon, Insight, Tone, canvasImage, useAccessibleEffects } from "@/components/sona/ui";
import { Press } from "@/components/sona/parts";
import { palette, type, radius } from "@/components/sona/theme";
import { mostUrgent } from "@/components/sona/tone";
import { GROUPS, letters, listItems, rosterRows, syntheticCensus, type Group, type Item, type Row, type View as Tab } from "@/features/patients/census";
import { useContinue, useContinueState } from "@/features/patients/continue-store";
import { useServerCensus } from "@/features/patients/server-census";
import { needsYou } from "@/features/ask/answers";
import { JUDGE } from "@/features/live";
import { needLine, patientFlags, unconfirmedOf } from "@/features/day/counts";
import { useDayPatients, usePendingResult } from "@/features/day/use-counts";
import { PatientSheet, type Go } from "./patient-sheet";
import { useEncounter } from "./store";
import { openSession } from "./navigation";

const TABS: { id: Tab; label: string }[] = [
  { id: "needs", label: "Needs you" }, { id: "continue", label: "Continue" }, { id: "mine", label: "My list" }, { id: "ward", label: "Ward 4B" }, { id: "clinic", label: "Clinic today" }, { id: "all", label: "All" },
];
// The tab and search outlive the screen, so opening a visit and coming back finds Patients as it was left.
// ponytail: one module-level slot for the session; a per-user store if Patients ever opens twice at once.
const kept: { tab?: Tab; query: string } = { query: "" };
// Judge build: the server's list leaves nobody out, since every row comes from it (rosterRows).
const NOBODY: { id: string }[] = [];
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
  const [query, keepQuery] = useState(kept.query);
  const [tab, keepTab] = useState<Tab>(TABS.some(t => t.id === startTab) ? startTab as Tab : kept.tab ?? "needs");
  const setQuery = (q: string) => { kept.query = q; keepQuery(q); };
  const setTab = (t: Tab) => { kept.tab = t; keepTab(t); };
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
  const result = usePendingResult(); // the result Today flags, so an acknowledged one stops showing here too
  const real: Row[] = patients.flatMap(p => {
    const visit = day.find(d => d.id === p.id);
    const flags = patientFlags(p, unconfirmedOf(p, encounters[p.id]), result, encounters[p.id]);
    const answers = encounters[p.id]?.requests.length ?? 0;
    // Judge build: the roster is the whole hospital record, so only who needs you, is booked today or is being seen is
    // ranked from their visit; the rest keep the ward's row (rosterRows).
    if (JUDGE && !flags.length && !visit && !answers) return [];
    const soon = Boolean(visit) && !answers && minutes(visit!.time) - now >= 0 && minutes(visit!.time) - now <= 60;
    const [group, reason, tone]: [Group, string, Row["tone"]] = flags.length ? ["needs", flags[0]!.label, flags[0]!.tone === "urgent" ? "urgent" : "soon"]
      : soon ? ["next", `Starts in ${minutes(visit!.time) - now} min`, "good"] : answers ? ["waiting", `In progress · ${answers} ${answers === 1 ? "answer" : "answers"}`, "calm"] : ["waiting", p.subtitle, "calm"];
    return [{ id: p.id, name: p.name, initials: p.initials, where: visit?.time ?? "", group, reason, tone, mine: true, ward: false, clinic: Boolean(visit), open: true }];
  });
  // Connected: everyone else on the list is the hospital record's (the ward's patients, read from the server), never the synthetic census.
  const others = useServerCensus(JUDGE ? NOBODY : patients);
  const synthetic = useMemo(() => others ?? (census ? syntheticCensus(106) : []), [census, others]);
  // Judge build: one row per person on the record, opening the visit the server holds for them (the roster is exactly those).
  const rows = useMemo(() => JUDGE ? rosterRows(real, others ?? [], new Set(patients.map(p => p.id))) : [...real, ...synthetic], [real, synthetic]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // The count takes its most urgent flag's colour: amber over amber flags, red only when one is red.
  const needTone = mostUrgent(rows.filter(r => r.group === "needs").map(r => r.tone)) === "urgent" ? "urgent" : "soon";
  const upNext = [...day].sort((x, y) => x.time.localeCompare(y.time)).find(p => !encounters[p.id]?.requests.length);
  const insight: ReactNode[] = tab === "continue"
    ? [entries.length ? `${entries.length} unfinished` : "Nothing unfinished", toSign ? <Tone key="sign" of="soon">{toSign} {toSign === 1 ? "note" : "notes"} to sign</Tone> : null].filter(Boolean)
    : [!JUDGE && rows.length === patients.length ? (day.length ? `${day.length} ${day.length === 1 ? "visit" : "visits"} today` : "No visits today") : `${rows.length} patients`, needs ? <Tone key="needs" of={needTone}>{needLine(needs)}</Tone> : null, upNext ? <Fragment key="next">next <Tone of="next">{upNext.name.split(" ")[0]} at {upNext.time}</Tone></Fragment> : null].filter(Boolean);

  const renderItem = useCallback(({ item, index }: { item: Item; index: number }) => {
    if (item.kind === "header") return <Text accessibilityRole="header" style={{ ...type.footnote, fontWeight: "600", color: palette.muted, paddingTop: index ? 18 : 4, paddingBottom: 6, paddingHorizontal: 4 }}>{item.title} · {item.count}</Text>;
    const first = index === 0 || items[index - 1]!.kind === "header";
    const last = index === items.length - 1 || items[index + 1]!.kind === "header";
    const shape = { backgroundColor: palette.white, borderTopLeftRadius: first ? radius.group : 0, borderTopRightRadius: first ? radius.group : 0, borderBottomLeftRadius: last ? radius.group : 0, borderBottomRightRadius: last ? radius.group : 0, borderTopWidth: first ? 0 : 1, borderColor: "rgba(20,28,40,0.06)" };
    if (item.kind === "more") return <Press accessibilityLabel={`Show ${item.hidden} more in ${GROUPS.find(g => g.id === item.group)!.title}`} onPress={() => setOpened(o => new Set([...o, item.group]))}
      style={{ ...shape, minHeight: 48, justifyContent: "center", paddingHorizontal: 16 }}>
      <Text style={{ ...type.subhead, fontWeight: "600", color: palette.blue }}>{GROUPS.find(g => g.id === item.group)!.shown ? `Show ${item.hidden} more` : `Show ${item.hidden}`}</Text>
    </Press>;
    const r = item.row;
    return <ListRow title={r.name} badge={r.id === patient?.id ? <Text style={{ fontWeight: "500", color: palette.blue }}>  · current</Text> : undefined} detail={r.reason} tone={r.tone} initials={r.initials} trailing={r.where.replace(/^(Clinic|Bed) /, "")}
      edges={{ first, last }} onPress={r.open ? () => setOpen(r.id) : JUDGE ? () => Alert.alert(r.name, "The hospital record has no visit for this patient.") : undefined} accessibilityHint={r.open ? "Shows the patient summary and actions" : undefined}
      accessibilityLabel={`${r.name}, ${r.where}, ${r.reason}${r.open || others ? "" : ". Synthetic census row"}`} />;
  }, [items, patient?.id, others]);

  // The sheet shows today's appointment time, as the row did: the judge build's roster carries no clock time of its own.
  const picked = patients.find(p => p.id === open), chosen = picked && { ...picked, time: day.find(d => d.id === open)?.time ?? picked.time };
  // Opened to pick a visit for something (a question, a tool, a switch) it says so; from the sidebar it is the Patients page.
  const picking = Boolean(next || view || prompt || switching);
  const header = <View style={{ gap: 14, paddingBottom: 14 }}>
    <Stack.Screen options={{ title: picking ? "Choose a patient" : "Patients" }} />
    <Insight>{insight.map((part, i) => [i ? " · " : "", part])}</Insight>
    <View style={{ borderRadius: radius.control, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}><Icon name="magnifyingglass" color={palette.muted} size={18} /><TextInput accessibilityLabel="Search patients" placeholder={`Search ${rows.length} patients by name, ID or bed`} value={query} onChangeText={setQuery} placeholderTextColor={palette.placeholder} clearButtonMode="while-editing" style={{ flex: 1, minHeight: 52, ...type.headline, fontWeight: "400", lineHeight: undefined, color: palette.ink }} /></View>
    {!query && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ marginHorizontal: -20 }} contentInset={{ left: 20, right: 20 }} contentOffset={{ x: -20, y: 0 }}>
      {/* The design system's pill: the picked tab is ink, like every picked option. */}
      {tabs.map(t => <Chip key={t.id} label={`${t.label} ${count(t.id)}`} selected={t.id === tab} accessibilityLabel={`${t.label}, ${count(t.id)}`} onPress={() => setTab(t.id)} />)}
    </ScrollView>}
    {!items.length && <Text style={{ ...type.callout, color: palette.muted, paddingHorizontal: 4 }}>{query ? "No one matches. Try a name, patient ID or bed." : tab === "continue" ? "Nothing unfinished. Visits you work on show here for 24 hours, and pinned patients stay." : "Nobody here right now."}</Text>}
  </View>;

  // A picker: no Sona bar here (search is the way in), so the list runs to the sheet's edge.
  return <>
    <LegendList ref={list} data={items} keyExtractor={i => i.key} getItemType={i => i.kind} renderItem={renderItem} recycleItems estimatedItemSize={64}
      ListHeaderComponent={header} style={{ flex: 1, backgroundColor: palette.canvas, experimental_backgroundImage: canvasImage }} contentContainerStyle={{ padding: 20, paddingBottom: 44 }}
      contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" />
    {tab === "all" && !query && <AtoZ rows={rows} items={items} list={list} />}
    {chosen && <PatientSheet key={chosen.id} patient={chosen} onClose={() => setOpen(undefined)} onGo={go => select(chosen.id, go)} />}
  </>;
}

/**
 * The A–Z index on the right edge of "All", as iOS draws it: one 44 pt-wide strip that a tap or a
 * drag reads by position (so every letter is reachable, however many there are), and for VoiceOver
 * one adjustable control (swipe up or down to move a letter).
 */
function AtoZ({ rows, items, list }: { rows: Row[]; items: Item[]; list: RefObject<LegendListRef | null> }) {
  const { reducedMotion } = useAccessibleEffects();
  const all = letters(rows);
  const [at, setAt] = useState(0);
  const strip = useRef<View>(null);
  const box = useRef({ y: 0, h: 1 });
  const jump = (i: number) => {
    const n = Math.max(0, Math.min(all.length - 1, i));
    const index = items.findIndex(x => x.kind === "header" && x.title === all[n]);
    setAt(n);
    // The sheet's transparent header covers the top ~64 pt, so the letter lands just below it.
    if (index >= 0) void list.current?.scrollToIndex({ index, animated: !reducedMotion, viewOffset: 64 });
  };
  const read = (pageY: number) => { const n = Math.floor(((pageY - box.current.y) / box.current.h) * all.length); if (n !== at) jump(n); };
  return <View pointerEvents="box-none" style={{ position: "absolute", right: 0, top: 210, bottom: 60, justifyContent: "center" }}>
    <View ref={strip} accessible accessibilityRole="adjustable" accessibilityLabel="Jump to a letter" accessibilityValue={{ text: all[at] ?? "" }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={e => jump(at + (e.nativeEvent.actionName === "increment" ? 1 : -1))}
      onLayout={() => strip.current?.measureInWindow((_x, y, _w, h) => { box.current = { y, h: h || 1 }; })}
      onStartShouldSetResponder={() => true} onResponderGrant={e => jump(Math.floor(((e.nativeEvent.pageY - box.current.y) / box.current.h) * all.length))} onResponderMove={e => read(e.nativeEvent.pageY)}
      style={{ width: 44, alignItems: "center", paddingVertical: 4 }}>
      {all.map(l => <Text key={l} style={{ ...type.overline, lineHeight: 15, color: palette.blue }}>{l}</Text>)}
    </View>
  </View>;
}
