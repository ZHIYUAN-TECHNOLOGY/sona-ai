import { AmbientWash } from "@/components/sona/ambient";
import { ResponseFrame } from "@/components/sona/response-frame";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Notice, Reveal } from "@/components/sona/ui";
import { ClinicalResponseRenderer } from "@/features/presentation";
import { EdgeBlur } from "@/components/sona/edge-blur";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { capabilityLabels, Home, suggestionFor, thinkingLabel, TopBar, VisitEnd, VisitLead, type Suggestion } from "./conversation";
import { openTaskCount } from "@/features/day/counts";
import { useServerData } from "@/features/live/server-day";
import { api, useLive } from "@/features/live";
import { touch } from "@/features/patients/continue-store";
import { PLACEHOLDER, forWhichPatient, matchQuestion, suggestion } from "@/features/ask/answers";
import { useTodayAnswers } from "@/features/ask/today";
import { ThreadEntry, useTodayThread } from "@/features/ask/today-thread";
import { answerOf, clearThread } from "@/features/ask/thread";
import { capabilitySchema, routeInThread } from "./state";
import { carry, takeCarried } from "./carry";
import { openSession } from "./navigation";
import { useEncounter } from "./store";
import type { Capability, FeatureProps, FocusView, RequestState, ResponseCard } from "./types";
import { VoiceDock } from "./voice-dock";
import { Bubble, type LiveAdapter } from "./sona-live";
import { QuickRow } from "@/components/sona/quick-actions";
import { useServerEncounter } from "@/features/live/sync";
import { useHomeActions } from "./quick-actions";
import { defaultMedications } from "./clinical-state";
import { nextSteps, type Step } from "./next-steps";
import { NextStepBar, NextStepSheet, useNextStep } from "./next-step";
import { useCanPrescribe } from "@/features/clinical/prescribe-card";
import { entryFor } from "@/features/clinical/medicine-catalog";
import { useRole } from "@/features/live/roles";
import { AnswerSections, SectionTabs, type AnswerSection } from "@/components/sona/answer-kit";
import type { Attachment } from "@/components/sona/attachments-menu";
import { Sidebar, SIDEBAR_WIDTH } from "./sidebar";
import { useAccessibleEffects } from "@/components/sona/ui";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { OrbActivity } from "@/components/sona/orb-glyph";

const activities: Record<Capability, OrbActivity> = { briefing: "reading", reasoning: "solving", xray: "breathing", medication: "checking", prescription: "composing", followup: "connecting", note: "composing", evidence: "reading" };
const prompts: Record<Capability, string> = { briefing: "Brief me on this patient", reasoning: "What possibilities should I consider?", xray: "Review the chest X-ray", medication: "Review medication interactions", prescription: "Run the prescribing simulation", followup: "Prepare a follow-up plan", note: "Show the consultation note", evidence: "What does the evidence say about steroids?" };
const UNROUTED = "Try a briefing, clinical possibilities, X-ray, medication review, prescribing simulation, consultation note or follow-up plan.";

/**
 * One request's answer as a visit's thread shows it: its lead, its card as it streams, or why it stopped. Sona Live
 * shows the same without the lead (it says that above), and `leave` ends Live before the card opens anything else.
 * `onSections` feeds the pinned section tabs (the thread's latest answer only).
 */
