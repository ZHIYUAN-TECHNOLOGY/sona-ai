import { authoredAnswer, isRehearsed } from "@sona-ai/domain/evidence";
import { router, useIsFocused } from "expo-router";
import { DrawnCheck } from "@/components/sona/parts";
import { EdgeBlur } from "@/components/sona/edge-blur";
import { MyDay } from "@/features/day";
import { QuickActions } from "@/components/sona/quick-actions";
import { canDischarge } from "@/features/discharge/model";
import { NEED_KEY, useHomeActions, visitNeed, visitTools, type VisitNeed } from "./quick-actions";
import { openSession } from "./navigation";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { useVisitTasks } from "@/features/live/server-day";
import { useAnsweredEvidence } from "@/features/live/evidence-sync";
import { useLive } from "@/features/live";
import { confirmedAllergy } from "@/features/day/counts";
import { usePendingResult } from "@/features/day/use-counts";
import { useXrayReading } from "@/features/imaging/use-upload";
import { teachingImage } from "@/features/imaging/fixture";
import { QuestionList } from "@/components/sona/list";
import { leadFor } from "./lead";
import { askAfter, threadEnd } from "./visit-next";
import { prescribingState } from "./next-steps";
import { useRole } from "@/features/live/roles";
import { useInboxSummary } from "@/features/inbox";
import { useEncounter } from "./store";
import { SweptLead, wordCount } from "@/components/sona/marked-text";
import { Chip, GlassButton, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { BrandIcon } from "@/components/sona/brand-icon";
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { EASE_OUT_CSS, LAYOUT, riseIn } from "@/components/sona/motion";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Capability, Encounter, Patient, RequestState, ResponseCard } from "./types";

export type Suggestion = { text: string; kind: Capability | "recording" };

export const capabilityLabels: Record<Capability, string> = { briefing: "Patient briefing", reasoning: "Clinical reasoning", xray: "Chest X-ray", medication: "Medication review", prescription: "Prescribing simulation", followup: "Follow-up plan", note: "Consultation note", evidence: "Evidence" };

const first = (patient: Patient) => patient.name.split(" ")[0];

export function suggestionFor(kind: Capability | "recording", patient: Patient): Suggestion {
  const name = first(patient);
  const text: Record<Capability | "recording", string> = {
    briefing: `What should I know before I see ${name}?`,
    reasoning: "What possibilities should I consider?",
    xray: `Review ${name}’s chest X-ray`,
    medication: `Check ${name}’s medicines for interactions`,
    prescription: "Run the prescribing simulation",
    followup: "Prepare a follow-up plan",
    note: "Show me the consultation note",
    evidence: `Should ${name} get steroids for this pneumonia?`,
    recording: "Start the consultation",
  };
  return { text: text[kind], kind };
}

/** Meets a visit's need: pages it names open directly; anything else is asked in the visit. */
export function goToNeed(target: VisitNeed["target"], patient: Patient, onPick: (item: Suggestion) => void) {
  if (target === "scan" || target === "discharge" || target === "claim" || target === "handover") router.push(`/${target}`);
  else onPick(suggestionFor(target, patient));
}

export function thinkingLabel(kind: Capability, patient: Patient) {
  const labels: Record<Capability, string> = { briefing: `Reading ${first(patient)}’s record…`, reasoning: "Weighing the history…", xray: "Opening the radiograph…", medication: "Checking the medicine list…", prescription: "Checking prerequisites…", followup: "Drafting next steps…", note: "Drafting the note…", evidence: "Reading the studies…" };
  return labels[kind];
}

/**
 * The one-line lead above an answer, built from the state its card shows (see lead.ts), so the two
 * never disagree; nothing when the card has nothing settled to summarise (a live search still running).
 */
export function VisitLead({ req, card, patient }: { req: RequestState; card: ResponseCard; patient: Patient }) {
  const text = useVisitLead(req, card, patient);
  return text ? <StreamedLead text={text} animate={req.status === "streaming"} /> : null;
}

