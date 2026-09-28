import { router } from "expo-router";
import { MarkedText } from "@/components/sona/marked-text";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { EASE_OUT, LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { BlockerRow, useSettling, Pill, Ring } from "@/features/clinical/prescribe-card";
import { Seal, haptic } from "@/features/clinical/medication-parts";
import { capabilityLabels } from "@/features/encounter/conversation";
import { useEncounter } from "@/features/encounter/store";
import { api, errorText, requestId, useLive } from "@/features/live";
import { useServerEncounter } from "@/features/live/sync";
import { Arrive, Drafting, SampleLabel } from "@/components/sona/model-answer";
import { useLiveDraft } from "@/features/live/model-sync";
import { CareInvite } from "@/features/care-invite";
import { refreshServerData } from "@/features/live/server-day";
import { scheduleLine } from "@/features/check-ins/model";
import { refreshCheckIns } from "@/features/check-ins/state";
import { useFindings } from "@/features/live/findings-sync";
import type { Patient, PrescriptionCheck } from "@/features/encounter/types";
import { EMPTY_DISCHARGE, FOLLOW_UPS, LANGUAGES, discharge, dischargeChecks, formatMinutes, planFor, type DischargeState, type MedChange } from "./model";

/*
 * Discharge (after Arc Search's summarize): the visit page folds into a small card, sways gently
 * while Sona drafts, pins at the top, and the discharge card rises from below. Page scale 1 to
 * 0.62 on a spring (0.6 s, damping 0.82), a ±1.2° sway while drafting (calmer than the shot's
 * ±3.2°), then the card rises on a spring (0.8 s, damping 0.85) with its summary lines 40 ms
 * apart. Inside, the prescribe card's pattern: ring, only what blocks, each fixed where it sits,
 * a button that morphs into the discharge, and a receipt that stamps in the same card.
 */
const DRAFT_MS = 1700;
const TEAL = "#0F6E66";

export function DischargeScreen() {
  // The open visit is the one being discharged (updateEncounter writes to it).
  const { patient, encounters } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const discharged = Boolean(patient && encounters[patient.id]?.discharge?.dischargedAt);
  // Folding plays once per open; an already discharged patient opens straight on the receipt.
  const [drafted, setDrafted] = useState(reducedMotion || discharged);
  useEffect(() => {
    if (drafted) return;
    const timer = setTimeout(() => { setDrafted(true); AccessibilityInfo.announceForAccessibility("Discharge drafted"); }, DRAFT_MS);
    return () => clearTimeout(timer);
  }, [drafted]);
  if (!patient) return null;
  const answers = encounters[patient.id]?.requests.map(r => capabilityLabels[r.kind]) ?? [];

  return <View style={{ flex: 1, backgroundColor: palette.canvas }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Discharge</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={() => router.back()} style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,28,40,0.06)" }}>
          <Icon name="xmark" size={13} color={palette.ink} />
        </Pressable>
      </View>
      {drafted && <VisitChip patient={patient} answers={answers} animate={!reducedMotion && !discharged} />}
      {drafted && <DischargeCard patient={patient} animate={!reducedMotion && !discharged} />}
    </ScrollView>
    {!drafted && <FoldStage patient={patient} answers={answers} />}
  </View>;
}

/** The visit page, shrinking into a card and swaying while the discharge drafts. */
function FoldStage({ patient, answers }: { patient: Patient; answers: string[] }) {
  const { width } = useWindowDimensions();
  const scale = useSharedValue(1), tilt = useSharedValue(0), label = useSharedValue(0);
  useEffect(() => {
    scale.set(withDelay(150, withSpring(0.62, { duration: 600, dampingRatio: 0.82 })));
    const sway = (deg: number) => withTiming(deg, { duration: 260, easing: Easing.bezier(0.45, 0, 0.55, 1) });
    tilt.set(withDelay(700, withSequence(sway(-1.2), sway(1.2), sway(-0.8), sway(0.8), sway(0))));
    label.set(withDelay(600, withTiming(1, { duration: 260 })));
    // Lift off just before the card rises, so the page reads as having moved into it.
    const lift = setTimeout(() => { scale.set(withTiming(0.3, { duration: 240, easing: EASE_OUT })); label.set(withTiming(0, { duration: 160 })); }, DRAFT_MS - 240);
    return () => clearTimeout(lift);
  }, [scale, tilt, label]);
  const page = useAnimatedStyle(() => ({ opacity: scale.value < 0.4 ? (scale.value - 0.3) * 10 : 1, transform: [{ translateY: (1 - scale.value) * -120 }, { scale: scale.value }, { rotate: `${tilt.value}deg` }] }));
  const drafting = useAnimatedStyle(() => ({ opacity: label.value, transform: [{ translateY: (1 - label.value) * 6 }] }));
  return <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
    <Animated.View style={[{ width: width - 40 }, page]}>
      <Surface feature style={{ padding: 20, gap: 14, minHeight: 320 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar patient={patient} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.headline, color: palette.ink }}>{patient.name}</Text>
            <Text style={{ ...type.caption, color: palette.muted }}>{patient.subtitle} · {patient.time}</Text>
          </View>
        </View>
        <Text style={{ ...type.subhead, color: palette.ink }}>{patient.complaint}</Text>
        {(answers.length ? answers : ["Briefing", "Consultation"]).map((a, i) => <View key={`${a}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
          <Icon name="text.alignleft" size={13} color={palette.blue} />
          <Text style={{ ...type.subhead, color: palette.ink }}>{a}</Text>
        </View>)}
      </Surface>
    </Animated.View>
    <Animated.View style={[{ position: "absolute", bottom: "24%", flexDirection: "row", alignItems: "center", gap: 8 }, drafting]}>
      <Icon name="sparkles" size={14} color={palette.blue} />
      <Text style={{ ...type.subhead, fontWeight: "500", color: palette.muted }}>Drafting the discharge…</Text>
    </Animated.View>
  </View>;
}

function Avatar({ patient, size = 40 }: { patient: Patient; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(36,91,204,0.1)" }}>
    <Text style={{ fontSize: size * 0.36, fontWeight: "700", color: palette.blue }}>{patient.initials}</Text>
  </View>;
}

/** The folded visit, pinned above the discharge card (the shot's page preview). */
function VisitChip({ patient, answers, animate }: { patient: Patient; answers: string[]; animate: boolean }) {
  return <Animated.View entering={animate ? riseIn({ distance: -8, scale: 0.94, duration: 320 }) : undefined}>
    <Surface style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 20 }}>
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

export function Chip({ label, icon, onPress, strong = false }: { label: string; icon?: string; onPress: () => void; strong?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { haptic("select"); onPress(); }} hitSlop={6}
    style={{ alignSelf: "flex-start", height: 34, paddingHorizontal: 14, borderRadius: 17, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: strong ? palette.blue : "rgba(20,28,40,0.06)" }}>
    {icon && <Icon name={icon} size={12} color={strong ? palette.white : palette.ink} />}
    <Text style={{ fontSize: 14, fontWeight: "600", color: strong ? palette.white : palette.ink }}>{label}</Text>
  </Pressable>;
}

function DischargeCard({ patient, animate }: { patient: Patient; animate: boolean }) {
  const { encounters, updateEncounter } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const encounter = encounters[patient.id];
  const plan = planFor(patient);
  const state = encounter?.discharge ?? EMPTY_DISCHARGE;
  // An open incidental finding travels with the patient: it blocks until tracked or dismissed.
  const found = useFindings();
  const openFindings = found.findings.filter(f => f.encounterId === patient.encounterId && f.status === "open");
  const checks = dischargeChecks(state, plan, openFindings);
  const blocked = checks.filter(c => c.status === "blocked");
  const resolving = useSettling(blocked.map(c => c.id));
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  // The demo patient became fit a little before the card opened, so the saving reads the same at any hour.
  const [fitAt] = useState(() => new Date(Date.now() - plan.fitMinutesAgo * 60000));
  const { live, refresh } = useServerEncounter(patient);
  const { user } = useLive();
  const [serverError, setServerError] = useState<string>();
  // Live mode: the full summary and the leaflet in the chosen language are drafted by the server from this patient's record.
  const draft = useLiveDraft(patient.encounterId, state.language);

  if (!encounter) return null;
  const set = (change: Partial<DischargeState>) => {
    updateEncounter(value => ({ ...value, discharge: { ...(value.discharge ?? EMPTY_DISCHARGE), ...change } }));
    if (live) void api.discharge.update({ encounterId: patient.encounterId, ...change }).catch(e => setServerError(errorText(e)));
  };
  const done = state.dischargedAt ? new Date(state.dischargedAt) : undefined;
  const rows = checks.filter(c => c.status === "blocked" || resolving.has(c.id));
  const passed = checks.filter(c => c.status === "passed" && !resolving.has(c.id));
  const first = patient.name.split(" ")[0];
  const language = LANGUAGES.find(l => l.id === state.language) ?? LANGUAGES[0]!;
  const saved = state.savedMinutes ? formatMinutes(state.savedMinutes) : undefined;

  const go = () => {
    haptic("select"); setBusy(true); setServerError(undefined);
    if (live && user) {
      // The server decides: it refuses while anything blocks, and receipts once per request.
      api.discharge.request({ encounterId: patient.encounterId, requestId: requestId(), approvedBy: user.id })
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
    if (check.id === "gl") return encounter.claim?.status === "sent"
      ? <Text style={{ ...type.footnote, color: palette.muted }}>Sent · awaiting insurer</Text>
      : encounter.claim?.status === "queried"
        ? <View style={{ gap: 8 }}><Text selectable style={{ ...type.footnote, color: palette.amber }}>Insurer asks: {encounter.claim.query}</Text><Chip label="Answer and send again" icon="doc.text.magnifyingglass" strong onPress={() => router.push("/claim")} /></View>
        : <Chip label="Review codes and send" icon="doc.text.magnifyingglass" strong onPress={() => router.push("/claim")} />;
    if (check.id === "followup") return <View style={{ flexDirection: "row", gap: 8 }}>
      {FOLLOW_UPS.map(f => <Pill key={f.id} label={f.label} on={state.followUp === f.id} onPress={() => set({ followUp: f.id })} />)}
    </View>;
    if (check.id === "meds") return <View style={{ gap: 10 }}>
      {plan.meds.filter(m => m.change !== "unchanged").map(m => <View key={m.name} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <View style={{ width: 64, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: TAG[m.change].fill }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: TAG[m.change].ink }}>{TAG[m.change].label}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink, textDecorationLine: m.change === "stopped" ? "line-through" : "none" }}>{m.name}</Text>
          <Text style={{ ...type.caption, color: palette.muted }}>{m.detail}</Text>
        </View>
      </View>)}
      <Text style={{ ...type.caption, color: palette.muted }}>{plan.meds.filter(m => m.change === "unchanged").map(m => m.name).join(", ")} unchanged</Text>
      <Chip label="Confirm take-home list" strong onPress={() => set({ medsConfirmed: true })} />
    </View>;
    const finding = openFindings.find(f => check.id === `finding-${f.id}`);
    if (finding) return <Chip label="Track follow-up" icon="calendar.badge.plus" strong onPress={() => void found.track(finding)} />;
    return undefined;
  };

  const primary = busy ? "Freeing the bed…" : blocked.length ? `Resolve ${blocked.length} to discharge` : `Discharge ${first}`;
  const summary: [string, string][] = [["Diagnosis", plan.summary.diagnosis], ["Course", plan.summary.course], ["Plan", plan.summary.plan]];

  return <Animated.View entering={animate ? riseCard : undefined}>
    <Surface feature layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Ring done={checks.length - blocked.length} total={checks.length} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.overline, color: done ? TEAL : blocked.length ? palette.amber : palette.blue }}>{done ? "Discharged · simulation" : blocked.length ? `${blocked.length} left before discharge` : "Ready to discharge"}</Text>
          <Text style={{ ...type.headline, color: palette.ink }}>{patient.name} · {plan.bed}</Text>
          <Text style={{ ...type.caption, color: palette.muted }}>Fit for discharge since {fitAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
          {live && <Text style={{ ...type.caption, fontWeight: "700", color: palette.blue }}>Live · checked by the server</Text>}
        </View>
      </View>

      <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 8 }}>
        {summary.map(([label, value], i) => <Animated.View key={label} entering={animate ? riseIn({ delay: 180 + i * 40, distance: 10, duration: 320 }) : undefined} style={{ flexDirection: "row", gap: 12 }}>
          <Text style={{ ...type.overline, width: 72, paddingTop: 3, color: palette.muted }}>{label}</Text>
          <MarkedText text={value} style={{ ...type.subhead, flex: 1, color: palette.ink }} />
        </Animated.View>)}
        {full && <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(200)}><MarkedText text={draft.data?.summary ?? plan.full} style={{ ...type.footnote, color: palette.muted }} /></Animated.View>}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: full }} onPress={() => setFull(v => !v)} hitSlop={6} style={{ alignSelf: "flex-start", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{full ? "Show less" : "Read full"}</Text>
          <Icon name={full ? "chevron.up" : "chevron.right"} size={10} color={palette.blue} />
        </Pressable>
      </Animated.View>

      {!done && rows.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT}>
        {rows.map((check, i) => <BlockerRow key={check.id} check={check} n={i + 1} resolved={resolving.has(check.id)}>{fix(check)}</BlockerRow>)}
      </Animated.View>}

      {!done && passed.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="checkmark.circle.fill" size={13} color={TEAL} />
        <Text style={{ ...type.footnote, fontWeight: "600", color: TEAL }}>{blocked.length ? `${passed.length} checks passed` : `All ${passed.length} checks passed`}</Text>
      </Animated.View>}

      {!done && <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ ...type.overline, color: palette.muted }}>Patient leaflet</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {LANGUAGES.map(l => <Pill key={l.id} label={l.label} on={state.language === l.id} onPress={() => set({ language: l.id })} />)}
          </View>
        </View>
        <Animated.View key={state.language} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={{ padding: 12, gap: 6, borderRadius: 16, borderCurve: "continuous", backgroundColor: "rgba(20,28,40,0.04)" }}>
          {draft.loading ? <Drafting label={`Drafting the leaflet in ${language.name}…`} lines={2} />
            : <Arrive animate={Boolean(draft.data)}><Text selectable style={{ ...type.subhead, color: palette.ink }}>{draft.data?.leaflet ?? plan.leaflet[state.language]}</Text></Arrive>}
          <SampleLabel source={draft.data?.source} />
          {draft.error && <Text style={{ ...type.caption, color: palette.red }}>{draft.error} · showing the authored leaflet</Text>}
        </Animated.View>
      </Animated.View>}

      {(serverError ?? found.error) && <Text style={{ ...type.footnote, color: palette.red }}>{serverError ?? found.error}</Text>}
      <Animated.View layout={reducedMotion ? undefined : LAYOUT}>
      {done ? <Animated.View entering={reducedMotion ? FadeIn : FadeIn.duration(260)} style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 18, borderCurve: "continuous", backgroundColor: "rgba(15,110,102,0.08)" }}>
          <Seal stampDelay={reducedMotion ? undefined : 120} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{plan.bed} free{saved ? ` · ${saved} earlier than usual` : ""}</Text>
            <Text style={{ ...type.caption, color: palette.muted }}>2 follow-up tasks created · leaflet in {language.name} ready to print · {done.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
          <Icon name="bubble.left.and.bubble.right" size={13} color={palette.blue} />
          <Text style={{ ...type.caption, flex: 1, color: palette.muted }}><Text style={{ ...type.caption, fontWeight: "700", color: palette.ink }}>Check-ins</Text> · {scheduleLine(done)} · in {language.name} · simulated inbox</Text>
        </View>
        <CareInvite encounterId={patient.encounterId} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Chip label="View tasks" icon="checklist" onPress={() => { router.back(); setTimeout(() => router.push("/tasks"), 320); }} />
          <Chip label="Done" onPress={() => router.back()} />
        </View>
      </Animated.View>
        : <Pressable accessibilityRole="button" accessibilityState={{ disabled: blocked.length > 0 || busy }} disabled={blocked.length > 0 || busy} onPress={go}
          style={({ pressed }) => ({ height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: blocked.length ? "rgba(20,28,40,0.08)" : palette.ink, transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 200 } as never)}>
          {!blocked.length && <Icon name={busy ? "hourglass" : "bed.double"} size={15} color={palette.white} />}
          <Animated.Text key={primary} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={{ fontSize: 16, fontWeight: "600", color: blocked.length ? palette.muted : palette.white }}>{primary}</Animated.Text>
        </Pressable>}
      </Animated.View>
    </Surface>
  </Animated.View>;
}

/** The discharge card rising from below on a soft spring, as the shot's summary sheet does. */
function riseCard() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 140 }] },
    animations: { opacity: withTiming(1, { duration: 240 }), transform: [{ translateY: withSpring(0, { duration: 800, dampingRatio: 0.85 }) }] },
  };
}
