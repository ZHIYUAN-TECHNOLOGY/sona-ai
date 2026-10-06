import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import * as Speech from "expo-speech";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { spoken, type Asked, type Reply } from "@/features/assistant/answers";
import { pickVoices, preview, standInFor, voiceFor, type SonaVoice } from "@/features/assistant/voices";
import { FIRST_MS, sayInSonaVoice } from "./sona-voice";
import { useLiveVoice } from "./live";
import { useListen } from "@/lib/listen";
import { tFor, useLang, useT } from "@/lib/i18n";
import "./strings";
import { orbPad, SonaOrb } from "@/lib/orb";
import { VoiceGlow } from "@/lib/voice-glow";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { Icon, type IconName } from "@/lib/icons";
import { Button, CircleButton } from "@/lib/ui";

/**
 * Voice mode, after the AI Health Companion kit's voice screens: "Sona Care" centred at the top with
 * back; the orb in the middle with one honest line under it ("Tap to hear it", "Reading aloud…"); the
 * answer large and centred, the words already read in ink and the rest faint (karaoke on the phone's
 * word boundaries; all ink where the phone sends none); the plan's questions under it; and a bottom
 * row of the mic (talk / stop) and the keyboard back to text (the voice is picked once, the first time). Talking is a hands-free
 * conversation, turn by turn: the patient speaks, the turn ends when they pause, Sona answers aloud,
 * then listens again, until they tap stop or go quiet. It only says it is listening while the mic is on,
 * and with no speech model switched on it says so plainly; tapping a question still reads its answer.
 * The first time, "Choose Sona's voice" (after Gemini's picker): Sona's own Malaysian voice first, then
 * the phone's voices; each says hello. Sona's own voice is made on Sona's server (./sona-voice): its words
 * light up by how much of each sentence has played, and while it is starting or slow the phone's voice
 * reads in its place, saying so under the status (a hello is never read in its place). Reduce Motion: no
 * sliding, and the orb holds still.
 * Where this build and the server have Sona's voice agent (./live), one tap on the mic (the patient's consent to open
 * it) starts a live conversation instead, hands-free from then on: no tap per turn, and talking over Sona stops her.
 * The orb floods while she speaks, half while she thinks, and follows the patient's voice while she listens; one line
 * says which ("Sona is speaking · talk to interrupt"); the patient's words and her answer (lit as she speaks it) stay on
 * screen. The same round button becomes stop, which ends the conversation; back and the keyboard stay. If the call drops
 * or is refused, the mic is tap per turn again, with one line saying so.
 */
const KEY = "sona-care.voice";
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/** A question to offer and its small line icon (a missed dose, a medicine, a visit, a doctor). */
export type Suggestion = { question: string; icon: IconName };
export const SUGGEST_ICON: Record<Asked["kind"] | "doctor", IconName> = { dose: "alarm", medicine: "pill", visit: "calendar", doctor: "doctor" };

