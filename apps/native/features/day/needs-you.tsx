import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { SampleLabel } from "@/components/sona/model-answer";
import { ErrorLine, PressScale } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, Surface } from "@/components/sona/ui";
import { BookingActions } from "@/features/bookings/parts";
import { FlagActions } from "@/features/check-ins/thread";
import { openResults, openSession } from "@/features/encounter/navigation";
import { useEncounterSelect } from "@/features/encounter/store";
import { MessageActions } from "@/features/inbox";
import { JUDGE, api, errorText } from "@/features/live";
import { useLiveHandover } from "@/features/live/handover-sync";
import { useRole } from "@/features/live/roles";
import { refreshServerData, useServerData, useVisitTasks } from "@/features/live/server-day";
import { useTaskEdits } from "@/features/tasks";
import { ownerReceipt, type Bed } from "@/features/ward/model";
import { useWardOwners } from "@/features/ward/owners";
import type { Need } from "./counts";
import { ownersOf, type ScheduleVisit } from "./model";
import { MAX_ROWS, blockedRows, needRows, shownInNeeds, taskRows, visitRows, type BlockedRow, type NeedRow, type RowTone } from "./needs-you-model";
import { usePendingResults } from "./use-counts";

/*
 * Today under the home keys: who needs you now (the header's count, one ranking), the discharges blocked and your tasks,
 * three rows at most each, every row with who, why (its number or time) and the one move, done in place. Sections with
 * nothing hide; with nothing anywhere, one calm line. The first need is the day's lead, so it reads a size up.
 * No motion of its own beyond the rows' press feedback, so nothing here runs while the page sits still.
 */
const INK: Record<RowTone, string> = { urgent: palette.red, soon: palette.amber, calm: palette.muted };
const haptic = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };

/** A need's row opens where its reason is: a message's thread, a check-in on the patient's sheet, else the visit at that step. */
function openNeed(r: NeedRow) {
  if (!r.patientId) return;
  if (r.go.view === "messages") router.push({ pathname: "/inbox/[patientId]", params: { patientId: r.patientId } });
  else if (r.go.view === "check-in") router.push({ pathname: "/patients/[id]", params: { id: r.patientId } });
  else openSession(r.patientId, r.go);
}

/** `needs`: Today's ranking (useNeedsYou); `now`: minutes into the day on Today's clock; `beds`: Today's ward read; `live`: live backend mode. */
export function NeedsYou({ needs: ranked, now, beds, live }: { needs: Need[]; now: number; beds: Bed[]; live: boolean }) {
  const { can } = useRole();
  const needs = needRows(ranked, usePendingResults(), now);
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

  // The Tasks page's list and its tick, less what Needs you now already lists; the handover's count as the sidebar reads it.
  const tasksOf = useVisitTasks();
  const edits = useTaskEdits();
  const handover = useLiveHandover(JUDGE && can("handover.list"));
  const handing = !can("handover.list") ? undefined : handover.live ? handover.cards?.length : patients.length + 3;
  const shown = shownInNeeds(ranked);
  const tasks = taskRows(can("tasks.list") ? patients.flatMap(patient => tasksOf(patient).filter(task => !shown(task, patient.id)).map(task => ({ task, patient }))) : [], handing, new Date());

  if (!needs.total && !blocked.total && !tasks.total) return <Text style={{ ...type.callout, color: palette.muted, textAlign: "center", paddingVertical: 12 }}>You’re all caught up.</Text>;
  return <View style={{ gap: 18 }}>
    {needs.total > 0 && <Group title="Needs you now" total={needs.total} info={<SampleLabel source="fixture" rule />}
      seeAll={needs.seeAll === "results" ? "Opens Results" : "Opens Patients"} onSeeAll={() => needs.seeAll === "results" ? openResults() : router.push("/patients")}>
      {needs.rows.map((r, i) => <Row key={r.id} first={!i} lead={!i} mark={<Dot tone={r.tone} />} title={r.who} reason={r.reason} tone={r.tone} action={r.action}
        onOpen={() => openNeed(r)} onAct={() => openNeed(r)}
        below={r.item?.kind === "check-in" ? <FlagActions item={r.item} /> : r.item?.kind === "message" ? <MessageActions item={r.item} /> : r.item?.kind === "booking" ? <BookingActions item={r.item} /> : undefined} />)}
    </Group>}
    {blocked.total > 0 && <Group title="Discharges blocked" total={blocked.total} onSeeAll={() => router.push({ pathname: "/ward", params: { filter: "blocked" } })}>
      {blocked.rows.map((r, i) => <Row key={r.id} first={!i} mark={<Dot tone={r.owner ? "calm" : "soon"} />} title={r.who} reason={r.reason} tone={r.owner ? "calm" : "soon"} note={sent?.bed === r.bed ? sent.line : undefined}
        action={r.action === "letter" ? "Open GL" : r.action === "assign" ? r.suggested : "Open"} arrow={r.action === "assign"}
        actionLabel={r.action === "assign" ? `Send ${r.label.toLowerCase()} on ${r.bed} to ${r.suggested}` : r.action === "letter" ? `Open the guarantee letter for ${r.who}` : `Open ${r.bed} on the ward`}
        onOpen={() => openBed(r.bed)} onAct={() => blockedAct(r)} />)}
      {error && <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}><ErrorLine text={error} /></View>}
    </Group>}
    {tasks.total > 0 && <Group title="Your tasks" total={tasks.total} onSeeAll={() => router.push("/tasks")}>
      {tasks.rows.map((r, i) => r.kind === "handover"
        ? <Row key={r.id} first={!i} mark={<Icon name="arrow.left.arrow.right" size={14} color={palette.muted} />} title={r.title} reason={r.reason} tone={r.tone} action="Open"
          actionLabel="Open the handover" onOpen={() => router.push("/handover")} onAct={() => router.push("/handover")} />
        : <Row key={r.id} first={!i} mark={<Tick locked={edits.locked} label={r.title} onTick={() => { haptic(); edits.toggle(r.patientId, r.task); }} />} title={r.title}
          reason={edits.receipts[r.id]?.text ?? r.reason} tone={edits.receipts[r.id]?.failed ? "soon" : r.tone} onOpen={() => router.push("/tasks")} />)}
    </Group>}
  </View>;
}