/** VisitLead's sentence (Sona Live says it above the card); undefined without a card or while it has nothing settled. */
export function useVisitLead(req: RequestState | undefined, card: ResponseCard | undefined, patient: Patient | undefined) {
  const { encounters } = useEncounter();
  const encounter = patient && encounters[patient.id];
  const tasksOf = useVisitTasks();
  const { on: live } = useLive();
  const answered = useAnsweredEvidence().get(req?.id ?? "");
  const result = usePendingResult(patient?.id);
  // The X-ray lead follows the image model's reading when live mode has one (the same answer its card shows).
  const xrayImage = req?.kind === "xray" ? (card?.imagingSnapshot ?? encounter)?.imagingAttachment?.uri : undefined;
  const xrayRead = useXrayReading(patient?.encounterId ?? "", xrayImage);
  if (!req || !card || !patient) return undefined;
  // The X-ray card reads its own snapshot; the prescribing card follows the encounter while it is the latest answer.
  const image = card.imagingSnapshot ?? encounter;
  const scenario = image?.imagingScenario ?? "reference";
  const rx = encounter && encounter.cards.at(-1)?.id === card.id ? prescribingState(encounter, patient) : card.prescription?.status;
  const tasks = encounter ? tasksOf(patient) : [];
  const question = req.prompt;
  return leadFor(req.kind, patient, {
    medicines: encounter?.medicationEntries ?? [],
    allergyConfirmed: Boolean(confirmedAllergy(encounter)),
    image: scenario === "unsupported" ? "unsupported" : image?.imagingAttachment ? (xrayRead?.data?.source === "model" ? "read" : "attached") : scenario === "no-finding" ? "no-finding" : !image?.hideTeachingImage && teachingImage?.referenceSummary ? "reference" : "none",
    note: !encounter?.note ? "none" : encounter.noteReviewed ? "reviewed" : "draft",
    prescription: rx,
    tasks: { total: tasks.length, open: tasks.filter(t => !t.completed).length },
    evidence: live ? answered && (answered.enough ? "enough" : answered.general ? "general" : "not-enough") : !question || isRehearsed(question) ? "rehearsed" : authoredAnswer(question) ? "authored" : "off",
    bottomLine: live ? answered?.bottomLine : authoredAnswer(question)?.bottomLine,
    result: result?.patientId === patient.id ? { test: result.test } : undefined,
  }, question);
}

/** The end of a visit's thread: its one next step, then at most two quiet questions (visit-next.ts). */
export function VisitEnd({ latest, patient, encounter, hasSteps, onPick }: { latest: Capability; patient: Patient; encounter: Encounter | undefined; hasSteps: boolean; onPick: (item: Suggestion) => void }) {
  const end = threadEnd({ latest, need: visitNeed(patient, encounter, usePendingResult(patient.id)), hasSteps, firstName: first(patient), discharged: Boolean(encounter?.discharge?.dischargedAt), follow: askAfter(latest, patient, encounter) });
  if (!end.need && !end.ask.length) return null;
  return <View style={{ gap: 18, paddingTop: 28, marginTop: 8, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
    {end.need && <NeedLine need={end.need as VisitNeed} onPress={n => goToNeed(n.target, patient, onPick)} />}
    <QuestionList title="Also ask" questions={end.ask.map(k => ({ key: k, text: suggestionFor(k, patient).text }))} onAsk={k => onPick(suggestionFor(k as Capability, patient))} />
  </View>;
}

/** Words arrive in a quick sweep, the way Monogram's answers settle in. */
export function StreamedLead({ text, animate }: { text: string; animate: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  const words = { length: wordCount(text) };
  const [shown, setShown] = useState(animate && !reducedMotion ? 0 : words.length);
  useEffect(() => {
    if (shown >= words.length) return;
    const timer = setTimeout(() => setShown(count => Math.min(words.length, count + 2)), 45);
    return () => clearTimeout(timer);
  }, [shown, words.length]);
  // Key terms become chips; a highlight sweeps across them once a fresh answer finishes streaming.
  return <SweptLead text={text} shown={shown} sweep={animate && !reducedMotion} style={{ ...type.title, color: palette.ink }} />;
}

/** The top bar's buttons: the shell's liquid glass button, as the bar's below. */
function Round({ children, label, onPress }: { children: ReactNode; label: string; onPress: () => void }) {
  return <GlassButton label={label} onPress={onPress} size={44}>{children}</GlassButton>;
}

/** Floating header: menu on the left, the patient in context on the right. Content scrolls beneath a soft fade. */
/**
 * Floating header: menu on the left; patient messages and follow-up tasks on the right (what a clinician checks
 * between patients; on Today, messages are a key instead). Inside an encounter, the patient chip joins it so every answer's subject stays visible.
 */
export function TopBar({ patient, inEncounter, openTasks, faded, under = 0, onMenu, onBack, onPatient, onTasks, onNew }: { patient?: Patient; inEncounter: boolean; openTasks: number; faded: boolean; under?: number; onMenu: () => void; onBack?: () => void; onPatient: () => void; onTasks: () => void; onNew?: () => void }) {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  return <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
    <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top + 84 + under, opacity: faded ? 1 : 0, transitionProperty: "opacity", transitionDuration: 200, transitionTimingFunction: EASE_OUT_CSS }}>
      <EdgeBlur edge="top" style={{ flex: 1 }} />
    </Animated.View>
    <View pointerEvents="box-none" style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      {/* Home opens the menu; a session goes back to home (swiping from the edge does the same). */}
      {onBack ? <Round label="Back" onPress={onBack}><BrandIcon name="back" size={22} /></Round> : <Round label="Menu" onPress={onMenu}><BrandIcon name="menu" size={22} /></Round>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {/* Today with a conversation: start a fresh one, and the day's dashboard comes back. */}
        {onNew && <Animated.View entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 6, scale: 0.96, duration: 240 })}>
          <Round label="New conversation" onPress={onNew}><View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}><Icon name="plus.bubble" size={20} /></View></Round>
        </Animated.View>}
        {patient && inEncounter && <Animated.View entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 6, scale: 0.96, duration: 240 })}>
          <Round label={`Current patient ${patient.name}, ${patient.id}. Change patient`} onPress={onPatient}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.blueWash, alignItems: "center", justifyContent: "center" }}><Text style={{ ...type.caption, fontWeight: "600", color: palette.blue }}>{patient.initials}</Text></View>
              <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{patient.name.split(" ")[0]}</Text>
            </View>
          </Round>
        </Animated.View>}
        <InboxButton home={!inEncounter} />
        <Round label={openTasks ? `Follow-up tasks, ${openTasks} open` : "Follow-up tasks"} onPress={onTasks}>
          <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}><BrandIcon name="tasks" size={22} /></View>
          {openTasks > 0 && <View accessibilityElementsHidden style={{ position: "absolute", top: -3, right: -3, minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: palette.blue, borderWidth: 2, borderColor: palette.white, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ ...type.overline, color: palette.white, fontVariant: ["tabular-nums"] }}>{openTasks}</Text>
          </View>}
        </Round>
      </View>
    </View>
  </View>;
}

