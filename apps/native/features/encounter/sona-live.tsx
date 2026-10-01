import { EdgeBlur } from "@/components/sona/edge-blur";
import { SampleLabel } from "@/components/sona/model-answer";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Caption, Press, RING } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, glass, Icon, pillStyle, useAccessibleEffects } from "@/components/sona/ui";
import type { Hearing } from "@/features/live/voice-input";
import { createContext, memo, use, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AccessibilityInfo, AppState, BackHandler, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { inked, opened, sampleAt, sampleEnd, step, wordsOf, WORD_MS, type Phase, type Step, type Talk, type Turn } from "./live-turns";

/** What Sona says back in Live: a lead sentence and the artifact the page renders under it (`open` when the page shows it better), or a quiet notice. */
export type LiveReply = { lead: string; render: () => ReactNode; open?: () => void } | { notice: string };
/** A page's way into Sona Live: whom it is about ("Amelia", "Today", "Ward 4B") and how it answers a question. */
export type LiveAdapter = { scope: string; ask: (question: string) => Promise<LiveReply>; onOpenChange?: (open: boolean) => void };

/** Ends Sona Live: an artifact's own ways out (open a visit, go to a page) call it first. Nothing outside Live. */
const CloseContext = createContext<() => void>(() => {});
export const useLiveClose = () => use(CloseContext);

type Mic = { state: Hearing; partial: string; start: () => Promise<void>; stop: (send: boolean) => Promise<void> };
const COULD_NOT = "Sona couldn't answer that just now. Ask again.";

/**
 * Sona Live's loop (live-turns.ts) around the dock's microphone, or its voice sample in demo mode. Each turn
 * records until a pause (or Send), then the page's adapter answers while the mic rests; listening resumes if
 * the mic is still on. `owner` is whose recording the mic's words and errors belong to (Live, or the dock).
 */
export function useSonaLive(adapter: LiveAdapter | undefined, mic: Mic, owner: RefObject<"dock" | "live">, live: boolean, sample: string) {
  const [talk, setTalk] = useState<Talk<LiveReply>>();
  // The loop's state also lives in a ref, so a step and what follows it (asking) read the same state.
  const now = useRef<Talk<LiveReply>>(undefined);
  const apply = (next: Talk<LiveReply> | undefined) => { now.current = next; setTalk(next); };
  const dispatch = (e: Step<LiveReply>) => { if (now.current) apply(step(now.current, e)); };
  const latest = useRef(adapter); latest.current = adapter;
  // Each opening is a session: words or a reply that land after Live closed (or reopened) are dropped.
  const session = useRef(0), recordedIn = useRef(-1), played = useRef(false);
  const phase = talk?.phase;
  const mine = () => owner.current === "live" && recordedIn.current === session.current;

  const ask = (text: string) => {
    dispatch({ type: "end", text });
    const question = text.trim(), asked = session.current;
    if (!question || now.current?.phase !== "thinking") return;
    // Any failure (no adapter, a throw, a rejected call) is a quiet notice, never a page stuck on "Thinking…".
    Promise.resolve().then(() => latest.current!.ask(question)).catch((): LiveReply => ({ notice: COULD_NOT }))
      .then(reply => { if (session.current === asked) dispatch({ type: "reply", reply }); });
  };

  // Listening: Live's own recording (live mode; it ends itself on a pause), or the voice sample, once per opening (demo).
  useEffect(() => {
    if (phase !== "listening") return;
    if (live) {
      if (mic.state === "idle") { owner.current = "live"; recordedIn.current = session.current; void mic.start(); }
      return;
    }
    if (played.current) return;
    const words = wordsOf(sample);
    const timers = words.map((_, i) => setTimeout(() => dispatch({ type: "words", text: words.slice(0, i + 1).join(" ") }), sampleAt(i)));
    timers.push(setTimeout(() => { played.current = true; ask(sample); }, sampleEnd(words.length)));
    return () => timers.forEach(clearTimeout);
  }, [phase, live, mic.state]); // eslint-disable-line react-hooks/exhaustive-deps
  // The words so far stream into the clinician's bubble; once the turn has ended and is being read, Sona is thinking.
  useEffect(() => { if (mine() && mic.partial) dispatch({ type: "words", text: mic.partial }); }, [mic.partial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mine() && mic.state === "reading") dispatch({ type: "ending" }); }, [mic.state]); // eslint-disable-line react-hooks/exhaustive-deps
  // Paused or closed: Live's recording stops, including one that only finished starting after the mic was turned off.
  useEffect(() => { if (phase !== "listening" && mic.state === "listening" && owner.current === "live") void mic.stop(false); }, [phase, mic.state]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the app turns the mic off, so Live never listens from the background; Android's back ends it.
  useEffect(() => {
    if (!talk) return;
    const app = AppState.addEventListener("change", state => { if (state === "background" && now.current?.mic) dispatch({ type: "mic" }); });
    const back = BackHandler.addEventListener("hardwareBackPress", () => { end(); return true; });
    return () => { app.remove(); back.remove(); };
  }, [Boolean(talk)]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    if (!latest.current) return;
    session.current += 1; played.current = false;
    apply(opened());
    latest.current.onOpenChange?.(true);
  };
  // Stable, so the page (memoised) doesn't re-render with the dock's ten level readings a second.
  const end = useCallback(() => {
    if (!now.current) return;
    session.current += 1;
    now.current = undefined; setTalk(undefined);
    latest.current?.onOpenChange?.(false);
  }, []);
  const last = talk?.turns.at(-1);
  const heard = last?.who === "you" && !last.final ? last.text : "";
  return {
    open: Boolean(talk), phase: phase ?? "paused", micOn: talk?.mic ?? false, turns: talk?.turns ?? [],
    /** The sample's words so far (demo), for the veil's gusts and the orb's bars. */
    sampleWords: live ? 0 : wordsOf(heard).length,
    canSend: phase === "listening" && Boolean(heard),
    start, end,
    toggle: () => dispatch({ type: "mic" }),
    // Send ends the turn now: the recording is read (live), or the sample is sent whole (demo).
    send: () => { if (live) void mic.stop(true); else { played.current = true; ask(sample); } },
    onHeard: (text: string) => { if (mine()) ask(text); },
    onError: (message: string) => { if (mine()) dispatch({ type: "fail", reply: { notice: message } }); },
    // shim: replaced by the loop agent at merge
    draft: heard, reading: false, clear: () => {}, keyboard: async () => { end(); return heard; },
  };
}

const STATUS: Record<Phase, string> = { listening: "Listening", paused: "Paused", thinking: "Thinking…" };
const PULSE = { "0%": { opacity: 1 }, "50%": { opacity: 0.4 }, "100%": { opacity: 1 } };
const pulsing = { animationName: PULSE, animationDuration: 1600, animationIterationCount: "infinite" } as const;
// The lead's words still to come: the same sentence, quieter, so it never reflows as it inks in.
const UNREAD = "rgba(89,97,107,0.42)";

/**
 * Sona Live's page, full screen and read top down (like Claude's voice mode): status, scope and the X at the top, then
 * the conversation flowing down to where the aurora wave rises (`bottom` above the screen's edge). The dock draws the
 * canvas, the wave and the bar ([+] [mic] [keyboard]). The newest words stay in view unless the clinician scrolled up;
 * a reply taller than the screen is followed only until its question reaches the top, so it reads from there down.
 */
export const SonaLive = memo(function SonaLive({ phase, turns, draft, reading, scope, sample, bottom, onSend, onEnd }: { phase: Phase; turns: Turn<LiveReply>[]; draft: string; reading: boolean; scope: string; sample: boolean; bottom: number; onSend: () => void; onEnd: () => void }) {
  const insets = useSafeAreaInsets();
  const { reducedMotion, reducedTransparency } = useAccessibleEffects();
  const scroll = useRef<ScrollView>(null), atEnd = useRef(true), viewport = useRef(0), asked = useRef(0);
  // VoiceOver hears Live open and each reply as it arrives (iOS has no live regions; Android reads the turn's own).
  useEffect(() => { AccessibilityInfo.announceForAccessibility(`Sona Live. ${STATUS[phase]}`); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const said = turns.findLast(t => t.who === "sona"), question = turns.findLast(t => t.who === "you");
  useEffect(() => {
    if (said?.who === "sona") AccessibilityInfo.announceForAccessibility("notice" in said.reply ? said.reply.notice : said.reply.lead);
  }, [said?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Talking again, or a new question, brings the newest words back into view.
  useEffect(() => { atEnd.current = true; }, [Boolean(draft), question?.id]);
  const top = insets.top + 58, head = top + 8;
  const answering = !draft && turns.at(-1)?.who === "sona";
  return <CloseContext value={onEnd}>
    <Animated.View entering={FadeIn.duration(240)} exiting={FadeOut.duration(200)} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* First for VoiceOver, drawn over the conversation scrolling under it: status and scope centred, the X on the right. */}
      <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 4, left: 0, right: 0, zIndex: 2, minHeight: 44, flexDirection: "row", justifyContent: "center", alignItems: "center", paddingHorizontal: 64 }}>
        <View accessible accessibilityRole="header" accessibilityLabel={`Sona Live, ${STATUS[phase]}, ${scope}`} style={{ flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={[reducedTransparency ? SOLID : pillStyle, { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 32, paddingHorizontal: 12, borderRadius: 16 }]}>
            {/* Red while the mic hears the room, as the consultation recorder's dot. */}
            {phase === "listening" && <Animated.View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: palette.red, ...(reducedMotion ? null : pulsing) }} />}
            <Animated.Text key={phase} entering={FadeIn.duration(160)} style={{ ...type.footnote, fontWeight: "600", color: phase === "paused" ? palette.muted : palette.ink, ...(phase === "thinking" && !reducedMotion ? pulsing : null) }}>{STATUS[phase]}</Animated.Text>
          </View>
          <Text numberOfLines={1} style={{ flexShrink: 1, ...type.subhead, fontWeight: "600", color: palette.ink }}>{scope}</Text>
        </View>
        {/* Live's one way out, where a page's close sits; the bar below is only for talking. */}
        <View style={{ position: "absolute", top: 0, right: 14 }}>
          <Press onPress={onEnd} accessibilityLabel="End Sona Live" scale={0.96} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <View style={[reducedTransparency ? SOLID : pillStyle, { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" }]}><Icon name="xmark" size={14} color={palette.ink} /></View>
          </Press>
        </View>
      </View>
      {/* A card's own field (a weight, a task) can still be typed in: the keyboard lifts the conversation. */}
      <ScrollView ref={scroll} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets scrollEventThrottle={64}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: head, paddingBottom: 56, gap: 22 }}
        onLayout={e => { viewport.current = e.nativeEvent.layout.height; }}
        onScroll={e => { const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent; atEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48; }}
        onContentSizeChange={(_, height) => {
          if (!atEnd.current) return;
          const end = height - viewport.current;
          scroll.current?.scrollTo({ y: Math.max(0, answering ? Math.min(end, asked.current - head) : end), animated: !reducedMotion });
        }}>
        {/* Where they stand, in one line, before anything is said. */}
        {!turns.length && !draft && <View style={{ gap: 6 }}>
          <Text style={{ ...type.display, fontWeight: "500", color: palette.muted }}>{phase === "paused" ? "Microphone off" : "Listening…"}</Text>
          <Text style={{ ...type.footnote, color: palette.muted }}>{phase === "paused" ? "Tap the mic to talk." : "Tap Send, or say “submit”, when you’re ready."}</Text>
        </View>}
        {turns.map(t => t.who === "you" ? <YouTurn key={t.id} text={t.text} sample={sample} solid={reducedTransparency} onTop={t.id === question?.id ? y => { asked.current = y; } : undefined} />
          : "notice" in t.reply ? <Animated.View key={t.id} entering={FadeIn.duration(200)} accessibilityLiveRegion="polite"><Caption>{t.reply.notice}</Caption></Animated.View>
          : <SonaTurn key={t.id} reply={t.reply} reduced={reducedMotion} onEnd={onEnd} />)}
        {Boolean(draft) && <DraftBubble text={draft} reading={reading} sample={sample} reduced={reducedMotion} solid={reducedTransparency} onSend={onSend} />}
      </ScrollView>
      <EdgeBlur edge="top" style={{ position: "absolute", top: 0, left: 0, right: 0, height: top + 6 }} />
    </Animated.View>
  </CloseContext>;
});

const SOLID: ViewStyle = { backgroundColor: palette.surface, borderWidth: 1, borderColor: glass.hairline };

/** The clinician's sent turn: a glass bubble on the right with the final words. It takes the draft's place, so it only fades in. */
function YouTurn({ text, sample, solid, onTop }: { text: string; sample: boolean; solid: boolean; onTop?: (y: number) => void }) {
  return <Animated.View entering={FadeIn.duration(200)} onLayout={onTop && (e => onTop(e.nativeEvent.layout.y))} style={{ alignSelf: "flex-end", maxWidth: "86%", alignItems: "flex-end", gap: 4 }}>
    <View style={[solid ? SOLID : pillStyle, { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22, borderBottomRightRadius: 8, borderCurve: "continuous" }]}>
      <Text selectable accessibilityLabel={`You: ${text}`} style={{ ...type.body, color: palette.ink }}>{text}</Text>
    </View>
    {sample && <SampleLabel source="fixture" what="voice" />}
  </Animated.View>;
}

/**
 * The words heard so far, not yet sent: a pause never sends, so they wait here for Send (or "submit"). Lighter glass and a
 * dashed rim mark it unsent; it grows with the words on the layout spring, no bounce (after Honk's live-resizing bubble,
 * quieter), each word fading up as it is heard. "Reading…" while the last words are read, with Send held until they are.
 */
function DraftBubble({ text, reading, sample, reduced, solid, onSend }: { text: string; reading: boolean; sample: boolean; reduced: boolean; solid: boolean; onSend: () => void }) {
  return <Animated.View entering={reduced ? FadeIn.duration(150) : riseIn({ distance: 6, duration: 260 })} exiting={FadeOut.duration(140)} style={{ alignSelf: "flex-end", maxWidth: "86%", alignItems: "flex-end", gap: 8 }}>
    <Animated.View layout={reduced ? undefined : LAYOUT} accessible accessibilityLabel={`Draft: ${text}`} style={{ overflow: "hidden", flexDirection: "row", flexWrap: "wrap", columnGap: 4.5, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22, borderWidth: 1, borderStyle: "dashed", borderColor: RING, backgroundColor: solid ? palette.surface : "rgba(255,255,255,0.4)" }}>
      {wordsOf(text).map((word, i) => <Animated.View key={i} entering={reduced ? FadeIn.duration(150) : riseIn({ distance: 4, duration: 260 })}>
        <Text style={{ ...type.body, color: palette.ink }}>{word}</Text>
      </Animated.View>)}
    </Animated.View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Animated.Text style={{ ...type.caption, fontWeight: "500", color: palette.muted, ...(reading && !reduced ? pulsing : null) }}>{reading ? "Reading…" : "Draft"}</Animated.Text>
      <Action label="Send" icon="arrow.up" accessibilityLabel="Send what you said" disabled={reading} onPress={onSend} />
    </View>
    {sample && <SampleLabel source="fixture" what="voice" />}
  </Animated.View>;
}

/**
 * Sona's turn: the lead inks in word by word (Claude-style), then the page's artifact rises in under it, and Open just
 * after (Monogram's pulse sweep: fade up 16 pt on the strong ease-out in 450 ms, 40 ms apart).
 */
function SonaTurn({ reply, reduced, onEnd }: { reply: Extract<LiveReply, { lead: string }>; reduced: boolean; onEnd: () => void }) {
  const words = wordsOf(reply.lead);
  const [shown, setShown] = useState(() => inked(0, words.length, reduced));
  useEffect(() => {
    if (shown >= words.length) return;
    const t0 = Date.now();
    const timer = setInterval(() => { const n = inked(Date.now() - t0, words.length); setShown(n); if (n >= words.length) clearInterval(timer); }, WORD_MS);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- streams once, when the reply arrives
  const done = shown >= words.length;
  const rise = (delay: number) => reduced ? FadeIn.duration(200) : riseIn({ delay, distance: 16, duration: 450 });
  return <View accessibilityLiveRegion="polite" style={{ gap: 14 }}>
    <Text accessibilityLabel={reply.lead} style={{ ...type.heading, fontWeight: "500" }}>
      {words.map((word, i) => <Text key={i} style={{ color: i < shown ? palette.ink : UNREAD }}>{i ? ` ${word}` : word}</Text>)}
    </Text>
    {done && <View style={{ gap: 4 }}>
      <Animated.View entering={rise(100)}>{reply.render()}</Animated.View>
      {reply.open && <Animated.View entering={rise(140)} style={{ alignSelf: "flex-start" }}>
        <Press onPress={() => { onEnd(); reply.open!(); }} accessibilityLabel="Open on the page" accessibilityHint="Ends Sona Live and shows this answer in place" scale={0.96}
          style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ ...type.callout, fontWeight: "500", color: palette.blue }}>Open</Text>
          <Icon name="arrow.up.right" size={11} color={palette.blue} />
        </Press>
      </Animated.View>}
    </View>}
  </View>;
}
