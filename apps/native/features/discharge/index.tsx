import { ErrorLine, PressScale } from "@/components/sona/parts";
import { router, Stack } from "expo-router";
import { MarkedText } from "@/components/sona/marked-text";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, withSpring, withTiming } from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, CloseButton, glass, Icon, Insight, Screen, Surface, Tone, useAccessibleEffects } from "@/components/sona/ui";
import { BlockerRow, useSettling, Pill, Ring } from "@/features/clinical/prescribe-card";
import { Seal, haptic } from "@/features/clinical/medication-parts";
import { capabilityLabels } from "@/features/encounter/conversation";
import { useEncounter } from "@/features/encounter/store";
import { LockedAction, useRole } from "@/features/live/roles";
import { api, errorText, JUDGE, requestId, useLive } from "@/features/live";
import { useServerEncounter } from "@/features/live/sync";
import { Arrive, Drafting, SampleLabel } from "@/components/sona/model-answer";
import { useLiveDraft } from "@/features/live/model-sync";
import { unanswered } from "@/features/clinical/judge-answer";
import { CareInvite } from "@/features/care-invite";
import { refreshServerData, useVisitTasks } from "@/features/live/server-day";
import { CHECK_IN_CHOICES, MAX_CHECK_INS, checkInDaysLine, defaultCheckInDays, toggleCheckInDay } from "@/features/check-ins/model";
import { markTerms } from "@/features/encounter/emphasis";
import { refreshCheckIns, useCheckIns } from "@/features/check-ins/state";
import { useFindings } from "@/features/live/findings-sync";
import type { Patient, PrescriptionCheck } from "@/features/encounter/types";
import { EMPTY_DISCHARGE, FOLLOW_UPS, LANGUAGES, SAMPLE_FIT_MINUTES, checkInDaysFor, checkInDaysOf, discharge, dischargeChecks, fitAtOf, followUpsOf, formatMinutes, planFor, type DischargePlan, type DischargeState, type MedChange, type Wait } from "./model";
import { NoVisit } from "@/components/sona/no-visit";

/*
 * Discharge: the folded visit pins at the top and the discharge card rises from below on a spring
 * (0.8 s, damping 0.85) with its summary lines 40 ms apart; no timed "drafting" stands in front of it.
 * Inside, the prescribe card's pattern: ring, only what blocks, each fixed where it sits, a button
 * (pinned in the decision bar) that morphs into the discharge, and a receipt that stamps in the card.
 * Connected, the plan is the server's read of this visit's rows (discharge.plan): the charted take-home
 * list, when the bed was marked fit, the guarantee letter, the chart's observations and what else holds
 * the bed, so the card shows exactly what discharge.request will check.
 */
const TEAL = palette.green;

export function DischargeScreen() {
  // The open visit is the one being discharged (updateEncounter writes to it).
  const { patient, encounters } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  if (!patient) return <><ModalHeader title="Discharge" /><NoVisit view="discharge" what="a discharge" /></>;
  const discharged = Boolean(encounters[patient.id]?.discharge?.dischargedAt);
  const answers = encounters[patient.id]?.requests.map(r => capabilityLabels[r.kind]) ?? [];
  // An already discharged patient opens still, on the receipt.
  return <View style={{ flex: 1, backgroundColor: palette.canvas }}>
    <ModalHeader title="Discharge" />
    <DischargePage patient={patient} answers={answers} animate={!reducedMotion && !discharged} />
  </View>;
}

/** The modal's header, as Consultation's and Scan's: the native bar's centred title and glass Close (these modals start without it). */
export function ModalHeader({ title }: { title: string }) {
  return <Stack.Screen options={{ headerShown: true, title, headerLeft: () => null, headerRight: () => <CloseButton /> }} />;
}

/** The decision bar's one line above its button: what the action will do, or why it just failed. */
export function BarLine({ children, error = false }: { children: string; error?: boolean }) {
  return <Text accessibilityLiveRegion={error ? "polite" : undefined} style={{ ...type.footnote, paddingHorizontal: 4, color: error ? palette.red : palette.muted }}>{children}</Text>;
}