export function VoiceMode({ questions, answer, first, language, onChat, onType }: { questions: Suggestion[]; answer: (question: string) => Reply | Promise<Reply>; first?: string; language?: "en" | "ms" | "zh"; onChat: () => void; onType: () => void }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const lang = useLang(), t = tFor(lang);
  const [voices, setVoices] = useState<SonaVoice[]>();
  const [voice, setVoice] = useState<SonaVoice>();
  const [picking, setPicking] = useState(false);
  // The answer on show (the chat's last one on arrival) and how far into it the voice has read.
  const [said, setSaid] = useState(first);
  const [upto, setUpto] = useState<number>();
  const [speaking, setSpeaking] = useState(false);
  // 0 quiet, 1 speaking: floods the orb.
  const talk = useSharedValue(0);
  // The glow along the bottom: the voice in the room (0–1), thinking (0–1, the sweeping beam), and shown (0–1).
  const level = useSharedValue(0), think = useSharedValue(0), glowOn = useSharedValue(0);
  // Each utterance gets a number, so a stopped one's late callback can't touch the next one.
  const turn = useRef(0);
  // In a conversation: after each answer is read, the mic opens again by itself.
  const [talking, setTalking] = useState(false);
  const [heard, setHeard] = useState<string>();
  const listen = useListen({ language, onHeard: q => { setHeard(q); void ask(q); } });
  const live = useLiveVoice({ voice, voices, onFlood: (n, l) => { talk.set(still ? 0 : withTiming(n, { duration: 160, easing: EASE_OUT })); level.set(withTiming(l, { duration: 120 })); } });
  const inCall = live.phase === "on";
  // When a call ends, its last exchange stays on screen, and the orb can read it again.
  useEffect(() => {
    if (inCall) return;
    if (live.said) setSaid(live.said);
    if (live.heard) setHeard(live.heard);
    talk.set(still ? 0 : withTiming(0, { duration: 600, easing: EASE_OUT }));
  }, [inCall]);
  // The line saying the live call dropped stays until the patient talks again.
  const [dropped, setDropped] = useState(false);
  useEffect(() => { if (live.phase === "lost") setDropped(true); }, [live.phase]);
  // Sona's own voice: stops the answer it is reading. `standIn` while the phone reads in its place.
  const hosted = useRef<() => void>(undefined);
  const [preparing, setPreparing] = useState(false);
  const [standIn, setStandIn] = useState<{ waking?: number }>();
  const again = useRef(() => {});
  again.current = () => { if (talking && listen.state === "idle") listen.toggle(); };
  // A turn with nothing said, or an error (no speech model yet), ends the conversation.
  useEffect(() => { if (listen.state === "error") setTalking(false); }, [listen.state]);

  useEffect(() => {
    let live = true;
    void Promise.all([Speech.getAvailableVoicesAsync().catch(() => []), SecureStore.getItemAsync(KEY).catch(() => null)]).then(([all, id]) => {
      if (!live) return;
      const list = pickVoices(all, lang), saved = list.find(v => v.id === id);
      setVoices(list); setVoice(saved); setPicking(!saved);
    });
    return () => { live = false; hosted.current?.(); void Speech.stop(); };
  }, []);

  const on = (id: number, now: boolean) => {
    if (id !== turn.current) return;
    setSpeaking(now); setPreparing(false);
    if (!now) setUpto(undefined);
    talk.set(still ? 0 : withTiming(now ? 1 : 0, { duration: now ? 500 : 900, easing: EASE_OUT }));
  };
  /** The phone's voice reads `text` from `from` (the rest of an answer Sona's own voice began). */
  const phone = (id: number, text: string, v: SonaVoice, follow: boolean, from = 0) =>
    Speech.speak(text.slice(from), { voice: v.voice, language: v.language, rate: v.rate, pitch: v.pitch,
      onBoundary: follow ? (e: { charIndex: number; charLength: number }) => { if (id === turn.current) setUpto(from + e.charIndex + e.charLength); } : undefined,
      onStart: () => on(id, true), onDone: () => { on(id, false); if (id === turn.current) again.current(); }, onStopped: () => on(id, false), onError: () => on(id, false) });
  const quiet = () => { hosted.current?.(); hosted.current = undefined; void Speech.stop(); };
  /** `hello`: a voice saying hello in the picker: waited for, and never said by the phone in Sona's place. */
  const speak = (text: string, v: SonaVoice, follow = false, hello = false) => {
    const id = ++turn.current;
    quiet();
    setUpto(undefined);
    if (!v.hosted) { phone(id, text, v, follow); return; }
    // The note is about this answer only (the voice may have woken since the last one).
    setSpeaking(true); setPreparing(true); setStandIn(undefined);
    hosted.current = sayInSonaVoice(text, {
      start: () => { if (id === turn.current) setStandIn(undefined); on(id, true); },
      upto: n => { if (follow && id === turn.current) setUpto(n); },
      done: () => { on(id, false); if (id === turn.current) again.current(); },
      fallback: (from, waking) => {
        if (id !== turn.current) return;
        setStandIn({ waking });
        if (hello) on(id, false);
        else { setPreparing(false); phone(id, text, standInFor(text, voices ?? []), follow, from); }
      },
    }, hello ? undefined : FIRST_MS);
  };
  const stop = () => { turn.current++; quiet(); setSpeaking(false); setPreparing(false); setUpto(undefined); talk.set(still ? 0 : withTiming(0, { duration: 600, easing: EASE_OUT })); };
  // A Malay or Chinese answer is read in that language's voice, unless Sona's own (it reads all three) was picked.
  const read = (text: string, v = voice) => { if (!v) return; setSaid(text); speak(text, voiceFor(text, v, voices ?? []), true); };

  const start = (v: SonaVoice) => {
    void SecureStore.setItemAsync(KEY, v.id).catch(() => {});
    setVoice(v); setPicking(false);
    if (said) read(said, v);
    else { const hi = t("voice.ready"); speak(hi, voiceFor(hi, v, voices ?? [])); }
  };
  const ask = async (q: string) => read(spoken(await answer(q), lang));
  const replay = () => { if (speaking) stop(); else if (said) read(said); };
  /** The mic: start a conversation (live, where there is one), send the turn now, or (while Sona talks, or in a live call) stop and end it. */
  const main = () => {
    if (inCall) { live.end(); return; }
    if (speaking) { setTalking(false); stop(); return; }
    if (listen.state === "listening") { listen.toggle(); return; }
    setHeard(undefined); setDropped(false);
    if (live.phase === "ready") { void live.start(); return; }
    setTalking(true); listen.toggle();
  };
  const leave = (then: () => void) => { setTalking(false); listen.cancel(); live.end(); stop(); then(); };
  // Live: her answer as the agent writes it (the last one stays until the next begins), lit as she speaks it.
  const shown = inCall ? live.said || said : said;
  const words = inCall ? live.heard : heard;
  const lit = inCall ? live.upto ?? shown?.length ?? 0 : upto === undefined ? said?.length ?? 0 : upto;
  const starting = standIn?.waking ? t("voice.sonaStarting", { n: standIn.waking }) : undefined;
  const standInLine = inCall ? live.standIn && t("voice.sonaSlow") : standIn && (starting ?? t("voice.sonaSlow"));
  const note = listen.error ?? live.error ?? (dropped ? t("voice.liveLost") : undefined);
  const status = inCall ? (live.audible || live.status === "speaking" ? t("voice.liveSpeaking") : live.status === "thinking" ? t("voice.thinking") : live.status === "listening" ? t("voice.listening") : t("voice.connecting"))
    : listen.state === "listening" ? t("voice.listening") : listen.state === "reading" ? t("voice.thinking") : preparing ? t("voice.preparing") : speaking ? t("voice.readingAloud")
      : note ?? (said ? t("voice.again") : t("voice.start"));
  const thinking = inCall ? live.status === "thinking" && !live.audible : listen.state === "reading" || preparing;
  const listening = !inCall && listen.state === "listening";
  const glowing = inCall || listening || thinking || speaking;
  useEffect(() => { glowOn.set(withTiming(glowing ? 1 : 0, { duration: glowing ? 300 : 700, easing: EASE_OUT })); }, [glowing]);
  useEffect(() => { think.set(withTiming(thinking ? 1 : 0, { duration: 500, easing: EASE_IN_OUT })); }, [thinking]);
  // Turn by turn: the mic's -60 dB (quiet) to -10 dB (loud), or a steady bloom while Sona reads. In a call, live sends it.
  useEffect(() => {
    if (!inCall) level.set(withTiming(listening ? Math.max(0, Math.min(1, (listen.level + 60) / 50)) : speaking && !preparing ? 0.55 : 0, { duration: 120 }));
  }, [inCall, listening, listen.level, speaking, preparing]);
  const warn = !inCall && status === note && (listen.state === "error" || !listen.error);

  if (!voices) return <ActivityIndicator color={palette.muted} style={{ flex: 1 }} />;
  if (picking || !voice) return <Picker voices={voices} initial={Math.max(0, voices.findIndex(v => v.id === voice?.id))} onPreview={v => speak(preview(v, lang), v, false, true)} note={starting} onStart={start} onClose={() => leave(voice ? () => setPicking(false) : onChat)} />;

  return <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
    <VoiceGlow level={level} think={think} on={glowOn} active={glowing} />
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16 }}>
      <CircleButton icon="back" label={t("voice.backToChat")} onPress={() => leave(onChat)} />
      <Text accessibilityRole="header" style={{ flex: 1, textAlign: "center", fontSize: 20, lineHeight: 26, fontWeight: "600", letterSpacing: -0.6, color: palette.ink }}>Sona Care</Text>
      <View style={{ width: 48 }} />
    </View>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24, paddingVertical: 16, gap: 14 }}>
      {/* In a live call the orb only shows the state (talking over Sona is how to stop her); the status line says it. */}
      <Pressable accessible={!inCall} accessibilityRole="button" accessibilityLabel={speaking ? t("voice.stopReading") : said ? t("voice.hear") : t("voice.nothing")} accessibilityState={{ disabled: !said }} disabled={inCall || !said} onPress={replay}
        style={({ pressed }) => ({ margin: -orbPad(150) + 8, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        <SonaOrb size={150} flood={talk} awake />
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 22, fontWeight: "500", color: warn ? palette.amber : palette.ink, textAlign: "center" }}>{status}</Text>
      {standInLine && voice.hosted && <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{standInLine}</Text>}
      {words && <Text selectable accessibilityLabel={t("voice.youSaid", { q: words })} style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>“{words}”</Text>}
      {shown && <Text accessibilityLiveRegion="polite" selectable style={{ fontSize: 24, lineHeight: 32, fontWeight: "600", letterSpacing: -0.6, color: palette.ink, textAlign: "center", marginTop: 4 }}>
        {shown.slice(0, lit)}<Text style={{ fontWeight: "600", color: palette.faint }}>{shown.slice(lit)}</Text>
      </Text>}
      <View style={{ alignSelf: "stretch", marginTop: 8 }}>
        {questions.map(s => <SuggestionRow key={s.question} s={s} aloud onPress={() => { if (inCall) live.say(s.question); else void ask(s.question); }} />)}
      </View>
    </ScrollView>
    <Animated.View entering={still ? undefined : FadeIn.duration(260).delay(160)}
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 36, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) }}>
      <View style={{ width: 56 }} />
      <Pressable accessibilityRole="button" accessibilityLabel={inCall ? t("voice.end") : speaking ? t("voice.stop") : listen.state === "listening" ? t("voice.sendSaid") : t("voice.talk")}
        accessibilityHint={inCall || speaking || listen.state === "listening" ? undefined : t("voice.talkHint")}
        accessibilityState={{ busy: listen.state === "reading" }} disabled={listen.state === "reading"} onPress={main}
        style={({ pressed }) => ({ width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: listen.state === "listening" ? palette.blue : palette.white, borderWidth: 1, borderColor: listen.state === "listening" ? palette.blue : palette.line,
          boxShadow: "0 14px 28px -14px rgba(37,99,235,0.45)", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
        {inCall || speaking ? <View style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: palette.blue }} />
          : listen.state === "reading" ? <ActivityIndicator color={palette.blue} />
            : <Icon name="mic" color={listen.state === "listening" ? palette.white : palette.blue} size={28} />}
      </Pressable>
      <CircleButton icon="keyboard" size={56} label={t("voice.type")}onPress={() => leave(onType)} />
    </Animated.View>
  </View>;
}

