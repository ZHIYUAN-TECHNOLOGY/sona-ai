import { SampleLabel } from "@/components/sona/model-answer";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { RING } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, glass, pillStyle, useAccessibleEffects } from "@/components/sona/ui";
import type { Hearing } from "@/features/live/voice-input";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AppState, BackHandler, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { draftText, opened, sampleAt, step, wordsOf, type Phase, type Step, type Talk } from "./live-turns";

/** What Live hears back: the page shows the answer in its own conversation (`shown`), or Live says a quiet notice. */
export type LiveReply = { shown: true } | { notice: string };
/** A page's voice: whom it is about ("Amelia", "Today", "Ward 4B") and how it asks a question into the page. */
export type LiveAdapter = { scope: string; ask: (question: string) => Promise<LiveReply>; onOpenChange?: (open: boolean, end: () => void) => void };


/** The dock's microphone as Sona Live uses it (features/live/voice-input). */
type Mic = { state: Hearing; reading: boolean; latest: () => number; start: (how: "live") => Promise<void>; stop: (send: boolean) => Promise<void> };
const COULD_NOT = "Sona couldn't answer that just now. Ask again.";
// Demo mode's one chunk: the voice sample.
const SAMPLE = 1;

/**
 * Sona Live's loop (live-turns.ts) around the dock's microphone, or its voice sample in demo mode. Confirm, then reply:
 * the mic records the clinician into one draft, chunk by chunk, and never sends by itself; Send (or a send phrase said
 * last) sends it, and the page's adapter answers while the mic rests; listening resumes into a new draft if the mic is
 * still on. `owner` is whose recording the mic's words and errors belong to (Live, or the dock).
 */