/**
 * The day's visits, by time: today's open the visit (See all past three opens Patients, which lists them all); another
 * day's are the clinic list, read-only, every one shown. Nothing booked: today shows no section, another day says so.
 */
export function DayVisits({ schedule, offset, onOpen }: { schedule: ScheduleVisit[]; offset: number; onOpen: (patientId: string) => void }) {
  const rows = visitRows(schedule, offset);
  if (!rows.length) return offset === 0 ? null : <Text style={{ ...type.callout, color: palette.muted, textAlign: "center", paddingVertical: 12 }}>Nothing scheduled this day.</Text>;
  return <Group title={offset === 0 ? "Today's visits" : "Visits"} total={rows.length} onSeeAll={offset === 0 ? () => router.push("/patients") : undefined}>
    {(offset === 0 ? rows.slice(0, MAX_ROWS) : rows).map((r, i) => <Row key={r.id} first={!i} mark={<Icon name="clock" size={13} color={INK[r.tone]} />} title={r.title} reason={r.reason} tone={r.tone}
      action={r.patientId ? "Open" : undefined} actionLabel={`Open ${r.title}`} onOpen={() => { if (r.patientId) onOpen(r.patientId); }} onAct={() => onOpen(r.patientId!)} />)}
  </Group>;
}

const openBed = (bed: string) => router.push({ pathname: "/ward", params: { filter: "blocked", bed } });

/** "NEEDS YOU NOW · 2", what it means (ⓘ) and See all past three rows, over one glass list. */
function Group({ title, total, info, seeAll, onSeeAll, children }: { title: string; total: number; info?: ReactNode; seeAll?: string; onSeeAll?: () => void; children: ReactNode }) {
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 4 }}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted, paddingTop: 1 }}>{title} · {total}</Text>
      <View style={{ flex: 1 }}>{info}</View>
      {total > MAX_ROWS && onSeeAll && <Pressable accessibilityRole="button" accessibilityLabel={`See all ${total}, ${title.toLowerCase()}`} accessibilityHint={seeAll} onPress={() => { haptic(); onSeeAll(); }} hitSlop={12}>
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

/**
 * One row: a lead mark, who (title) and why (reason in its meaning colour), a receipt once acted on (`note`), and the one
 * action as a quiet token, or the item's own actions under it (`below`). `lead`: the day's first need, a size up.
 */
function Row({ first, lead = false, mark, title, reason, note, tone, action, actionLabel, arrow = false, below, onOpen, onAct }: {
  first: boolean; lead?: boolean; mark: ReactNode; title: string; reason: string; note?: string; tone: RowTone; action?: string; actionLabel?: string; arrow?: boolean; below?: ReactNode; onOpen: () => void; onAct?: () => void;
}) {
  return <View style={{ borderTopWidth: first ? 0 : 1, borderColor: "rgba(20,28,40,0.06)", paddingBottom: below ? 12 : 0 }}>
    <View style={{ minHeight: lead ? 68 : 60, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, paddingRight: 12, paddingVertical: 10 }}>
      <View style={{ width: 20, alignItems: "center" }}>{mark}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${lead ? "Most urgent: " : ""}${title}. ${reason}`} onPress={() => { haptic(); onOpen(); }} style={{ flex: 1 }}>{({ pressed }) => <PressScale pressed={pressed} scale={0.98} style={{ gap: 2 }}>
        <Text numberOfLines={1} style={{ ...lead ? type.headline : type.subhead, fontWeight: "600", color: palette.ink }}>{title}</Text>
        <Text numberOfLines={2} style={{ ...lead ? type.footnote : type.caption, fontWeight: "600", color: INK[tone] }}>{reason}</Text>
        {note && <Text accessibilityLiveRegion="polite" style={{ ...type.caption, color: palette.green }}>{note}</Text>}
      </PressScale>}</Pressable>
      {action && onAct && <Pressable accessibilityRole="button" accessibilityLabel={actionLabel ?? `${action}, ${title}`} onPress={() => { haptic(); onAct(); }} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>{({ pressed }) =>
        <PressScale pressed={pressed} style={{ minHeight: 30, paddingHorizontal: 12, borderRadius: 15, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#E6EEFC" }}>
          {arrow && <Icon name="arrow.right" size={10} color={palette.blue} />}
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{action}</Text>
        </PressScale>}</Pressable>}
    </View>
    {below && <View style={{ paddingLeft: 46, paddingRight: 12 }}>{below}</View>}
  </View>;
}
