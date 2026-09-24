import { AmbientWash } from "@/components/sona/ambient";
import { ResponseFrame } from "@/components/sona/response-frame";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Notice, Reveal } from "@/components/sona/ui";
import { ClinicalResponseRenderer } from "@/features/presentation";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { capabilityLabels, followUpsFor, Home, leadFor, StreamedLead, SuggestionList, suggestionFor, thinkingLabel, TopBar, type Suggestion } from "./conversation";
import { capabilitySchema, routePrompt } from "./state";
import { openSession } from "./navigation";
import { useEncounter } from "./store";
import type { Capability, FeatureProps, FocusView } from "./types";
import { VoiceDock } from "./voice-dock";
import { AnswerSections, SectionTabs, type AnswerSection } from "@/components/sona/answer-kit";
import type { Attachment } from "@/components/sona/attachments-menu";
import { Sidebar, SIDEBAR_WIDTH } from "./sidebar";
import { useAccessibleEffects } from "@/components/sona/ui";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { OrbActivity } from "@/components/sona/orb-glyph";

const activities: Record<Capability, OrbActivity> = { briefing: "reading", reasoning: "solving", xray: "breathing", medication: "checking", prescription: "composing", followup: "connecting", note: "composing" };
const prompts: Record<Capability, string> = { briefing: "Brief me on this patient", reasoning: "What possibilities should I consider?", xray: "Review the chest X-ray", medication: "Review medication interactions", prescription: "Run the prescribing simulation", followup: "Prepare a follow-up plan", note: "Show the consultation note" };

/**
 * `home`: the launchpad (greeting, today's visits); never shows answers and has no visit open.
 * `session`: one visit's conversation, pushed over home; swipe back returns home.
 */