/**
 * Patient messages (Sona Care): the count is threads waiting for a reply, red when any is urgent. Live mode, for roles that read them.
 * Today's Messages key already carries it there (management's keys don't, so its bar keeps it).
 */
function InboxButton({ home }: { home: boolean }) {
  const { on, waiting: count, urgent, line } = useInboxSummary();
  const keyed = useRole().role !== "management" && home;
  if (!on || keyed) return null;
  return <Round label={count ? `Patient messages, ${line}` : "Patient messages"} onPress={() => router.push("/inbox")}>
    <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}><BrandIcon name="feedback" size={22} /></View>
    {count > 0 && <View accessibilityElementsHidden style={{ position: "absolute", top: -3, right: -3, minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: urgent ? palette.red : palette.blue, borderWidth: 2, borderColor: palette.white, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ ...type.overline, color: palette.white, fontVariant: ["tabular-nums"] }}>{count}</Text>
    </View>}
  </Round>;
}

function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening."; }

/** Idle canvas: one greeting, one line of context, a couple of starting points. */
export function Home({ patient, patients, onPick, onChoosePatient, onSelectPatient }: { patient?: Patient; patients: Patient[]; onPick: (item: Suggestion) => void; onChoosePatient: () => void; onSelectPatient: (id: string) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const { encounters } = useEncounter();
  const result = usePendingResult(patient?.id); // the same result Today and Patients flag
  const homeKeys = useHomeActions(patients, encounters);
  const canScan = useRole().can("scan.read");
  const rise = (i: number) => reducedMotion ? undefined : riseIn({ delay: 80 + i * 70, distance: 14, duration: 460 });
  // Reading order top-down: greeting under the top bar, then the next section at a fixed rhythm.
  // Nothing is centred or pinned to the bottom, so the gap never stretches with screen height.
  // Without a visit, the greeting and the ranked day are one section: MyDay owns the header.
  if (!patient) return <View style={{ paddingTop: 20 }}><MyDay patients={patients} greeting={greeting().replace(/\.$/, "")} onOpen={(id, open) => openSession(id, open)}
    actions={homeKeys} /></View>;
  // Glance to decision: who and when in one line, the one next step with its action (the screen's one
  // feature card), every tool in view as the sheet's keys in the order it's used, then two questions worth asking.
  const encounter = encounters[patient.id], name = first(patient);
  const discharged = Boolean(encounter?.discharge?.dischargedAt);
  const need: VisitNeed = visitNeed(patient, encounter, result)
    ?? { tone: "calm", text: discharged ? `${name} is discharged · hand over when you’re done` : `Nothing needs ${name} now`, action: "Hand over", target: "handover" };
  const go = (target: VisitNeed["target"]) => goToNeed(target, patient, onPick);
  const tools = new Map(visitTools(patient, encounter, result, go, canScan, canDischarge(patient)).map(t => [t.key, t]));
  // Before the visit, during it, wrap up; the key that repeats the Next step's action is left out.
  const keys = ["brief", "meds", "xray", "consult", "note", "scan", "discharge"].flatMap(k => k === NEED_KEY[need.target] ? [] : tools.get(k) ?? []);
  const ask = askAfter("briefing", patient, encounter).slice(0, 2);
  return <View style={{ gap: 28, paddingTop: 20 }}>
    <Animated.View entering={rise(0)}>
      <Text accessibilityRole="header" style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>
        {/* A ward patient's record can be sparse (no subtitle, no appointment time): only the parts it has, so no separator trails. */}
        <Text style={{ fontWeight: "600", color: palette.ink }}>{patient.name}</Text>{[patient.age, patient.subtitle, patient.time].filter(part => part != null && part !== "").map(part => ` · ${part}`).join("")}
      </Text>
    </Animated.View>
    <Animated.View entering={rise(1)}>
      <Surface feature style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 8 }}>
        <Text style={{ ...type.overline, color: palette.muted }}>Next step</Text>
        <NeedLine need={need} onPress={shown => go(shown.target)} />
      </Surface>
    </Animated.View>
    {/* Tasks sit in the top bar on every page; discharge shows only when there's a plan. */}
    <Animated.View entering={rise(2)} layout={reducedMotion ? undefined : LAYOUT}>
      <QuickActions animate={false} actions={keys} />
    </Animated.View>
    {ask.length > 0 && <Animated.View entering={rise(3)}>
      <QuestionList title="Try asking" questions={ask.map(k => ({ key: k, text: suggestionFor(k, patient).text }))} onAsk={k => onPick(suggestionFor(k as Capability, patient))} />
    </Animated.View>}
  </View>;
}