function RequestAnswer({ req, card, revision, props, onRetry, lead = true, leave, onSections }: { req: RequestState; card?: ResponseCard; revision?: number; props?: FeatureProps; onRetry: () => void; lead?: boolean; leave?: () => void; onSections?: (list: AnswerSection[]) => void }) {
  const away = <A extends unknown[]>(go: (...args: A) => void) => (...args: A) => { leave?.(); go(...args); };
  const answerPatient = card?.patientSnapshot ?? props?.patient;
  const body = card && props && <ClinicalResponseRenderer kind={card.kind} sections={card.sections} loading={req.status === "streaming"} featureProps={{ ...props, onOpen: away(props.onOpen), onRequest: away(props.onRequest), patient: card.patientSnapshot ?? props.patient, result: card, onSource: away(id => router.push({ pathname: "/source", params: { id, patientId: props.patient.id, cardId: card.id } })) }} />;
  return <>
    {/* The lead summarises the card below, so there is none without a card (failed or stopped). */}
    {lead && card && answerPatient && <VisitLead req={req} card={card} patient={answerPatient} />}
    {card && body && <ResponseFrame partial={req.status === "streaming"}>
      <Reveal>{card.revision !== revision && <Notice>Earlier encounter revision {card.revision}. Its original context and sources are retained.</Notice>}{onSections ? <AnswerSections key={req.id} onChange={onSections}>{body}</AnswerSections> : body}</Reveal>
    </ResponseFrame>}
    {req.status === "failed" && <><Notice warning>{req.error}</Notice><Action secondary label="Retry request" onPress={away(onRetry)} /></>}
    {req.status === "cancelled" && <Notice>Response stopped. Completed content and your edits are kept.</Notice>}
  </>;
}

/**
 * `home`: the launchpad (greeting, today's visits); never shows answers and has no visit open.
 * `session`: one visit's conversation, pushed over home; swipe back returns home.
 */