export function WorkspaceScreen({ mode, sessionId }: { mode: "home" | "session"; sessionId?: string }) {
  const store = useEncounter();
  const { patients, encounters, request, cancel, voiceInput, compactResponses, selectPatient, leaveVisit, updateEncounter } = store;
  const home = mode === "home";
  // Home ignores any visit another screen left selected; a session only ever shows its own visit.
  // Read straight from the route so the first frame of the push already shows this visit.
  const patient = home ? undefined : patients.find(p => p.id === sessionId);
  const encounter = patient ? encounters[patient.id] : undefined;
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
    if (view === "recording" || view === "note" || view === "xray" || view === "tasks") setTimeout(() => router.push(`/${view}`), 320);
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
  const scrollY = useRef(0);
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
    section.ref.current.measureInWindow((_x, y) => scroll.current?.scrollTo({ y: Math.max(0, scrollY.current + y - READ_LINE), animated: !reducedMotion }));
  };
  const backdrop = useRef<View>(null);
  const offsets = useRef<Record<string, number>>({});
  const requests = encounter?.requests ?? [];
  const active = requests.find(r => r.status === "streaming");
  const latest = requests.at(-1);
  const activeCard = active && encounter?.cards.find(c => c.requestId === active.id);
  // Blur the canvas only until the first renderable section arrives.
  const thinking = active && !activeCard && patient ? (phase === "thinking" ? "Thinking…" : thinkingLabel(active.kind, patient)) : undefined;

  const open = (view: FocusView) => { if (!patient) { router.push({ pathname: "/patients", params: { view } }); return; } router.push(`/${view}`); };
  const run = (kind: Capability, prompt = prompts[kind]) => { setNotice(undefined); if (!patient) { router.push({ pathname: "/patients", params: { next: kind, prompt } }); return; } request(kind, prompt); Keyboard.dismiss(); };
  // Open a session at its latest answer rather than the top of the thread. Earlier answers can
  // still settle (images, reveals) just after mount, so the landing follows them for a moment.
  const landedAt = useRef<number | undefined>(undefined);
  const pick = (item: Suggestion) => item.kind === "recording" ? open("recording") : run(item.kind, item.text);
  const submit = (text: string) => { const prompt = text.trim(); if (!prompt) return; if (!patient) { setNotice("Pick a visit first. Today’s visits are listed above."); return; }
    if (pending.length) {
      // Images go to the imaging review (the first becomes the encounter's attachment); files are kept for reference.
      const image = pending.find(item => item.kind === "image");
      const files = pending.filter(item => item.kind === "file");
      setPending([]);
      const fileNote = files.length ? `${files.map(f => f.name).join(", ")} kept for reference. Document review arrives with the backend.` : undefined;
      if (image) { updateEncounter(current => image.uri === "teaching" ? { ...current, imagingAttachment: undefined, hideTeachingImage: false } : { ...current, imagingAttachment: { uri: image.uri, name: image.name } }, true); run("xray", prompt); if (fileNote) setNotice(fileNote); return; }
      if (fileNote) setNotice(fileNote);
    } const kind = routePrompt(prompt); if (!kind) { setNotice("Try a briefing, clinical possibilities, X-ray, medication review, prescribing simulation, consultation note or follow-up plan. Demo routing uses supported phrases."); return; } setInput(""); run(kind, prompt); };

  useEffect(() => { setShowEarlier(false); setNotice(undefined); setPending([]); if (!patient) setDrafts({}); }, [patient?.id]);
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
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y + 8), animated: true });
  }, [latestCard?.id]);

  const props: FeatureProps | undefined = patient ? { patient, onSource: id => router.push({ pathname: "/source", params: { id, patientId: patient.id } }), onOpen: open, onRequest: run } : undefined;
  const visible = compactResponses && !showEarlier ? requests.slice(-1) : requests;
  const recording = encounter?.recording === "recording" || encounter?.recording === "paused";

  return <View style={{ flex: 1, backgroundColor: "#F1F2F4" }}>
    {home && <Sidebar progress={drawerP} onClose={closeDrawer} onNew={() => router.push("/patients")} />}
    <GestureDetector gesture={dragClose}>
    <Animated.View style={[{ flex: 1, overflow: "hidden", borderCurve: "continuous", backgroundColor: palette.canvas }, pageStyle]}>
    <View ref={backdrop} collapsable={false} style={{ flex: 1, backgroundColor: palette.canvas }}>
    <AmbientWash quiet={requests.length > 0} thinking={Boolean(thinking)} />
    <ScrollView ref={scroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentInsetAdjustmentBehavior="never" scrollEventThrottle={48}
      onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; const next = scrollY.current > 8; if (next !== scrolled) setScrolled(next); }}
      onScrollEndDrag={syncTab} onMomentumScrollEnd={syncTab}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + (!home && sections.length >= 2 ? 112 : 72), paddingBottom: insets.bottom + 150, flexGrow: 1 }}>
      {!requests.length ? <Home patient={patient} patients={patients} onPick={pick} onChoosePatient={() => router.push("/patients")} onSelectPatient={id => openSession(id)} />
      : <View style={{ gap: 44 }}>
        {compactResponses && requests.length > 1 && <Action label={showEarlier ? "Collapse earlier responses" : `Show ${requests.length - 1} earlier responses`} secondary onPress={() => setShowEarlier(value => !value)} />}
        {visible.map(req => {
          const card = encounter?.cards.find(c => c.requestId === req.id);
          const answerPatient = card?.patientSnapshot ?? patient;
          const resolved = Boolean(card) || req.status !== "streaming";
          return <View key={req.id} collapsable={false} onLayout={event => {
            offsets.current[req.id] = event.nativeEvent.layout.y;
            if (req.id === latest?.id && requests.length > 1 && (landedAt.current === undefined || Date.now() - landedAt.current < 900)) {
              landedAt.current ??= Date.now();
              scroll.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y + 8), animated: false });
            }
          }} style={{ gap: 16, minHeight: req.id === latest?.id && req.status === "streaming" ? 320 : undefined }}>
            <Text selectable style={{ fontSize: 14, lineHeight: 19, color: palette.muted }}>{req.prompt || prompts[req.kind]}</Text>
            {resolved && answerPatient && <StreamedLead text={leadFor(req.kind, answerPatient)} animate={req.status === "streaming"} />}
            {card && props && <ResponseFrame pending={false} partial={req.status === "streaming"} onCancel={cancel} onSource={() => router.push({ pathname: "/source", params: { id: "history", patientId: patient!.id, cardId: card.id } })}>
              <Reveal>{card.revision !== encounter?.revision && <Notice>Earlier encounter revision {card.revision}. Its original context and sources are retained.</Notice>}{(() => { const body = <ClinicalResponseRenderer kind={card.kind} sections={card.sections} loading={req.status === "streaming"} featureProps={{ ...props, patient: card.patientSnapshot ?? props.patient, result: card, onSource: id => router.push({ pathname: "/source", params: { id, patientId: props.patient.id, cardId: card.id } }) }} />;
                // Only the latest answer feeds the pinned tabs.
                return req.id === latest?.id ? <AnswerSections key={req.id} onChange={list => { setSections([...list]); setActiveTab(0); }}>{body}</AnswerSections> : body; })()}</Reveal>
            </ResponseFrame>}
            {req.status === "failed" && <><Notice warning>{req.error}</Notice><Action secondary label="Retry request" onPress={() => run(req.kind, req.prompt)} /></>}
            {req.status === "cancelled" && <Notice>Response stopped. Completed content and your edits are kept.</Notice>}
          </View>;
        })}
        {!active && latest && patient && <View style={{ marginHorizontal: -20, paddingHorizontal: 20, paddingTop: 32, paddingBottom: 28, gap: 16, backgroundColor: "rgba(232,235,240,0.55)" }}>
          <Text accessibilityRole="header" style={{ textAlign: "center", ...type.headline, color: palette.ink, letterSpacing: -0.3 }}>You might want to ask</Text>
          <SuggestionList items={followUpsFor(latest.kind, patient)} onPick={pick} />
        </View>}
      </View>}
    </ScrollView>

    {!home && sections.length >= 2 && !active && <View pointerEvents="box-none" style={{ position: "absolute", top: TAB_TOP, left: 0, right: 0, alignItems: "center", zIndex: 2 }}>
      <SectionTabs sections={sections} active={Math.min(activeTab, sections.length - 1)} onPick={jumpTo} />
    </View>}
    <TopBar patient={patient} inEncounter={!home} openTasks={(patient ? [encounter] : Object.values(encounters)).reduce((sum, value) => sum + (value?.tasks.filter(task => !task.completed).length ?? 0), 0)} faded={scrolled || requests.length > 0} onMenu={openDrawer} onBack={home ? undefined : () => router.canGoBack() ? router.back() : router.replace("/")} onPatient={() => router.push({ pathname: "/patients", params: { switch: "1" } })} onTasks={() => router.push("/tasks")} />
    </View>

    {requests.length > 0 && <LinearGradient pointerEvents="none" colors={["rgba(245,246,248,0)", "rgba(245,246,248,0.9)", palette.canvas]} locations={[0, 0.5, 1]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: insets.bottom + 120 }} />}
    <VoiceDock
      backdrop={backdrop}
      thinking={thinking}
      activity={active ? (phase === "thinking" ? "searching" : activities[active.kind]) : justDone ? "done" : undefined}
      onCancel={cancel}
      onSubmit={submit}
      spokenPrompt={patient ? suggestionFor("briefing", patient).text : "Who am I seeing first?"}
      placeholder={patient ? `Ask about ${patient.name.split(" ")[0]}…` : "Ask anything…"}
      draft={input}
      onDraft={setInput}
      voiceEnabled={voiceInput}
      onVoiceDisabled={() => setNotice("Voice input is turned off in settings. Type your request instead.")}
      onImage={() => open("xray")}
      attachments={pending}
      onAttachmentsChange={setPending}
      onConsultation={() => open("recording")}
      onNote={() => open("note")}
      above={<>
        {recording && <Pressable accessibilityRole="button" onPress={() => open("recording")} style={{ alignSelf: "center", minHeight: 40, paddingHorizontal: 16, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.white, boxShadow: "0 4px 14px rgba(24,32,48,0.1)" }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: encounter?.recording === "paused" ? palette.amber : palette.red }} /><Text style={{ fontSize: 13, fontWeight: "500", color: palette.ink, fontVariant: ["tabular-nums"] }}>Consultation {encounter?.recording === "paused" ? "paused" : "playing"} · {encounter?.recordingSeconds}s</Text>
        </Pressable>}
        {notice && <Notice>{notice}</Notice>}
      </>}
    />
    {/* While open, the page is a quiet surface: it fades back and a tap anywhere closes it. */}
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.canvas }, dimStyle]} />
    {drawer && <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={closeDrawer} style={StyleSheet.absoluteFill} />}
    </Animated.View>
    </GestureDetector>
  </View>;
}
