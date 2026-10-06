import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { SampleLabel } from "@/components/sona/model-answer";
import { ErrorLine, PressScale } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, Surface } from "@/components/sona/ui";
import { openSession } from "@/features/encounter/navigation";
import { useEncounterSelect } from "@/features/encounter/store";
import { JUDGE, api, errorText } from "@/features/live";
import { useLiveHandover } from "@/features/live/handover-sync";
import { useRole } from "@/features/live/roles";
import { refreshServerData, useServerData, useVisitTasks } from "@/features/live/server-day";
import { useTaskEdits } from "@/features/tasks";
import { ownerReceipt, type Bed, type Owner } from "@/features/ward/model";
import { useWardOwners } from "@/features/ward/owners";
import { ownersOf } from "./model";
import { MAX_ROWS, blockedRows, needRows, taskRows, type BlockedRow, type RowTone } from "./needs-you-model";
import { useNeedsYou, usePendingResult } from "./use-counts";

/*
 * Today under the home keys: who needs you now, the discharges blocked and your tasks, three rows at most each, every row
 * with who, why (its number or time) and the one move, done in place. Sections with nothing hide; with nothing anywhere,
 * one calm line. No motion of its own beyond the rows' press feedback, so nothing here runs while the page sits still.
 */
const INK: Record<RowTone, string> = { urgent: palette.red, soon: palette.amber, calm: palette.muted };
const haptic = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };

/** `now`: minutes into the day on Today's clock; `beds`: Today's ward read; `live`: live backend mode. */
export function NeedsYou({ now, beds, live }: { now: number; beds: Bed[]; live: boolean }) {
  const { can } = useRole();
  const needs = needRows(useNeedsYou(), usePendingResult(), now);
  const patients = useEncounterSelect(s => s.patients);

  // Blocker owners: the server's (live) over this session's book, which the Ward shares, so an owner set here shows there.
  const server = useServerData();
  const book = useWardOwners(live);
  const [error, setError] = useState<string>();
  const blocked = blockedRows(beds, { ...ownersOf(server?.tasks ?? []), ...book.owners }, id => patients.some(p => p.id === id));
  // The Ward's assign: shown owned at once (the row moves to the bed's next blocker, or says who is on it) with its receipt
  // under the row; refused, the owner goes and the reason shows.
  const [sent, setSent] = useState<{ bed: string; line: string }>();
  const assign = ({ bed, blockerId: id, label, suggested: owner }: BlockedRow) => {
    haptic(); setError(undefined); book.setOwners(o => ({ ...o, [id]: owner }));
    const told = (simulated: boolean) => { const line = ownerReceipt(owner, new Date(), simulated); book.setTold(id, line); setSent({ bed, line: `${label}: ${line}` }); };
    if (!live) { told(true); return; }
    api.ward.assignOwner({ blockerId: id, owner }).then(() => { told(false); refreshServerData().catch(() => {}); },
      e => { book.setOwners(o => ({ ...o, [id]: undefined })); setError(`Not assigned: ${errorText(e)}`); });
  };
  const blockedAct = (r: BlockedRow) => r.action === "letter" ? openSession(r.patientId!, { view: "claim" }) : r.action === "assign" ? assign(r) : openBed(r.bed);

  // The Tasks page's list and its tick; the handover's count as the sidebar reads it.
  const tasksOf = useVisitTasks();
  const edits = useTaskEdits();
  const handover = useLiveHandover(JUDGE && can("handover.list"));
  const handing = !can("handover.list") ? undefined : handover.live ? handover.cards?.length : patients.length + 3;
  const tasks = can("tasks.list") ? taskRows(patients.flatMap(patient => tasksOf(patient).map(task => ({ task, patient }))), handing, new Date()) : taskRows([], handing, new Date());

  if (!needs.total && !blocked.total && !tasks.total) return <Text style={{ ...type.callout, color: palette.muted, textAlign: "center", paddingVertical: 12 }}>You’re all caught up.</Text>;
  return <View style={{ gap: 18 }}>
    {needs.total > 0 && <Group title="Needs you now" total={needs.total} info={<SampleLabel source="fixture" rule />} onSeeAll={() => router.push("/patients")}>
      {needs.rows.map((r, i) => <Row key={r.id} first={!i} lead={<Dot tone={r.tone} />} title={r.who} reason={r.reason} tone={r.tone} action={r.action}
        onOpen={() => openSession(r.patientId, r.go)} onAct={() => openSession(r.patientId, r.go)} />)}
    </Group>}
    {blocked.total > 0 && <Group title="Discharges blocked" total={blocked.total} onSeeAll={() => router.push({ pathname: "/ward", params: { filter: "blocked" } })}>
      {blocked.rows.map((r, i) => <Row key={r.id} first={!i} lead={<Dot tone={r.owner ? "calm" : "soon"} />} title={r.who} reason={r.reason} tone={r.owner ? "calm" : "soon"} note={sent?.bed === r.bed ? sent.line : undefined}
        action={r.action === "letter" ? "Open GL" : r.action === "assign" ? r.suggested : "Open"} arrow={r.action === "assign"}
        actionLabel={r.action === "assign" ? `Send ${r.label.toLowerCase()} on ${r.bed} to ${r.suggested}` : r.action === "letter" ? `Open the guarantee letter for ${r.who}` : `Open ${r.bed} on the ward`}
        onOpen={() => openBed(r.bed)} onAct={() => blockedAct(r)} />)}
      {error && <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}><ErrorLine text={error} /></View>}
    </Group>}
    {tasks.total > 0 && <Group title="Your tasks" total={tasks.total} onSeeAll={() => router.push("/tasks")}>
      {tasks.rows.map((r, i) => r.kind === "handover"
        ? <Row key={r.id} first={!i} lead={<Icon name="arrow.left.arrow.right" size={14} color={palette.muted} />} title={r.title} reason={r.reason} tone={r.tone} action="Open"
          actionLabel="Open the handover" onOpen={() => router.push("/handover")} onAct={() => router.push("/handover")} />
        : <Row key={r.id} first={!i} lead={<Tick locked={edits.locked} label={r.title} onTick={() => { haptic(); edits.toggle(r.patientId, r.task); }} />} title={r.title}
          reason={edits.receipts[r.id]?.text ?? r.reason} tone={edits.receipts[r.id]?.failed ? "soon" : r.tone} onOpen={() => router.push("/tasks")} />)}
    </Group>}
  </View>;
}