/** The review page's decision: grey and inert while something blocks, ink once it can act; the label crossfades as it morphs. */
export function Decide({ label, icon, muted = false, disabled = false, onPress }: { label: string; icon?: string; muted?: boolean; disabled?: boolean; onPress: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}>{({ pressed }) => <PressScale pressed={pressed} scale={0.97} style={{ height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: muted ? "rgba(20,28,40,0.08)" : palette.ink, transitionProperty: ["transform", "backgroundColor"], transitionDuration: [120, 200] }}>
    {icon && <Icon name={icon} size={15} color={muted ? palette.muted : palette.white} />}
    <Animated.Text key={label} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={{ ...type.body, fontWeight: "600", color: muted ? palette.muted : palette.white }}>{label}</Animated.Text>
  </PressScale>}</Pressable>;
}

function Avatar({ patient, size = 40 }: { patient: Patient; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(36,91,204,0.1)" }}>
    <Text style={{ fontSize: size * 0.36, fontWeight: "700", color: palette.blue }}>{patient.initials}</Text>
  </View>;
}

/** The folded visit, pinned above the discharge card (the shot's page preview). */
function VisitChip({ patient, answers, animate }: { patient: Patient; answers: string[]; animate: boolean }) {
  return <Animated.View entering={animate ? riseIn({ distance: -8, scale: 0.94, duration: 320 }) : undefined}>
    <Surface style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.group }}>
      <Avatar patient={patient} size={34} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{patient.name}</Text>
        <Text numberOfLines={1} style={{ ...type.caption, color: palette.muted }}>Visit · {answers.length ? `${answers.length} ${answers.length === 1 ? "answer" : "answers"}` : patient.subtitle} · drafted from the record</Text>
      </View>
    </Surface>
  </Animated.View>;
}

const TAG: Record<MedChange["change"], { label: string; ink: string; fill: string }> = {
  changed: { label: "Changed", ink: palette.amber, fill: "rgba(196,120,20,0.12)" },
  new: { label: "New", ink: palette.blue, fill: "rgba(36,91,204,0.1)" },
  stopped: { label: "Stopped", ink: palette.muted, fill: "rgba(20,28,40,0.06)" },
  unchanged: { label: "Same", ink: palette.muted, fill: "rgba(20,28,40,0.06)" },
};

/** A blocker's inline fix (smaller and bolder than `ui.Chip`, which picks values). */
export function FixChip({ label, icon, onPress, strong = false }: { label: string; icon?: string; onPress: () => void; strong?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { haptic("select"); onPress(); }} hitSlop={6}
    style={{ alignSelf: "flex-start", height: 34, paddingHorizontal: 14, borderRadius: 17, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: strong ? palette.blue : "rgba(20,28,40,0.06)" }}>
    {icon && <Icon name={icon} size={12} color={strong ? palette.white : palette.ink} />}
    <Text style={{ ...type.subhead, fontWeight: "600", color: strong ? palette.white : palette.ink }}>{label}</Text>
  </Pressable>;
}