const NEED_INK: Record<VisitNeed["tone"], string> = { urgent: palette.red, caution: palette.amber, calm: palette.blue };
const RESOLVED_MS = 720, TEAL = palette.green;
/**
 * One line, no card: a state dot, what needs doing and the action that does it. When the need is met
 * (after Google's to-do check: the dot shrinks away, a teal check springs in and draws), the line holds
 * a beat, then crossfades to the next need, or leaves and the tiles below close the gap on the layout
 * spring. A change that lands while another screen covers this one waits until it is visible again.
 */
export function NeedLine({ need, entering, onPress }: { need?: VisitNeed; entering?: ReturnType<typeof riseIn>; onPress: (need: VisitNeed) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const focused = useIsFocused();
  const [shown, setShown] = useState(need);
  const [resolved, setResolved] = useState(false);
  const [first, setFirst] = useState(true);
  useEffect(() => {
    if (need?.text === shown?.text || !focused) return;
    setFirst(false);
    // Met, not merely preempted: it went away, or the next need is a different job that isn't more urgent.
    const met = shown && (!need || (need.target !== shown.target && need.tone !== "urgent"));
    if (!met || reducedMotion) { setShown(need); return; }
    setResolved(true);
    const timer = setTimeout(() => { setResolved(false); setShown(need); }, RESOLVED_MS);
    return () => clearTimeout(timer);
  }, [need?.text, shown?.text, focused, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps -- `need` is rebuilt every render; its text is its identity
  if (!shown) return null;
  return <Animated.View key={shown.text} entering={reducedMotion ? undefined : first ? entering : riseIn({ distance: 8, duration: 380 })} exiting={reducedMotion ? undefined : FadeOut.duration(160)}
    style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
    <View style={{ width: 8, height: 8, alignItems: "center", justifyContent: "center" }}>
      {resolved ? <Animated.View entering={ZoomIn.springify().duration(320).dampingRatio(0.72)} style={{ position: "absolute", width: 20, height: 20 }}>
        <DrawnCheck size={20} color={TEAL} strokeWidth={2.6} delay={60} />
      </Animated.View> : <Animated.View exiting={reducedMotion ? undefined : ZoomOut.duration(140)} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: NEED_INK[shown.tone] }} />}
    </View>
    <Animated.Text style={{ flex: 1, ...type.subhead, fontWeight: "500", color: resolved ? palette.muted : palette.ink, transitionProperty: "color", transitionDuration: 200 } as never}>{shown.text}</Animated.Text>
    <Chip label={shown.action} filled accessibilityLabel={`${shown.action}. ${shown.text}`} onPress={() => onPress(shown)} />
  </Animated.View>;
}