export function WorkspaceScreen({ mode, sessionId }: { mode: "home" | "session"; sessionId?: string }) {
  const store = useEncounter();
  const { patients, encounters, request, runInPlace, cancel, voiceInput, compactResponses, selectPatient, leaveVisit, updateEncounter } = store;
  const home = mode === "home";
  const homeKeys = useHomeActions(patients, encounters); // live mode: follows the server's visits, tasks and results
  // Home ignores any visit another screen left selected; a session only ever shows its own visit.
  // Read straight from the route so the first frame of the push already shows this visit.
  const patient = home ? undefined : patients.find(p => p.id === sessionId);
  const encounter = patient ? encounters[patient.id] : undefined;
  useServerEncounter(patient); // live mode: the visit opens on the server's record, not the fixture
  const params = useLocalSearchParams<{ next?: string; prompt?: string; view?: string }>();
  const arrived = useRef(false);
  useFocusEffect(useCallback(() => {
    if (home) { leaveVisit(); return; }
    if (!sessionId) return;
    selectPatient(sessionId);
    // A question or tool page requested on the way in runs once, after the visit is open.
    if (arrived.current) return;
    arrived.current = true;
    const next = capabilitySchema.safeParse(params.next);
    if (next.success) request(next.data, params.prompt);
    const view = params.view;
    if (view === "recording" || view === "note" || view === "xray" || view === "tasks" || view === "scan" || view === "claim" || view === "discharge") setTimeout(() => router.push(`/${view}`), 320);
  }, [home, sessionId, leaveVisit, selectPatient, request, params.next, params.prompt, params.view]));
  const insets = useSafeAreaInsets();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = patient?.id ?? "unassigned";
  const input = drafts[draftKey] ?? "";
  const setInput = (value: string) => setDrafts(current => ({ ...current, [draftKey]: value }));
  const [showEarlier, setShowEarlier] = useState(false);
  const [notice, setNotice] = useState<string>();
  // Attachments picked in the dock wait here and go out with the next question.
  const [pending, setPending] = useState<Attachment[]>([]);
  const [scrolled, setScrolled] = useState(false);
  // Home: the quick-action grid collapses into a sticky row once it scrolls under the top bar.
  const scrollSV = useSharedValue(0);
  // The scroll offset where the grid's bottom meets the capsule's (capsule at top + 62, 44 pt tall), measured from the grid.
  const [shelfFrom, setShelfFrom] = useState(210);
  const [capsule, setCapsule] = useState(false);
  // The offset lives on the UI thread, so the shelf → capsule hand-off follows the finger every frame;
  // React only hears about the two booleans below when they flip.
  const onScroll = useAnimatedScrollHandler(event => { scrollSV.set(event.contentOffset.y); });
  useAnimatedReaction(() => scrollSV.value > 8, (now, before) => { if (now !== before) scheduleOnRN(setScrolled, now); });
  useAnimatedReaction(() => scrollSV.value > shelfFrom, (now, before) => { if (now !== before) scheduleOnRN(setCapsule, now); }, [shelfFrom]);
  // Sidebar: the page slides right to reveal it. A finger drives it, so springs carry velocity.
  const { reducedMotion } = useAccessibleEffects();
  const [drawer, setDrawer] = useState(false);
  const drawerP = useSharedValue(0);
  const DRAWER = { duration: 420, dampingRatio: 0.9 };
  const openDrawer = () => { Keyboard.dismiss(); setDrawer(true); if (process.env.EXPO_OS === "ios") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); drawerP.set(reducedMotion ? 1 : withSpring(1, DRAWER)); };
  const closeDrawer = () => { setDrawer(false); drawerP.set(reducedMotion ? 0 : withSpring(0, DRAWER)); };
  useEffect(() => { if (!drawer) return; const sub = BackHandler.addEventListener("hardwareBackPress", () => { closeDrawer(); return true; }); return () => sub.remove(); }, [drawer]);
  const dragClose = Gesture.Pan().activeOffsetX([-12, 12]).enabled(drawer)
    .onUpdate(e => { drawerP.set(Math.min(1, Math.max(0, 1 + e.translationX / SIDEBAR_WIDTH))); })
    .onEnd(e => {
      const shut = e.velocityX < -300 || drawerP.value < 0.6;
      drawerP.set(withSpring(shut ? 0 : 1, { ...DRAWER, velocity: e.velocityX / SIDEBAR_WIDTH }));
      if (shut) scheduleOnRN(setDrawer, false);
    });
  const pageStyle = useAnimatedStyle(() => {
    const p = drawerP.value;
    return {
      transform: [{ translateX: p * SIDEBAR_WIDTH }, { scale: interpolate(p, [0, 1], [1, 0.96]) }],
      borderRadius: interpolate(p, [0, 0.15], [0, 44], "clamp"),
      boxShadow: `-8px 0px ${interpolate(p, [0, 1], [0, 32])}px rgba(24,32,48,${interpolate(p, [0, 1], [0, 0.12])})`,
    };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: drawerP.value * 0.55 }));
  const [phase, setPhase] = useState<"thinking" | "working">("thinking");
  const [justDone, setJustDone] = useState(false);
  const scroll = useRef<ScrollView>(null);
  // Section tabs for the latest answer: sections register themselves; the active tab follows scrolling.
  const [sections, setSections] = useState<AnswerSection[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const TAB_TOP = insets.top + 58, READ_LINE = insets.top + 108;
  const syncTab = () => {
    if (sections.length < 2) return;
    Promise.all(sections.map(section => new Promise<number>(resolve => section.ref.current ? section.ref.current.measureInWindow((_x, y) => resolve(y)) : resolve(Infinity)))).then(ys => {
      let index = 0;
      ys.forEach((y, i) => { if (y <= READ_LINE + 24) index = i; });
      setActiveTab(index);
    });
  };
  const jumpTo = (index: number) => {
    const section = sections[index];
    if (!section?.ref.current) return;
    if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {});
    section.open?.();
    setActiveTab(index);
    section.ref.current.measureInWindow((_x, y) => scroll.current?.scrollTo({ y: Math.max(0, scrollSV.get() + y - READ_LINE), animated: !reducedMotion }));
  };
  const backdrop = useRef<View>(null);
  const offsets = useRef<Record<string, number>>({});
  const requests = encounter?.requests ?? [];
  const active = requests.find(r => r.status === "streaming");
  const latest = requests.at(-1);
  const activeCard = active && encounter?.cards.find(c => c.requestId === active.id);
  // Blur the canvas only until the first renderable section arrives.
  const thinking = active && !activeCard && patient ? (phase === "thinking" ? "Thinking…" : thinkingLabel(active.kind, patient)) : undefined;

  // "Next step" bar: the one action blocking the medication → prescribing path, with the full list on demand.
  const canPrescribe = useCanPrescribe();
  const steps = patient && latest && !active ? nextSteps(latest.kind, encounter, patient, canPrescribe) : undefined;
  const server = useServerData(); // live mode: the top bar counts the server's tasks too
  const next = useNextStep();
  const jumpToId = (id: string) => { const index = sections.findIndex(section => section.id === id); if (index >= 0) jumpTo(index); return index >= 0; };
  const perform = (step: Step) => {
    const action = step.action;
    if (!patient || !latest) return;
    if (action.type === "confirm") {
      const entry = (encounter?.medicationEntries ?? defaultMedications(patient)).find(item => item.id === action.entryId);
      if (latest.kind !== "medication" || !entry) { run("medication"); return; }
      updateEncounter(value => ({ ...value, medicationDraft: { ...entry } }));
      jumpToId("medicines");
      return;
    }
    // The card's own path (runInPlace, as its buttons use), in view so its result lands where it is reviewed. A locked step never runs.
    if (action.type === "run" && !step.locked) runInPlace(action.kind);
    jumpToId("prescribing");
  };
  const act = (step: Step) => next.open ? next.hide(() => perform(step)) : perform(step);

  const open = (view: FocusView) => { if (!patient) { router.push({ pathname: "/patients", params: { view } }); return; } router.push(`/${view}`); };
  const run = (kind: Capability, prompt = prompts[kind]) => { setNotice(undefined); if (!patient) { router.push({ pathname: "/patients", params: { next: kind, prompt } }); return; } const id = request(kind, prompt); Keyboard.dismiss(); return id; };
  // Open a session at its latest answer rather than the top of the thread. Earlier answers can
  // still settle (images, reveals) just after mount, so the landing follows them for a moment.
  const landedAt = useRef<number | undefined>(undefined);
  const pick = (item: Suggestion) => item.kind === "recording" ? open("recording") : run(item.kind, item.text);
  // Sona on Today: a question about the day (typed, dictated, the dock's ✦ suggestion or Sona Live) joins Today's thread,
  // shown in place of the dashboard; a clinical question opens the patient picker (run) and runs once a visit is chosen.
  const todayAnswers = useTodayAnswers();
  const today = useTodayThread(todayAnswers);
  const thread = home ? today.entries : [], newest = thread.at(-1);
  // The canvas holds a conversation (a visit's requests or Today's thread) rather than the dashboard.
  // A visit's answers sit on top of its tiles: back returns to the tiles (answers kept) before it leaves the visit, and
  // the next answer brings them back.
  const [tiles, setTiles] = useState(false);
  useEffect(() => { setTiles(false); }, [requests.length, patient?.id]);
  const talking = (requests.length > 0 && !tiles) || thread.length > 0;
  const backToTiles = !home && requests.length > 0 && !tiles;
  const back = () => { if (backToTiles) { setTiles(true); scroll.current?.scrollTo({ y: 0, animated: false }); } else if (router.canGoBack()) router.back(); else router.replace("/"); };
  // Android's back does the same; iOS's edge swipe would leave the visit, so it waits until the tiles show.
  const navigation = useNavigation();
  useEffect(() => { navigation.setOptions({ gestureEnabled: !backToTiles }); }, [backToTiles, navigation]);
  useEffect(() => { if (!backToTiles) return; const sub = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; }); return () => sub.remove(); }, [backToTiles]); // eslint-disable-line react-hooks/exhaustive-deps
  const nudge = home ? suggestion(todayAnswers) : undefined;
  const { on: live } = useLive();
  const { can } = useRole();
  // A notice answers the last input only: it clears on the next keystroke or submit, so it never hides the dock for good.
  // One send at a time: while a request is being routed, further taps on send do nothing (the text box is already empty).
  const routing = useRef(false);
  const [routingNow, setRoutingNow] = useState(false);
  // Laya asleep or slow: skip it for a minute and route by keywords, so a sleeping box never slows every question.
  const layaRestUntil = useRef(0);
  /** Which card answers a visit request: live mode asks Laya first (ask.route) for at most 2.5 s; keyword routing decides when it can't (no key, not covered, asleep or slow). */
  const route = async (prompt: string) => {
    const rest = () => { layaRestUntil.current = Date.now() + 60_000; return null; };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const picked = live && patient && Date.now() > layaRestUntil.current
      ? await Promise.race([
        api.ask.route({ request: prompt, patient: patient.subtitle }).then(r => (r.source === "model" ? (r.card ? r : null) : rest()), rest),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(rest()), 2500); }),
      ]).finally(() => clearTimeout(timer))
      : null;
    return { kind: picked?.card ?? routeInThread(prompt, encounter?.requests.at(-1)?.kind), medicine: picked?.medicine };
  };
  /** Runs a routed request. Laya also names the medicine asked about: its card opens in the review, ready to confirm (never over a draft being edited). */
  const runRouted = (kind: Capability, prompt: string, medicine?: string | null) => {
    const id = run(kind, prompt);
    const named = kind === "medication" && patient && medicine && can("encounter.edit") ? entryFor(medicine, encounter?.medicationEntries ?? defaultMedications(patient)) : undefined;
    if (named) updateEncounter(value => value.medicationDraft ? value : { ...value, medicationDraft: { ...named } });
    return id;
  };
  // On Today nothing reads a photo or file yet, so Sona asks whose they are: each patient row opens that visit with them waiting.
  const askForPatient = (question: string) => { carry(pending); setPending([]); return today.ask(question, forWhichPatient(question, patients)); };
  const submit = async (text: string) => { const prompt = text.trim(); if (!prompt || routing.current) return; setNotice(undefined);
    // A question about the day (the day's rules answer it, or no visit tool does) joins Today's thread, never the visit tools'
    // notice: live, the model answers it from Today's own data (ask.free), or says it is starting; demo mode says what Sona answers.
    if (!patient && pending.length) { setInput(""); void askForPatient(prompt); return; }
    if (!patient) { if (matchQuestion(prompt, todayAnswers) || !routeInThread(prompt)) { setInput(""); void today.ask(prompt); return; } }
    else if (pending.length) {
      // Images go to the imaging review (the first becomes the encounter's attachment); files and documents, scanned or photographed, are kept for reference.
      const image = pending.find(item => item.kind === "image" && item.imageType !== "Document");
      const files = pending.filter(item => item.kind === "file" || item.imageType === "Document");
      setPending([]);
      const fileNote = files.length ? `${files.map(f => f.name).join(", ")} kept for reference. Document review is not switched on yet.` : undefined;
      if (image) { updateEncounter(current => image.uri === "teaching" ? { ...current, imagingAttachment: undefined, hideTeachingImage: false } : { ...current, imagingAttachment: { uri: image.uri, name: image.name } }, true); run("xray", prompt); if (fileNote) setNotice(fileNote); return; }
      if (fileNote) setNotice(fileNote);
    }
    // The text box empties and the dock shows the request is being read at once, so nothing invites a second send.
    routing.current = true; setRoutingNow(true); setInput("");
    try {
      const { kind, medicine } = await route(prompt);
      if (!kind) { setInput(prompt); setNotice(`${UNROUTED} Demo routing uses supported phrases.`); return; }
      runRouted(kind, prompt, medicine);
    } finally { routing.current = false; setRoutingNow(false); }
  };

  // A visit opened for attachments sent from Today has them waiting, to go with its next question.
  useEffect(() => { setShowEarlier(false); setNotice(undefined); setPending(patient ? takeCarried() : []); if (!patient) setDrafts({}); }, [patient?.id]);
  // Working on a visit keeps it in Continue ("where you left off") for the next 24 h.
  useEffect(() => { if (!home && patient) touch(patient.id); }, [home, patient?.id, encounter?.requests.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!active) return; setPhase("thinking"); const timer = setTimeout(() => setPhase("working"), 320); return () => clearTimeout(timer); }, [active?.id]);
  useEffect(() => {
    if (latest?.status !== "complete") return;
    AccessibilityInfo.announceForAccessibility(`${capabilityLabels[latest.kind]} ready`);
    setJustDone(true); const timer = setTimeout(() => setJustDone(false), 1400); return () => clearTimeout(timer);
  }, [latest?.id, latest?.status]);
  // Bring each new answer to the top of the canvas as it resolves, like a fresh page.
  const latestCard = latest && encounter?.cards.find(c => c.requestId === latest.id);
  useEffect(() => {
    if (!latest || !latestCard) return;
    const y = offsets.current[latest.id]; // Relative to the answer column; offset by the content inset below the top bar.
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y + 8), animated: !reducedMotion });
  }, [latestCard?.id]);

  const props: FeatureProps | undefined = patient ? { patient, onSource: id => router.push({ pathname: "/source", params: { id, patientId: patient.id } }), onOpen: open, onRequest: run } : undefined;

  // Sona Live (a tap on the orb) is the page's voice. In a visit it routes as the dock does (Laya first, then keywords)
  // and its answer is the visit's own request, shown on the page as a typed one is.
  const encRef = useRef(encounters); encRef.current = encounters;
  /** Resolves once request `id` has its card or has ended (4 s at most), so Live knows Sona has answered. */
  const settled = (patientId: string, id: string) => new Promise<void>(resolve => {
    const until = Date.now() + 4000;
    const check = () => {
      const e = encRef.current[patientId], req = e?.requests.find(r => r.id === id);
      if (Date.now() > until || (req && (req.status !== "streaming" || e!.cards.some(c => c.requestId === id)))) resolve(); else setTimeout(check, 60);
    };
    check();
  });
  // The page's top bar.
  const bar = { patient, inEncounter: !home, openTasks: openTaskCount(patient ? [patient] : patients, encounters, server), onMenu: openDrawer,
    onBack: home ? undefined : back, onPatient: () => router.push({ pathname: "/patients", params: { switch: "1" } }), onTasks: () => router.push("/tasks"),
    onNew: thread.length ? () => { clearThread(); scroll.current?.scrollTo({ y: 0, animated: false }); } : undefined };
  const visitLive: LiveAdapter | undefined = patient && props && {
    scope: patient.name.split(" ")[0] ?? patient.name,
    ask: async question => {
      // Attachments from the dock's + menu go with the question, as `submit` sends them: an image to the imaging review;
      // files and documents are kept for reference, which the page says.
      const image = pending.find(item => item.kind === "image" && item.imageType !== "Document");
      const files = pending.filter(item => item.kind === "file" || item.imageType === "Document");
      if (pending.length) setPending([]);
      const fileNote = files.length ? `${files.map(f => f.name).join(", ")} kept for reference. Document review is not switched on yet.` : undefined;
      if (image) updateEncounter(current => image.uri === "teaching" ? { ...current, imagingAttachment: undefined, hideTeachingImage: false } : { ...current, imagingAttachment: { uri: image.uri, name: image.name } }, true);
      else if (fileNote) return { notice: fileNote };
      const { kind, medicine } = image ? { kind: "xray" as const, medicine: undefined } : await route(question);
      const id = kind ? runRouted(kind, question, medicine) : undefined;
      if (image && fileNote) setNotice(fileNote);
      if (!kind || !id) return { notice: UNROUTED };
      // The page shows the request as it shows a typed one (it brings the newest into view); Live waits for it to land.
      await settled(patient.id, id);
      return { shown: true };
    },
  };
  // The newest entry is brought into view as a visit brings in its new answer.
  const brought = useRef("");
  // The dock's height (bar, chip, notices, Live's draft), measured: the page's end clears it. 130 until it has laid out.
  const [dockH, setDockH] = useState(130);
  // On Today, a spoken question joins Today's thread as a typed one does: the page is the shell, and Live its voice.
  const todayLive: LiveAdapter = { scope: "Today", ask: async question => { await (pending.length ? askForPatient(question) : today.ask(question)); return { shown: true }; } };
  const visible = compactResponses && !showEarlier ? requests.slice(-1) : requests;
  const recording = encounter?.recording === "recording" || encounter?.recording === "paused";
  // Live mode records the room (scribe/live-recorder); the demo plays its sample consultation.
  const consultation = encounter?.recording === "paused" ? "paused" : live ? "recording" : "playing";

  return <View style={{ flex: 1, backgroundColor: palette.canvas }}>
    {home && <Sidebar open={drawer} progress={drawerP} onClose={closeDrawer} onNew={() => router.push("/patients")} />}
    <GestureDetector gesture={dragClose}>
    <Animated.View style={[{ flex: 1, overflow: "hidden", borderCurve: "continuous", backgroundColor: palette.canvas }, pageStyle]}>
    <View ref={backdrop} collapsable={false} accessibilityElementsHidden={drawer} importantForAccessibility={drawer ? "no-hide-descendants" : "auto"} style={{ flex: 1, backgroundColor: palette.canvas }}>
    <AmbientWash quiet={talking} thinking={Boolean(thinking) || thread.some(entry => !entry.reply)} />
    <Animated.ScrollView ref={scroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentInsetAdjustmentBehavior="never" scrollEventThrottle={16}
      onScroll={onScroll}
      onScrollEndDrag={syncTab} onMomentumScrollEnd={syncTab}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + (!home && sections.length >= 2 ? 112 : 72), paddingBottom: dockH + 32, flexGrow: 1 }}>
      {!talking ? <Home patient={patient} patients={patients} onPick={pick} onChoosePatient={() => router.push("/patients")} onSelectPatient={id => openSession(id)}
        onShelf={bottom => setShelfFrom(Math.max(0, Math.round(bottom + scrollSV.get() - (insets.top + 106))))} shelfCollapse={{ scroll: scrollSV, from: shelfFrom }} />
      : home ? <View style={{ gap: 44 }}>
        {thread.map(entry => <View key={entry.id} collapsable={false} onLayout={event => {
          const { y } = event.nativeEvent.layout;
          // Each new question, and its answer once it lands, comes into view.
          const key = `${entry.id}${entry.reply ? "+" : ""}`;
          if (entry.id === newest?.id && brought.current !== key) { brought.current = key; scroll.current?.scrollTo({ y: Math.max(0, y + 8), animated: !reducedMotion }); }
        }}><ThreadEntry entry={entry} fresh={entry.id === newest?.id} onAgain={() => today.again(entry)} /></View>)}
      </View>
      : <View style={{ gap: 44 }}>
        {compactResponses && requests.length > 1 && <Action label={showEarlier ? "Collapse earlier responses" : `Show ${requests.length - 1} earlier responses`} secondary onPress={() => setShowEarlier(value => !value)} />}
        {visible.map(req => <View key={req.id} collapsable={false} onLayout={event => {
          offsets.current[req.id] = event.nativeEvent.layout.y;
          if (req.id === latest?.id && requests.length > 1 && (landedAt.current === undefined || Date.now() - landedAt.current < 900)) {
            landedAt.current ??= Date.now();
            scroll.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y + 8), animated: false });
          }
        }} style={{ gap: 16, minHeight: req.id === latest?.id && req.status === "streaming" ? 320 : undefined }}>
          <Bubble text={req.prompt || prompts[req.kind]} />
          {/* Only the latest answer feeds the pinned tabs. */}
          <RequestAnswer req={req} card={encounter?.cards.find(c => c.requestId === req.id)} revision={encounter?.revision} props={props} onRetry={() => run(req.kind, req.prompt)}
            onSections={req.id === latest?.id ? list => { setSections([...list]); setActiveTab(0); } : undefined} />
        </View>)}
        {/* One next step at a time: the visit's need (the line it opened with), or handing over once nothing is left, then at most two quiet questions. */}
        {!active && latest && patient && <VisitEnd latest={latest.kind} patient={patient} encounter={encounter} hasSteps={Boolean(steps)} onPick={pick} />}
      </View>}
    </Animated.ScrollView>

    {talking && !home && sections.length >= 2 && !active && <View pointerEvents="box-none" style={{ position: "absolute", top: TAB_TOP, left: 0, right: 0, alignItems: "center", zIndex: 2 }}>
      <SectionTabs sections={sections} active={Math.min(activeTab, sections.length - 1)} onPick={jumpTo} />
    </View>}
    {home && !talking && <QuickRow actions={homeKeys} scroll={scrollSV} from={shelfFrom} top={insets.top + 62} />}
    <TopBar {...bar} faded={scrolled || talking} tall={home && !talking && capsule} />
    </View>

    {/* Everything passing under the dock blurs progressively and fades into the canvas (a frosted band as tall as the dock
        and its chip), so the bar's buttons always read over cards; at the end the page stops its last card above it. */}
    <EdgeBlur edge="bottom" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: dockH + 36 }} />
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: dockH + 36, experimental_backgroundImage: "linear-gradient(180deg, rgba(245,246,248,0) 0%, rgba(245,246,248,0.78) 45%, rgba(245,246,248,0.94) 100%)" }} />
    <VoiceDock
      backdrop={backdrop}
      onHeight={setDockH}
      sonaLive={patient ? visitLive : todayLive}
      quiet={Boolean(steps)}
      thinking={routingNow ? "Reading your request…" : thinking}
      activity={active ? (phase === "thinking" ? "searching" : activities[active.kind]) : justDone ? "done" : undefined}
      onCancel={cancel}
      onSubmit={submit}
      spokenPrompt={patient ? suggestionFor("briefing", patient).text : "Who am I seeing first?"}
      placeholder={patient ? `Ask about ${patient.name.split(" ")[0]}…` : PLACEHOLDER.today}
      draft={input}
      onDraft={value => { setInput(value); if (notice) setNotice(undefined); }}
      voiceEnabled={voiceInput}
      onVoiceDisabled={() => setNotice("Voice input is turned off in settings. Type your request instead.")}
      onVoiceError={setNotice}
      // The + on every page (Today asks whose they are); the visit's tools only inside a visit.
      attachments={pending} onAttachmentsChange={setPending}
      {...patient && { onImage: () => open("xray"), onConsultation: () => open("recording"), onNote: () => open("note") }}
      // The ✦ asks into Today's thread too; it steps aside while the newest entry already answers it.
      suggestion={nudge && answerOf(newest)?.id !== nudge.answer.id ? { text: nudge.text, onPress: () => void today.ask(nudge.answer.question, nudge.answer) } : undefined}
      above={<>
        {recording && <Pressable accessibilityRole="button" accessibilityLabel={`Consultation ${consultation}, ${encounter?.recordingSeconds} seconds`} accessibilityHint="Opens the consultation recorder" hitSlop={{ top: 2, bottom: 2 }} onPress={() => open("recording")} style={{ alignSelf: "center", minHeight: 40, paddingHorizontal: 16, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.white, boxShadow: "0 4px 14px rgba(24,32,48,0.1)" }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: encounter?.recording === "paused" ? palette.amber : palette.red }} /><Text style={{ ...type.footnote, fontWeight: "500", color: palette.ink, fontVariant: ["tabular-nums"] }}>Consultation {consultation} · {encounter?.recordingSeconds}s</Text>
        </Pressable>}
        {notice && <Notice>{notice}</Notice>}
        {steps && !drawer && <NextStepBar steps={steps} p={next.p} onExpand={next.show} onAct={act} />}
      </>}
    />
    {steps && next.open && <NextStepSheet steps={steps} p={next.p} onClose={() => next.hide()} onAct={act} />}
    {/* While open, the page is a quiet surface: it fades back and a tap anywhere closes it. */}
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.canvas }, dimStyle]} />
    {drawer && <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={closeDrawer} style={StyleSheet.absoluteFill} />}
    </Animated.View>
    </GestureDetector>
  </View>;
}


