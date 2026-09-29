import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { LAYOUT } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { defaultMedications, getPrescriptionChecks, simulatedRegimen } from "@/features/encounter/clinical-state";
import { issueSimulation } from "@/features/encounter/state";
import { useEncounter } from "@/features/encounter/store";
import type { Patient, PrescriptionCheck, PrescriptionInputs } from "@/features/encounter/types";
import { errorText, useLive } from "@/features/live";
import { pushAndReview, simulateOnServer } from "@/features/live/prescribing-sync";
import { LockedAction, useRole } from "@/features/live/roles";
import { Seal, haptic } from "./medication-parts";

/*
 * One card for the whole prescribing job, so nothing navigates and no new answers stream in:
 * a progress ring and the regimen, then only what blocks it, each fixable where it sits (weight,
 * No/Yes history pills, an inline Run for the review). A resolved row does what Particle News'
 * checklist does: its number badge crossfades into a check with a small spring, a line draws
 * through the label and the text fades, then the row folds away. The ring fills and "N left"
 * counts down; the button morphs from "Resolve N" to "Prescribe", and the receipt stamps in here.
 */
const EMPTY: PrescriptionInputs = { weightKg: "", liverDisease: "unknown", kidneyDisease: "unknown", alcoholRisk: "unknown", paracetamolAllergy: "unknown" };
const HISTORY = ["paracetamolAllergy", "liverDisease", "kidneyDisease", "alcoholRisk"] as const;
const RING_R = 22, RING_C = 2 * Math.PI * RING_R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function Ring({ done, total }: { done: number; total: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const p = useSharedValue(done / total);
  useEffect(() => { p.set(reducedMotion ? done / total : withTiming(done / total, { duration: 520, easing: Easing.bezier(0.23, 1, 0.32, 1) })); }, [done, total, reducedMotion, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: RING_C * (1 - p.value) }));
  const left = total - done;
  return <View style={{ width: 56, height: 56, alignItems: "center", justifyContent: "center" }}>
    <Svg width={56} height={56} style={{ position: "absolute" }}>
      <Circle cx={28} cy={28} r={RING_R} stroke="rgba(20,28,40,0.08)" strokeWidth={5} fill="none" />
      <AnimatedCircle cx={28} cy={28} r={RING_R} stroke={left ? palette.blue : "#0F6E66"} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray={RING_C} animatedProps={props} transform="rotate(-90 28 28)" />
    </Svg>
    {left ? <Animated.Text key={left} entering={reducedMotion ? undefined : FadeIn.duration(200)} style={{ fontSize: 17, fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{left}</Animated.Text>
      : <Icon name="checkmark" size={18} color="#0F6E66" />}
  </View>;
}

export function Pill({ label, on, tone = "blue", onPress, a11y }: { label: string; on: boolean; tone?: "blue" | "amber"; onPress: () => void; a11y?: string }) {
  const ink = tone === "amber" ? palette.amber : palette.blue;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={a11y ?? label} onPress={() => { haptic("select"); onPress(); }} hitSlop={6}
    style={{ minWidth: 52, height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: on ? ink : "rgba(20,28,40,0.06)" }}>
    <Text style={{ fontSize: 14, fontWeight: "600", color: on ? palette.white : palette.ink }}>{label}</Text>
  </Pressable>;
}

/** A blocking check: number badge + label + its inline fix; once resolved it morphs to a check, strikes and folds away. */
export function BlockerRow({ check, n, resolved, children }: { check: PrescriptionCheck; n: number; resolved: boolean; children?: React.ReactNode }) {
  const { reducedMotion } = useAccessibleEffects();
  const done = useSharedValue(resolved ? 1 : 0), strike = useSharedValue(resolved ? 1 : 0);
  useEffect(() => {
    if (!resolved) { done.set(0); strike.set(0); return; }
    done.set(reducedMotion ? 1 : withSpring(1, { duration: 360, dampingRatio: 0.6 }));
    strike.set(reducedMotion ? 1 : withDelay(80, withTiming(1, { duration: 260, easing: Easing.bezier(0.23, 1, 0.32, 1) })));
  }, [resolved, reducedMotion, done, strike]);
  const numberStyle = useAnimatedStyle(() => ({ opacity: 1 - done.value, transform: [{ scale: 1 - done.value * 0.4 }] }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: done.value, transform: [{ scale: 0.6 + done.value * 0.4 }] }));
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: strike.value }] }));
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} exiting={reducedMotion ? undefined : FadeOut.duration(160)}
    accessible={!children} accessibilityLabel={`${check.label}. ${resolved ? "Resolved" : check.detail}`}
    style={{ flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
    <View style={{ width: 26, height: 26 }}>
      <Animated.View style={[{ position: "absolute", inset: 0, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(196,120,20,0.14)" }, numberStyle]}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: palette.amber, fontVariant: ["tabular-nums"] }}>{n}</Text>
      </Animated.View>
      <Animated.View style={[{ position: "absolute", inset: 0, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#0F6E66" }, checkStyle]}>
        <Icon name="checkmark" size={12} color={palette.white} />
      </Animated.View>
    </View>
    <View style={{ flex: 1, gap: 8 }}>
      <View style={{ gap: 2 }}>
        <View style={{ alignSelf: "flex-start" }}>
          <Text style={{ ...type.subhead, fontWeight: "600", color: resolved ? palette.muted : palette.ink, transitionProperty: "color", transitionDuration: 220 } as never}>{check.label}</Text>
          <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, right: 0, top: "52%", height: 1.5, borderRadius: 1, backgroundColor: palette.muted, transformOrigin: "left" }, lineStyle]} />
        </View>
        {!resolved && <Text style={{ ...type.caption, color: palette.muted }}>{check.detail}</Text>}
      </View>
      {!resolved && children}
    </View>
  </Animated.View>;
}

/**
 * Blockers that just passed, kept on screen long enough to play their resolve. A check that passed
 * this render counts at once (from the previous blocked set), so its row never unmounts in between.
 */
export function useSettling(blockedIds: string[]): Set<string> {
  const { reducedMotion } = useAccessibleEffects();
  const [settling, setSettling] = useState<string[]>([]);
  const last = useRef(new Set(blockedIds));
  const key = blockedIds.join(",");
  const fresh = [...last.current].filter(id => !blockedIds.includes(id));
  useEffect(() => {
    const now = new Set(key ? key.split(",") : []);
    const justPassed = [...last.current].filter(id => !now.has(id));
    last.current = now;
    if (!justPassed.length) return;
    haptic("select");
    setSettling(list => [...list, ...justPassed]);
    const timer = setTimeout(() => setSettling(list => list.filter(id => !justPassed.includes(id))), reducedMotion ? 300 : 900);
    return () => clearTimeout(timer);
  }, [key, reducedMotion]);
  return new Set([...settling, ...fresh]);
}

export function PrescribeCard({ patient }: { patient: Patient }) {
  const { encounters, updateEncounter, runInPlace, showDemoControls } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const encounter = encounters[patient.id];
  const [showPassed, setShowPassed] = useState(false);
  const checks = encounter ? getPrescriptionChecks(encounter, patient) : [];
  const resolving = useSettling(checks.filter(c => c.status === "blocked").map(c => c.id));
  const { on: live, user } = useLive();
  const [serverError, setServerError] = useState<string>();
  const role = useRole();

  if (!encounter) return null;
  // Live: the server records the review and re-checks everything before it writes the receipt; otherwise the local fixture runs.
  const run = (kind: "medication" | "prescription") => {
    if (!live || !user) return runInPlace(kind);
    const revision = encounter.revision;
    setServerError(undefined);
    updateEncounter(value => ({ ...value, working: kind }));
    const call = kind === "medication"
      ? pushAndReview(patient.encounterId, encounter).then(() => updateEncounter(value => value.revision === revision ? { ...value, working: undefined, medicationCheckedRevision: revision, reviewInvalidated: false } : { ...value, working: undefined }))
      : simulateOnServer(patient.encounterId, user.id).then(receipt => { updateEncounter(value => issueSimulation({ ...value, working: undefined }, patient, receipt.requestId)); haptic("success"); });
    call.catch(e => { setServerError(errorText(e)); updateEncounter(value => ({ ...value, working: undefined })); });
  };
  const inputs = encounter.prescriptionInputs ?? EMPTY;
  const set = (change: Partial<PrescriptionInputs>) => updateEncounter(value => ({ ...value, prescriptionInputs: { ...(value.prescriptionInputs ?? EMPTY), ...change } }), true);
  const blocked = checks.filter(c => c.status === "blocked");
  // The review goes last: answer everything else first, then review once.
  const last = (c: PrescriptionCheck) => (c.id === "review" ? 1 : 0);
  const rows = checks.filter(c => c.status === "blocked" || resolving.has(c.id)).sort((a, b) => last(a) - last(b));
  const passed = checks.filter(c => c.status === "passed" && !resolving.has(c.id));
  const prescription = encounter.prescription;
  const created = prescription?.status === "created" && prescription.revision === encounter.revision;
  const regimen = prescription?.regimen ?? simulatedRegimen;
  const working = encounter.working;
  const reviewStale = Boolean(encounter.reviewInvalidated) && encounter.medicationCheckedRevision !== encounter.revision;

  const fix = (check: PrescriptionCheck) => {
    if (check.id === "age-weight") return <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <TextInput accessibilityLabel="Weight in kilograms" value={inputs.weightKg} onChangeText={weightKg => set({ weightKg: weightKg.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" placeholder="Weight" placeholderTextColor="#8A929E"
        style={{ width: 96, height: 38, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, fontWeight: "600", color: palette.ink, backgroundColor: "rgba(20,28,40,0.05)" }} />
      <Text style={{ ...type.footnote, color: palette.muted }}>kg · 50 kg or more</Text>
    </View>;
    const key = HISTORY.find(k => k === check.id);
    if (key) return <View style={{ flexDirection: "row", gap: 8 }}>
      <Pill label="No" on={inputs[key] === "no"} onPress={() => set({ [key]: "no" })} />
      <Pill label="Yes" tone="amber" on={inputs[key] === "yes"} onPress={() => set({ [key]: "yes" })} />
    </View>;
    if (check.id === "review") return <Pressable accessibilityRole="button" accessibilityLabel="Run medication review" disabled={working !== undefined} onPress={() => { haptic("select"); run("medication"); }}
      style={{ alignSelf: "flex-start", height: 34, paddingHorizontal: 14, borderRadius: 17, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.blue, opacity: working ? 0.6 : 1 }}>
      <Icon name={working === "medication" ? "hourglass" : "arrow.clockwise"} size={12} color={palette.white} />
      <Text style={{ fontSize: 14, fontWeight: "600", color: palette.white }}>{working === "medication" ? "Reviewing…" : reviewStale ? "Rerun review" : "Run review"}</Text>
    </Pressable>;
    if (check.id === "identity") return <Pressable accessibilityRole="button" onPress={() => { const entry = (encounter.medicationEntries ?? defaultMedications(patient)).find(m => !m.confirmed); if (entry) updateEncounter(value => ({ ...value, medicationDraft: { ...entry } })); }}
      style={{ alignSelf: "flex-start", height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: "center", backgroundColor: "rgba(20,28,40,0.06)" }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>Confirm next medicine</Text>
    </Pressable>;
    return undefined;
  };
  const label = (check: PrescriptionCheck) => check.id === "review" && reviewStale ? { ...check, detail: "Needs rerun · eligibility or medicines changed since the last review." } : check;
  const primary = working === "prescription" ? "Checking all 11…" : blocked.length ? `Resolve ${blocked.length} to prescribe` : `Prescribe ${regimen.medication.toLowerCase()}`;

  return <Surface feature layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      <Ring done={checks.length - blocked.length} total={checks.length} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.overline, color: created ? "#0F6E66" : blocked.length ? palette.amber : palette.blue }}>{created ? "Prescribed · simulation" : blocked.length ? `${blocked.length} left before prescribing` : "Ready to prescribe"}</Text>
        <Text style={{ ...type.headline, color: palette.ink }}>{regimen.medication} · {regimen.formulation}</Text>
        <Text numberOfLines={2} style={{ ...type.caption, color: palette.muted }}>{regimen.dose} {regimen.unit} · {regimen.route} · {regimen.frequency}</Text>
      </View>
    </View>

    {!created && rows.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT}>
      {rows.map((check, i) => <BlockerRow key={check.id} check={label(check)} n={i + 1} resolved={resolving.has(check.id)}>{fix(check)}</BlockerRow>)}
    </Animated.View>}

    {!created && passed.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPassed }} onPress={() => setShowPassed(v => !v)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 }}>
        <Icon name="checkmark.circle.fill" size={13} color="#0F6E66" />
        <Text style={{ ...type.footnote, fontWeight: "600", color: "#0F6E66" }}>{passed.length} checks passed</Text>
        <Icon name={showPassed ? "chevron.up" : "chevron.right"} size={10} color="#0F6E66" />
      </Pressable>
      {showPassed && <Text style={{ ...type.caption, color: palette.muted, paddingLeft: 19 }}>{passed.map(c => c.label).join(" · ")}</Text>}
    </Animated.View>}

    <Animated.View layout={reducedMotion ? undefined : LAYOUT}>
    {created && prescription ? <Animated.View entering={reducedMotion ? FadeIn : FadeIn.duration(260)} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 18, backgroundColor: "rgba(15,110,102,0.08)" }}>
      <Seal stampDelay={reducedMotion ? undefined : 120} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>Simulated prescription created</Text>
        <Text style={{ ...type.caption, color: palette.muted }}>All {checks.length} checks passed · {new Date(prescription.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · immutable receipt, no dispensing</Text>
      </View>
    </Animated.View>
      : live && !role.can("prescribing.simulate") ? <LockedAction label="Needs a doctor to prescribe" path="prescribing.simulate" />
      : <Pressable accessibilityRole="button" accessibilityState={{ disabled: blocked.length > 0 || working !== undefined }} disabled={blocked.length > 0 || working !== undefined}
        onPress={() => { haptic("select"); run("prescription"); }}
        style={({ pressed }) => ({ height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: blocked.length ? "rgba(20,28,40,0.08)" : palette.ink, transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 200 } as never)}>
        {!blocked.length && <Icon name={working === "prescription" ? "hourglass" : "doc.badge.plus"} size={15} color={palette.white} />}
        <Animated.Text key={primary} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={{ fontSize: 16, fontWeight: "600", color: blocked.length ? palette.muted : palette.white }}>{primary}</Animated.Text>
      </Pressable>}
    </Animated.View>

    {live && !created && <Text style={{ ...type.caption, fontWeight: "700", color: palette.blue }}>Live · checked by the server</Text>}
    {serverError && <Text accessibilityLiveRegion="polite" style={{ ...type.caption, color: palette.amber }}>{serverError}</Text>}

    {!created && showDemoControls &&<Pressable accessibilityRole="button" onPress={() => updateEncounter(value => ({ ...value, prescriptionInputs: { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } }), true)} style={{ alignSelf: "center", minHeight: 32, justifyContent: "center" }}>
      <Text style={{ ...type.footnote, color: palette.blue }}>Demo · load synthetic eligibility</Text>
    </Pressable>}
  </Surface>;
}