export function useSonaLive(adapter: LiveAdapter | undefined, mic: Mic, owner: RefObject<"dock" | "live">, live: boolean, sample: string) {
  const [talk, setTalk] = useState<Talk<LiveReply>>();
  // The loop's state also lives in a ref, so a step and what follows it (asking) read the same state.
  const now = useRef<Talk<LiveReply>>(undefined);
  const apply = (next: Talk<LiveReply> | undefined) => { now.current = next; setTalk(next); };
  const latest = useRef(adapter); latest.current = adapter;
  // Each opening is a session (the loop drops a reply asked in an earlier one); the sample plays once per opening.
  const session = useRef(0), played = useRef(false), handoff = useRef<(text: string) => void>(undefined);
  const phase = talk?.phase;

  // Every change goes through the loop; one that sends the draft asks the page, and Sona thinks until it answers.
  const dispatch = (e: Step<LiveReply>) => {
    const was = now.current;
    if (!was) return;
    const next = step(was, e);
    apply(next);
    const asked = next.turns.length > was.turns.length ? next.turns.at(-1) : undefined;
    if (asked?.who !== "you") return;
    // Any failure (no adapter, a throw, a rejected call) is a quiet notice, never a page stuck on "Thinking…".
    Promise.resolve().then(() => latest.current!.ask(asked.text)).catch((): LiveReply => ({ notice: COULD_NOT }))
      .then(reply => dispatch({ type: "reply", reply, session: next.session }));
  };

  // Listening: Live records (live mode), or the voice sample streams into the draft and waits for Send, once per opening (demo).
  useEffect(() => {
    if (phase !== "listening") return;
    if (live) {
      if (mic.state === "idle") { owner.current = "live"; void mic.start("live"); }
      return;
    }
    if (played.current) return;
    // The mic turned back on mid-sample carries on from the words already in the draft.
    const words = wordsOf(sample), from = wordsOf(draftText(now.current?.draft ?? [])).length;
    const timers = words.slice(from).map((_, i) => setTimeout(() => {
      played.current = from + i + 1 >= words.length;
      dispatch({ type: "words", id: SAMPLE, text: words.slice(0, from + i + 1).join(" ") });
    }, sampleAt(i)));
    return () => timers.forEach(clearTimeout);
  }, [phase, live, mic.state]); // eslint-disable-line react-hooks/exhaustive-deps
  // The mic going off (or to the keyboard) finishes its chunk into the draft; Sona's turn or closing Live drops a recording that started.
  useEffect(() => {
    if (phase !== "listening" && mic.state === "listening" && owner.current === "live") void mic.stop(phase === "paused");
  }, [phase, mic.state]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing left to read: a send waiting on the mic goes, or the keyboard takes the draft (Live stays open, for typing).
  const idle = mic.state === "idle" && !mic.reading;
  useEffect(() => {
    if (!idle || !talk) return;
    if (talk.handoff) { handoff.current?.(draftText(talk.draft)); handoff.current = undefined; dispatch({ type: "handed" }); }
    else if (talk.sending !== undefined) dispatch({ type: "settled" });
  }, [idle, talk?.sending, talk?.handoff]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the app turns the mic off (its chunk joins the draft), so Live never listens from the background; Android's back ends it.
  useEffect(() => {
    if (!talk) return;
    const app = AppState.addEventListener("change", state => { if (state === "background" && now.current?.mic) dispatch({ type: "mic" }); });
    const back = BackHandler.addEventListener("hardwareBackPress", () => { end(); return true; });
    return () => { app.remove(); back.remove(); };
  }, [Boolean(talk)]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    if (!latest.current) return;
    session.current += 1; played.current = false;
    // Chunks recorded before this opening (one still being read for the last) stay out of its draft.
    apply(opened(session.current, live ? mic.latest() : 0));
    latest.current.onOpenChange?.(true, end);
  };
  // Stable, so the page (memoised) doesn't re-render with the dock's ten level readings a second.
  const end = useCallback(() => {
    if (!now.current) return;
    now.current = undefined; setTalk(undefined);
    latest.current?.onOpenChange?.(false, end);
  }, []);
  // Leaving the page (tasks, messages, another patient, back) ends Live, so the mic never listens from another page.
  useFocusEffect(useCallback(() => () => end(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const draft = talk ? draftText(talk.draft) : "";
  return {
    open: Boolean(talk), phase: phase ?? "paused", micOn: talk?.mic ?? false,
    /** Sent turns: the clinician's, and Sona's replies and notices. */
    turns: talk?.turns ?? [],
    /** Words not yet sent ("" when none): the chunks read so far, and the partial reading of any still being read or recorded. */
    draft,
    /** A chunk's final reading is on its way. */
    reading: Boolean(talk) && mic.reading,
    /** The sample's words so far (demo), for the veil's gusts and the orb's bars. */
    sampleWords: live ? 0 : wordsOf(draft).length,
    start, end,
    toggle: () => dispatch({ type: "mic" }),
    // Send: the chunk being recorded is finished and read, then the whole draft goes (demo: the whole sample).
    send: () => {
      if (!now.current || now.current.phase === "thinking") return;
      if (!live) { played.current = true; dispatch({ type: "heard", id: SAMPLE, text: sample }); }
      else if (mic.state === "listening") void mic.stop(true);
      dispatch({ type: "send" });
    },
    // Clear: the draft goes, with the chunk being recorded (listening starts a new one) and any still being read.
    clear: () => {
      if (!now.current || now.current.phase === "thinking") return;
      if (mic.state === "listening") void mic.stop(false);
      dispatch({ type: "clear", upTo: live ? mic.latest() : SAMPLE });
    },
    // The keyboard takes over: the mic goes off (its chunk is finished into the draft), and once all of it is read the
    // draft comes back, for the page's composer.
    keyboard: () => new Promise<string>(resolve => {
      if (!now.current) { resolve(""); return; }
      handoff.current = resolve;
      dispatch({ type: "keyboard" });
    }),
    // The mic's words while Live owns it, chunk by chunk: partial readings, then each chunk's final one (or its failure).
    onWords: (text: string, chunk: number) => { if (owner.current === "live") dispatch({ type: "words", id: chunk, text }); },
    onHeard: (text: string, chunk: number) => { if (owner.current === "live") dispatch({ type: "heard", id: chunk, text }); },
    onError: (message: string, chunk?: number) => {
      if (owner.current !== "live") return;
      // One notice for a run of failures (Sona speech starting fails every chunk read meanwhile).
      const last = now.current?.turns.at(-1), repeat = last?.who === "sona" && "notice" in last.reply && last.reply.notice === message;
      dispatch({ type: "fail", id: chunk, reply: repeat ? undefined : { notice: message } });
    },
  };
}

const STATUS: Record<Phase, string> = { listening: "Listening", paused: "Mic off", thinking: "Thinking…" };
const PULSE = { "0%": { opacity: 1 }, "50%": { opacity: 0.4 }, "100%": { opacity: 1 } };
const pulsing = { animationName: PULSE, animationDuration: 1600, animationIterationCount: "infinite" } as const;
const SOLID: ViewStyle = { backgroundColor: palette.surface, borderWidth: 1, borderColor: glass.hairline };

/**
 * What Sona Live is doing, by the mic that controls it (the page stays the page: Live is its voice). Red while the mic hears
 * the room, as the consultation recorder's dot; the hint says how to send until there are words to send.
 */
export function LiveStatus({ phase, hint }: { phase: Phase; hint: boolean }) {
  const { reducedMotion, reducedTransparency } = useAccessibleEffects();
  return <Animated.View entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 6, scale: 0.96, duration: 240 })} exiting={FadeOut.duration(140)} accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={`Sona Live, ${STATUS[phase]}`}
    style={[reducedTransparency ? SOLID : pillStyle, { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 7, minHeight: 34, paddingHorizontal: 14, borderRadius: 17 }]}>
    {phase === "listening" && <Animated.View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: palette.red, ...(reducedMotion ? null : pulsing) }} />}
    <Animated.Text key={phase} entering={FadeIn.duration(160)} style={{ ...type.footnote, fontWeight: "600", color: phase === "paused" ? palette.muted : palette.ink, ...(phase === "thinking" && !reducedMotion ? pulsing : null) }}>{STATUS[phase]}</Animated.Text>
    {hint && phase === "listening" && <Text style={{ ...type.footnote, color: palette.muted }}>· say “submit” to send</Text>}
  </Animated.View>;
}

/** The clinician's question as Live and the pages show it (Today's thread, a visit's requests): a glass bubble on the right. */
export function Bubble({ text }: { text: string }) {
  const { reducedTransparency } = useAccessibleEffects();
  return <View style={[reducedTransparency ? SOLID : pillStyle, { alignSelf: "flex-end", maxWidth: "86%", paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22, borderBottomRightRadius: 8, borderCurve: "continuous" }]}>
    <Text selectable accessibilityRole="header" accessibilityLabel={`You: ${text}`} style={{ ...type.body, color: palette.ink }}>{text}</Text>
  </View>;
}

/**
 * The words heard so far, not yet sent: a pause never sends, so they wait here for Send (or "submit"). Lighter glass and a
 * dashed rim mark it unsent; it grows with the words on the layout spring, no bounce (after Honk's live-resizing bubble,
 * quieter), each word fading up as it is heard. "Reading…" while the last words are read, with Send held until they are.
 */
export function DraftBubble({ text, reading, sample, reduced, solid, onSend }: { text: string; reading: boolean; sample: boolean; reduced: boolean; solid: boolean; onSend: () => void }) {
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