const openBed = (bed: string) => router.push({ pathname: "/ward", params: { filter: "blocked", bed } });

/** "NEEDS YOU NOW · 2", what it means (ⓘ) and See all past three rows, over one glass list. */
function Group({ title, total, info, onSeeAll, children }: { title: string; total: number; info?: ReactNode; onSeeAll: () => void; children: ReactNode }) {
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 4 }}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted, paddingTop: 1 }}>{title} · {total}</Text>
      <View style={{ flex: 1 }}>{info}</View>
      {total > MAX_ROWS && <Pressable accessibilityRole="button" accessibilityLabel={`See all ${total}, ${title.toLowerCase()}`} onPress={() => { haptic(); onSeeAll(); }} hitSlop={12}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>See all</Text>
      </Pressable>}
    </View>
    <Surface style={{ paddingVertical: 2 }}>{children}</Surface>
  </View>;
}

const Dot = ({ tone }: { tone: RowTone }) => <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: INK[tone] }} />;

/** A task's tick: the Tasks page's toggle; a role that can't complete tasks sees a lock. */
function Tick({ locked, label, onTick }: { locked: boolean; label: string; onTick: () => void }) {
  if (locked) return <Icon name="lock.fill" size={12} color={palette.muted} />;
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={`Complete ${label}`} onPress={onTick} hitSlop={12}
    style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.6, borderColor: "#B7BDC6" }} />;
}

/** One row: a lead mark, who (title) and why (reason in its meaning colour), a receipt once acted on (`note`), and the one action as a quiet token. */
function Row({ first, lead, title, reason, note, tone, action, actionLabel, arrow = false, onOpen, onAct }: {
  first: boolean; lead: ReactNode; title: string; reason: string; note?: string; tone: RowTone; action?: string; actionLabel?: string; arrow?: boolean; onOpen: () => void; onAct?: () => void;
}) {
  return <View style={{ minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, paddingRight: 12, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: "rgba(20,28,40,0.06)" }}>
    <View style={{ width: 20, alignItems: "center" }}>{lead}</View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${reason}`} onPress={() => { haptic(); onOpen(); }} style={{ flex: 1 }}>{({ pressed }) => <PressScale pressed={pressed} scale={0.98} style={{ gap: 2 }}>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{title}</Text>
      <Text numberOfLines={2} style={{ ...type.caption, fontWeight: "600", color: INK[tone] }}>{reason}</Text>
      {note && <Text accessibilityLiveRegion="polite" style={{ ...type.caption, color: palette.green }}>{note}</Text>}
    </PressScale>}</Pressable>
    {action && onAct && <Pressable accessibilityRole="button" accessibilityLabel={actionLabel ?? `${action}, ${title}`} onPress={() => { haptic(); onAct(); }} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>{({ pressed }) =>
      <PressScale pressed={pressed} style={{ minHeight: 30, paddingHorizontal: 12, borderRadius: 15, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#E6EEFC" }}>
        {arrow && <Icon name="arrow.right" size={10} color={palette.blue} />}
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{action}</Text>
      </PressScale>}</Pressable>}
  </View>;
}