/**
 * Gemini's picker: a finger drags `pos` (the current voice as a fractional index) on the UI thread;
 * letting go snaps to the nearest voice (a flick is enough) and says hello in it. Each name and line
 * sits on `pos` (the line on `lag`, 40 ms behind), so they slide and fade together. VoiceOver swipes
 * up or down to change voice; the arrows do the same for anyone who doesn't swipe.
 */
function Picker({ voices, initial, note, onPreview, onStart, onClose }: { voices: SonaVoice[]; initial: number; note?: string; onPreview: (v: SonaVoice) => void; onStart: (v: SonaVoice) => void; onClose: () => void }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(initial);
  const pos = useSharedValue(initial), lag = useSharedValue(initial), cur = useSharedValue(initial);
  const last = voices.length - 1;
  const v = voices[index]!;
  // The voice on show says hello when the picker opens, as each one does when swiped to.
  const hello = useRef(() => onPreview(voices[initial]!));
  useEffect(() => { hello.current(); }, []);

  const go = (i: number) => {
    const to = Math.max(0, Math.min(last, i));
    cur.set(to);
    pos.set(still ? to : withTiming(to, { duration: 280, easing: EASE_OUT }));
    lag.set(still ? to : withDelay(40, withTiming(to, { duration: 280, easing: EASE_OUT })));
    if (to === index) return;
    setIndex(to);
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    onPreview(voices[to]!);
  };

  const pan = Gesture.Pan().activeOffsetX([-12, 12]).failOffsetY([-16, 16])
    .onChange(e => {
      if (still) return; // Reduce Motion: no sliding under the finger; letting go still changes voice.
      let p = cur.get() - e.translationX / (width * 0.6);
      // Rubber-band past the first and last voice.
      if (p < 0) p *= 0.35; else if (p > last) p = last + (p - last) * 0.35;
      pos.set(p); lag.set(p);
    })
    .onEnd(e => {
      const moved = -e.translationX / (width * 0.6);
      const step = moved > 0.3 || e.velocityX < -500 ? 1 : moved < -0.3 || e.velocityX > 500 ? -1 : 0;
      scheduleOnRN(go, cur.get() + step);
    });

  return <View style={{ flex: 1, paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 16), paddingHorizontal: 20 }}>
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <CircleButton icon="close" label={t("common.close")} onPress={onClose} />
      <Text accessibilityRole="header" style={{ flex: 1, textAlign: "center", ...type.headline, color: palette.ink }}>{t("voice.pickTitle")}</Text>
      <View style={{ width: 44 }} />
    </View>
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1, justifyContent: "center", gap: 28 }}
        accessible accessibilityRole="adjustable" accessibilityLabel={t("voice.pickA11y", { i: index + 1, n: voices.length, name: v.name, line: v.line })} accessibilityHint={t("voice.pickHint")}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={e => go(index + (e.nativeEvent.actionName === "increment" ? 1 : -1))}>
        <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{t("voice.pickLine")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ opacity: index > 0 ? 1 : 0 }} pointerEvents={index > 0 ? "auto" : "none"}><CircleButton icon="back" label={t("voice.prev")}onPress={() => go(index - 1)} /></View>
          <View style={{ flex: 1, overflow: "hidden" }}>
            {/* The current voice, invisible, sizes the stage (so large text still fits); the moving copies sit on top. */}
            <Sizer v={v} />
            {voices.map((x, i) => <Slide key={x.id} i={i} v={x} pos={pos} lag={lag} />)}
          </View>
          <View style={{ opacity: index < last ? 1 : 0 }} pointerEvents={index < last ? "auto" : "none"}><CircleButton icon="next" label={t("voice.next")}onPress={() => go(index + 1)} /></View>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, height: 8 }}>
          {voices.map((x, i) => <PageDot key={x.id} i={i} pos={pos} />)}
        </View>
        {v.hosted && note && <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{note}</Text>}
      </View>
    </GestureDetector>
    <View style={{ alignSelf: "center", minWidth: 160 }}><Button label={t("voice.startButton")} onPress={() => onStart(v)} /></View>
  </View>;
}