/** The page: header, the folded visit, the discharge card, and the decision pinned in the bar. */
function DischargePage({ patient, answers, animate }: { patient: Patient; answers: string[]; animate: boolean }) {
  const { encounters, updateEncounter } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const encounter = encounters[patient.id];
  const state = encounter?.discharge ?? EMPTY_DISCHARGE;
  const { live, refresh } = useServerEncounter(patient);
  const { user } = useLive();
  const [serverError, setServerError] = useState<string>();
  const role = useRole();
  // Live mode: the full summary and the leaflet in the chosen language are drafted by the server from this patient's record.
  const draft = useLiveDraft(patient.encounterId, state.language);
  // Connected: the plan and what else holds the bed, read by the server from this visit's rows. Sample mode has no rows,
  // so the plan is the fixture record's own (its guarantee letter included).
  const [served, setServed] = useState<{ plan: DischargePlan; waits: Wait[] }>();
  useEffect(() => {
    if (!live) return;
    let gone = false;
    api.discharge.plan({ encounterId: patient.encounterId }).then(r => { if (!gone) setServed(r); }).catch(e => { if (!gone) setServerError(errorText(e)); });
    return () => { gone = true; };
  }, [live, patient.encounterId]);
  const base = served?.plan ?? planFor(patient);
  // The summary check exists once a model's draft is stored for the visit, which is the moment the card has one.
  const plan: DischargePlan = { ...base, visit: { ...base.visit, drafted: base.visit.drafted || draft.data?.source === "model" } };
  // Connected, nothing can be decided until the visit's rows have been read (or the read failed and said so).
  const reading = live && !served && !serverError;
  // An open incidental finding travels with the patient: it blocks until tracked or dismissed.
  const found = useFindings();
  const openFindings = found.findings.filter(f => f.encounterId === patient.encounterId && f.status === "open");
  const checks = dischargeChecks(state, plan, openFindings, served?.waits);
  const blocked = checks.filter(c => c.status === "blocked");
  const resolving = useSettling(blocked.map(c => c.id));
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sample mode only: the demo patient became fit a little before the card opened, so the saving reads the same at any hour.
  // Connected, fit is when the admission was marked fit, and unknown when nobody marked it.
  const [sampleFit] = useState(() => new Date(Date.now() - SAMPLE_FIT_MINUTES * 60000));
  const fitAt = plan.visit.fitAt ? new Date(plan.visit.fitAt) : live ? undefined : sampleFit;
  // The outcome's check draws only when the discharge happens here, not when a discharged visit reopens.
  const [wasDone] = useState(() => Boolean(state.dischargedAt));
  const fresh = !wasDone && !reducedMotion;
  // Judge build: the summary and the leaflet are the model's or absent. While it drafts both say so; a failed call or the
  // server's stub is said once, where the summary would be, and the plan's authored words never stand in (features/clinical/judge-answer).
  const held = unanswered(JUDGE, draft);
  // The receipt reads what the discharge left: the visit's tasks (the Tasks page's list) and its scheduled check-ins.
  const tasksOf = useVisitTasks();
  const checkIns = useCheckIns();

  if (!encounter) return <NoVisit view="discharge" what="a discharge" />;
  const set = (change: Partial<DischargeState>) => {
    // A role that cannot change the plan is told why, and nothing changes on this phone either.
    if (live && !role.can("discharge.update")) { haptic("select"); setServerError(role.why("discharge.update")); return; }
    updateEncounter(value => ({ ...value, discharge: { ...(value.discharge ?? EMPTY_DISCHARGE), ...change } }));
    if (live) void api.discharge.update({ encounterId: patient.encounterId, ...change }).catch(e => setServerError(errorText(e)));
  };
  const done = state.dischargedAt ? new Date(state.dischargedAt) : undefined;
  // Once discharged, fit reads back from what was stored, not from when this page opened.
  const fit = done ? fitAtOf(state) : fitAt;
  const followUps = followUpsOf(tasksOf(patient), patient, state, plan).length;
  const rows =checks.filter(c => c.status === "blocked" || resolving.has(c.id));
  const passed = checks.filter(c => c.status === "passed" && !resolving.has(c.id));
  const first = patient.name.split(" ")[0];
  const language = LANGUAGES.find(l => l.id === state.language) ?? LANGUAGES[0]!;
  const saved = state.savedMinutes ? formatMinutes(state.savedMinutes) : undefined;

  const go = () => {
    haptic("select"); setBusy(true); setServerError(undefined);
    if (live && user) {
      // The server decides: it refuses while anything blocks, and receipts once per request.
      api.discharge.request({ encounterId: patient.encounterId, requestId: requestId(), approvedBy: user.id, checkInDays: checkInDaysOf(state, plan) })
        // The server made the follow-up tasks; keeping the device's copies too would list each twice on My Day.
        .then(receipt => { updateEncounter(value => ({ ...discharge(value, patient, fitAt, new Date(receipt.createdAt)), tasks: value.tasks })); haptic("success"); void refreshCheckIns().catch(() => {}); void refreshServerData().catch(() => {}); })
        .catch(e => { setServerError(errorText(e)); void refresh(true).catch(() => {}); })
        .finally(() => setBusy(false));
      return;
    }
    // ponytail: a short pause stands in for the bed-management call; the real one is async with failure handling.
    setTimeout(() => { updateEncounter(value => discharge(value, patient, fitAt, new Date())); setBusy(false); haptic("success"); }, reducedMotion ? 0 : 700);
  };

  const fix = (check: PrescriptionCheck) => {
    if (check.id === "gl") return encounter.claim?.status === "sent" || encounter.claim?.status === "appealed"
      ? <Text style={{ ...type.footnote, color: palette.muted }}>{encounter.claim.status === "appealed" ? "Appeal sent · awaiting insurer" : "Sent · awaiting insurer"}</Text>
      : encounter.claim?.status === "denied"
        ? <View style={{ gap: 8 }}><Text selectable style={{ ...type.footnote, color: palette.red }}>Denied: {encounter.claim.denial?.reason ?? "see the letter"} · appeal drafted</Text><FixChip label="Review appeal and send" icon="doc.text.magnifyingglass" strong onPress={() => router.push("/claim")} /></View>
      : encounter.claim?.status === "queried"
        ? <View style={{ gap: 8 }}><Text selectable style={{ ...type.footnote, color: palette.amber }}>Insurer asks: {encounter.claim.query}</Text><FixChip label="Answer and send again" icon="doc.text.magnifyingglass" strong onPress={() => router.push("/claim")} /></View>
        : <FixChip label="Review codes and send" icon="doc.text.magnifyingglass" strong onPress={() => router.push("/claim")} />;
    if (check.id === "followup") return <View style={{ flexDirection: "row", gap: 8 }}>
      {FOLLOW_UPS.map(f => <Pill key={f.id} label={f.label} on={state.followUp === f.id} onPress={() => set({ followUp: f.id })} />)}
    </View>;
    if (check.id === "meds") return <View style={{ gap: 10 }}>
      {plan.meds.filter(m => m.change !== "unchanged").map(m => <View key={m.name} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <View style={{ width: 64, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: TAG[m.change].fill }}>
          <Text style={{ ...type.caption, fontWeight: "700", color: TAG[m.change].ink }}>{TAG[m.change].label}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink, textDecorationLine: m.change === "stopped" ? "line-through" : "none" }}>{m.name}</Text>
          <Text style={{ ...type.caption, color: palette.muted }}>{m.detail}</Text>
        </View>
      </View>)}
      {plan.meds.some(m => m.change === "unchanged") && <Text style={{ ...type.caption, color: palette.muted }}>{plan.meds.filter(m => m.change === "unchanged").map(m => m.name).join(", ")} unchanged</Text>}
      <FixChip label="Confirm take-home list" strong onPress={() => set({ medsConfirmed: true })} />
    </View>;
    const finding = openFindings.find(f => check.id === `finding-${f.id}`);
    if (finding) return <FixChip label="Track follow-up" icon="calendar.badge.plus" strong onPress={() => void found.track(finding)} />;
    return undefined;
  };

  const primary = busy ? "Freeing the bed…" : reading ? "Reading the record…" : blocked.length ? `Resolve ${blocked.length} to discharge` : `Discharge ${first}`;
  // What discharging leaves behind, said as it will be: the tasks this plan creates, and a leaflet only where one will go home
  // (the model's draft; sample mode's own).
  const tasks = plan.visit.gl ? 2 : 1, leaflet = !live || draft.data?.source === "model";
  // A model's three lines replace the plan's own once it drafted them (live mode); its take-home list was checked on the server.
  const lines = draft.data?.lines ?? plan.summary;
  const summary: [string, string][] = [["Diagnosis", lines.diagnosis], ["Course", lines.course], ["Plan", lines.plan]];
  // Colour only what changes the plan: how severe the diagnosis is and the medicines that are new or changed.
  const marked = (text: string) => markTerms(text, [["mild", "finding"], ["moderate", "caution"], ["severe", "alert"],
    ...plan.meds.filter(m => m.change === "changed" || m.change === "new").map((m): [string, "caution"] => [m.name, "caution"])]);

  const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const error = serverError ?? found.error;
  // The decision stays in view: what discharging does, then the button; once done, the next step.
  const bar = done ? <>
    {error ? <BarLine error>{error}</BarLine> : <BarLine>{`Sona Care checks in on day ${checkInDaysFor(checkIns, patient.encounterId, checkInDaysOf(state, plan)).join(", ")} · ${language.name}`}</BarLine>}
    <View style={{ flexDirection: "row", gap: 10 }}>
      {followUps > 0 && <View style={{ flex: 1 }}><Action label="View tasks" icon="checklist" secondary onPress={() => { router.back(); setTimeout(() => router.push("/tasks"), 320); }} /></View>}
      <View style={{ flex: 1 }}><Action label="Done" onPress={() => router.back()} /></View>
    </View>
  </> : <>
    {error ? <BarLine error>{error}</BarLine> : <BarLine>{`Frees ${plan.bed} · creates ${tasks} follow-up ${tasks === 1 ? "task" : "tasks"}${leaflet ? ` · leaflet in ${language.name}` : ""}`}</BarLine>}
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}>{live && !role.can("discharge.request") ? <LockedAction label="Needs a doctor's approval" path="discharge.request" />
        : <Decide label={primary} icon={blocked.length ? undefined : busy ? "hourglass" : "bed.double"} muted={blocked.length > 0 || reading} disabled={blocked.length > 0 || busy || reading} onPress={go} />}</View>
    </View>
  </>;

  return <Screen bottom={bar}>
    <VisitChip patient={patient} answers={answers} animate={animate} />
    <Animated.View entering={animate ? riseCard : undefined}>
    <Surface feature layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        {/* Once discharged the ring reads complete, whatever the checks say now. */}
        <Ring done={done ? checks.length : checks.length - blocked.length} total={checks.length} />
        <View style={{ flex: 1 }}>
          <Insight eyebrow={[patient.name, plan.bed, fit && `fit ${done ? "at" : "since"} ${time(fit)}`].filter(Boolean).join(" · ")}>
            {done ? <><Tone of="good">Discharged</Tone> at {time(done)}</> : blocked.length ? <><Tone of="soon">{blocked.length} left</Tone> before {first} can go home</> : <>{first} is <Tone of="next">ready to go home</Tone></>}
          </Insight>
        </View>
      </View>

      {/* Discharged: the outcome and the patient's Sona Care code lead; the summary waits behind "Read full". */}
      {done && <Animated.View entering={reducedMotion ? FadeIn : FadeIn.duration(260)} style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.group, borderCurve: "continuous", backgroundColor: "rgba(15,110,102,0.08)" }}>
          <Seal draw stampDelay={fresh ? 120 : undefined} />
          <Animated.View entering={fresh ? riseIn({ delay: 220, distance: 6, duration: 360 }) : undefined} style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{plan.bed} free{saved ? ` · ${saved} earlier` : ""}</Text>
            <Text style={{ ...type.caption, color: palette.muted }}>{[followUps && `${followUps} follow-up ${followUps === 1 ? "task" : "tasks"} created`, leaflet && "leaflet ready to print", time(done)].filter(Boolean).join(" · ")}</Text>
          </Animated.View>
        </View>
        <CareInvite encounterId={patient.encounterId} />
      </Animated.View>}

      {!done && rows.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT}>
        {rows.map((check, i) => <BlockerRow key={check.id} check={check} n={i + 1} resolved={resolving.has(check.id)}>{fix(check)}</BlockerRow>)}
      </Animated.View>}

      {!done && passed.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="checkmark.circle.fill" size={13} color={TEAL} />
        <Text style={{ ...type.footnote, fontWeight: "600", color: TEAL }}>{blocked.length ? `${passed.length} checks passed` : `All ${passed.length} checks passed`}</Text>
      </Animated.View>}

      {/* What the discharge carries: quieter, under what blocks it. */}
      <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 14, paddingTop: 14, borderTopWidth: 1, borderColor: glass.hairline }}>
      <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 8 }}>
        {held ? !done && (held.reason ? <ErrorLine text={`No discharge draft: ${held.reason}`} /> : <Drafting label="Drafting the summary…" />) : <>
        {(!done || full) && summary.map(([label, value], i) => { const text = marked(value); return <Animated.View key={label} entering={animate ? riseIn({ delay: 180 + i * 40, distance: 10, duration: 320 }) : undefined} style={{ flexDirection: "row", gap: 12 }}>
          <Text style={{ ...type.overline, width: 72, paddingTop: 3, color: palette.muted }}>{label}</Text>
          {text === value ? <Text selectable style={{ ...type.subhead, flex: 1, color: palette.ink }}>{value}</Text> : <MarkedText text={text} style={{ ...type.subhead, flex: 1, color: palette.ink }} />}
        </Animated.View>; })}
        {full && <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(200)}>
          <Text selectable style={{ ...type.footnote, color: palette.muted }}>{draft.data?.summary ?? plan.full}</Text>
        </Animated.View>}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: full }} onPress={() => setFull(v => !v)} hitSlop={6} style={{ alignSelf: "flex-start", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{full ? "Show less" : "Read full"}</Text>
          <Icon name={full ? "chevron.up" : "chevron.right"} size={10} color={palette.blue} />
        </Pressable>
        </>}
      </Animated.View>

      {!done && <CheckInDays state={state} condition={plan.condition} language={language.name} onChange={checkInDays => set({ checkInDays })} />}

      {!done && <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ ...type.overline, color: palette.muted }}>Patient leaflet</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {LANGUAGES.map(l => <Pill key={l.id} label={l.label} on={state.language === l.id} onPress={() => set({ language: l.id })} />)}
          </View>
        </View>
        {!held?.reason && <Animated.View key={state.language} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={{ padding: 12, gap: 6, borderRadius: radius.control, borderCurve: "continuous", backgroundColor: "rgba(20,28,40,0.04)" }}>
          {draft.loading ? <Drafting label={`Drafting the leaflet in ${language.name}…`} lines={2} />
            : <Arrive animate={Boolean(draft.data)}><Text selectable style={{ ...type.subhead, color: palette.ink }}>{draft.data?.leaflet ?? plan.leaflet[state.language]}</Text></Arrive>}
          {draft.error && <Text style={{ ...type.caption, color: palette.red }}>{draft.error} · showing the authored leaflet</Text>}
        </Animated.View>}
      </Animated.View>}
      {/* The summary and the leaflet are one draft (discharge.draft), so they carry one label, under the last of them on view. */}
      {(!done || full) && !held && <SampleLabel answer={draft} what="discharge" />}
      </Animated.View>
    </Surface>
    </Animated.View>
  </Screen>;
}