const NAME = { fontSize: 40, lineHeight: 46, fontWeight: "300", letterSpacing: -1, color: palette.ink, textAlign: "center" } as const;
const LINE = { ...type.body, color: palette.muted, textAlign: "center" } as const;
/** The invisible copy of the current voice that gives the stage its height. */
function Sizer({ v }: { v: SonaVoice }) {
  return <View accessible={false} style={{ opacity: 0, alignItems: "center", gap: 6, paddingHorizontal: 8 }}>
    <Text style={NAME}>{v.name}</Text>
    <Text style={LINE}>{v.line}</Text>
  </View>;
}

function Slide({ i, v, pos, lag }: { i: number; v: SonaVoice; pos: SharedValue<number>; lag: SharedValue<number> }) {
  const { width } = useWindowDimensions();
  const shift = width * 0.5;
  const at = (p: number) => { "worklet"; const r = i - p; return { opacity: Math.max(0, 1 - Math.abs(r) * 1.6), transform: [{ translateX: r * shift }, { scale: 1 - Math.min(1, Math.abs(r)) * 0.06 }] }; };
  const name = useAnimatedStyle(() => at(pos.get()));
  const line = useAnimatedStyle(() => at(lag.get()));
  return <View accessible={false} pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, alignItems: "center", gap: 6, paddingHorizontal: 8 }}>
    <Animated.View style={name}><Text style={NAME}>{v.name}</Text></Animated.View>
    <Animated.View style={line}><Text style={LINE}>{v.line}</Text></Animated.View>
  </View>;
}

/** A page dot that stretches into a pill as `pos` reaches it (width on a tiny childless view: no layout ripple worth avoiding). */
function PageDot({ i, pos }: { i: number; pos: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const near = Math.max(0, 1 - Math.abs(i - pos.get()));
    return { width: 8 + 18 * near, opacity: 0.3 + 0.7 * near };
  });
  return <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: palette.ink }, style]} />;
}


/** A suggested question (the kit's Ask Nomi rows): a small line icon and the words, no card, 48 pt tall. `aloud` in voice mode. */
export function SuggestionRow({ s, onPress, aloud }: { s: Suggestion; onPress: () => void; aloud?: boolean }) {
  const t = useT();
  return <Pressable accessibilityRole="button" accessibilityLabel={s.question} accessibilityHint={aloud ? t("voice.readsAloud") : undefined} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 4, opacity: pressed ? 0.55 : 1 })}>
    <Icon name={s.icon} color={palette.muted} size={16} />
    <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "500", color: palette.ink }}>{s.question}</Text>
  </Pressable>;
}