/**
 * "Check-ins": the days Sona Care messages the patient after discharge, as chips with the condition's
 * suggestion preselected. A tap toggles a day; at least one and at most six stay on (a tap past either
 * is refused with a line saying why). The pick is saved with the discharge and drives the check-ins.
 */
function CheckInDays({ state, condition, language, onChange }: { state: DischargeState; condition?: string; language: string; onChange: (days: number[]) => void }) {
  const suggested = defaultCheckInDays(condition);
  const days = state.checkInDays?.length ? state.checkInDays : suggested;
  const [refused, setRefused] = useState<string>();
  const same = days.join() === suggested.join();
  const toggle = (day: number) => {
    const next = toggleCheckInDay(days, day);
    if (next.join() === days.join()) { setRefused(days.length === 1 ? "Keep at least one check-in" : `Up to ${MAX_CHECK_INS} check-ins`); return; }
    setRefused(undefined); onChange(next);
  };
  const why = same ? (condition ? `Suggested for ${condition.replace(/-/g, " ")}` : "The usual days") : `Changed from ${checkInDaysLine(suggested)}`;
  return <View style={{ gap: 10 }}>
    <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted }}>Check-ins</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {CHECK_IN_CHOICES.map((d, i) => <Pill key={d} label={i === 0 ? `Day ${d}` : String(d)} a11y={`Check-in day ${d}`} on={days.includes(d)} onPress={() => toggle(d)} />)}
    </View>
    <Text accessibilityLiveRegion="polite" style={{ ...type.caption, color: refused ? palette.amber : palette.muted }}>{refused ?? `${why} · Sona Care asks in ${language}`}</Text>
  </View>;
}

/** The discharge card rising from below on a soft spring, as the shot's summary sheet does. */
function riseCard() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 140 }] },
    animations: { opacity: withTiming(1, { duration: 240 }), transform: [{ translateY: withSpring(0, { duration: 800, dampingRatio: 0.85 }) }] },
  };
}
