import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import * as Speech from "expo-speech";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withDelay, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Path } from "react-native-svg";
import { spoken, type Reply } from "@/features/assistant/answers";
import { pickVoices, preview, type SonaVoice } from "@/features/assistant/voices";
import { orbPad, SonaOrb } from "@/lib/orb";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { Button, CircleButton, ICON, pillStyle, surfaceStyle } from "@/lib/ui";

/**
 * Voice mode (Life OS voice chat, after Gemini's voice picker). The first time, "Choose Sona's voice":
 * swipe between the phone's English voices; the name and its line slide out and fade while the next
 * slides in from the other side (fast ease-out, the line 40 ms behind the name), the page dots stretch
 * into a pill for the current one, and each voice says hello. Then the live session: the orb, the
 * plan's questions as big rows, and a blue-violet wave along the bottom that breathes and swells while
 * Sona reads. There is no speech-to-text, so Sona says so: tap a question and it reads the answer aloud.
 * Reduce Motion: no sliding, and the wave holds still.
 */
const KEY = "sona-care.voice";
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const GLYPH = {
  next: "m9 18l6-6l-6-6",
  history: "M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2",
  keyboard: "M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10M8 12h.01M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2",
  out: "M7 17L17 7M7 7h10v10",
};

export function VoiceMode({ questions, answer, onChat, onType }: { questions: string[]; answer: (question: string) => Reply; onChat: () => void; onType: () => void }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [voices, setVoices] = useState<SonaVoice[]>();
  const [voice, setVoice] = useState<SonaVoice>();
  const [picking, setPicking] = useState(false);
  const [said, setSaid] = useState<string>();
  const [speaking, setSpeaking] = useState(false);
  // 0 quiet, 1 speaking: swells the wave and floods the orb.
  const talk = useSharedValue(0);
  // Each utterance gets a number, so a stopped one's late callback can't mark the next one as done.
  const turn = useRef(0);

  useEffect(() => {
    let live = true;
    void Promise.all([Speech.getAvailableVoicesAsync().catch(() => []), SecureStore.getItemAsync(KEY).catch(() => null)]).then(([all, id]) => {
      if (!live) return;
      const list = pickVoices(all), saved = list.find(v => v.id === id);
      setVoices(list); setVoice(saved); setPicking(!saved);
    });
    return () => { live = false; void Speech.stop(); };
  }, []);

  const on = (id: number, now: boolean) => {
    if (id !== turn.current) return;
    setSpeaking(now);
    talk.set(still ? 0 : withTiming(now ? 1 : 0, { duration: now ? 500 : 900, easing: EASE_OUT }));
  };
  const speak = (text: string, v: SonaVoice) => {
    const id = ++turn.current;
    void Speech.stop();
    Speech.speak(text, { voice: v.voice, language: v.language, rate: v.rate, pitch: v.pitch,
      onStart: () => on(id, true), onDone: () => on(id, false), onStopped: () => on(id, false), onError: () => on(id, false) });
  };
  const stop = () => { turn.current++; void Speech.stop(); setSpeaking(false); talk.set(still ? 0 : withTiming(0, { duration: 600, easing: EASE_OUT })); };

  const start = (v: SonaVoice) => {
    void SecureStore.setItemAsync(KEY, v.id).catch(() => {});
    setVoice(v); setPicking(false);
    speak("I'm ready. Tap a question and I'll read the answer aloud.", v);
  };
  const ask = (q: string) => {
    if (!voice) return;
    const text = spoken(answer(q));
    setSaid(text);
    speak(text, voice);
  };
  const leave = (then: () => void) => { stop(); then(); };

  return <View style={{ flex: 1 }}>
    <Wave energy={talk} />
    {!voices ? <ActivityIndicator color={palette.muted} style={{ flex: 1 }} />
      : picking || !voice ? <Picker voices={voices} initial={Math.max(0, voices.findIndex(v => v.id === voice?.id))} onPreview={v => speak(preview(v), v)} onStart={start} onClose={() => leave(voice ? () => setPicking(false) : onChat)} />
        : <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 24, gap: 18 }}>
            <Animated.View entering={still ? undefined : FadeIn.duration(240)} style={{ alignItems: "center" }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Voice: ${voice.name}`} accessibilityHint="Choose another voice" onPress={() => { stop(); setPicking(true); }}
                style={({ pressed }) => [pillStyle, { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
                <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>Voice · {voice.name}</Text>
              </Pressable>
            </Animated.View>
            <View accessible={false} style={{ alignSelf: "center", marginVertical: -orbPad(170) + 8 }}><SonaOrb size={170} flood={talk} /></View>
            <Text accessibilityLiveRegion="polite" selectable style={{ fontSize: said ? 20 : 26, lineHeight: said ? 28 : 33, fontWeight: "300", letterSpacing: -0.4, color: palette.ink, textAlign: "center" }}>
              {said ?? "Hello, how can we support your health today?"}
            </Text>
            <View style={{ alignSelf: "center", ...pillStyle, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted, textAlign: "center" }}>Tap a question — I'll read the answer aloud</Text>
            </View>
            <View style={{ gap: 10 }}>
              {questions.map((q, i) => <Animated.View key={q} entering={still ? undefined : FadeIn.duration(260).easing(EASE_OUT).delay(120 + i * 40)}>
                <SuggestionRow question={q} big onPress={() => ask(q)} />
              </Animated.View>)}
            </View>
          </ScrollView>
          <Animated.View entering={still ? undefined : FadeIn.duration(260).delay(200)}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) }}>
            <CircleButton d={GLYPH.history} size={56} label="Back to the chat" onPress={() => leave(onChat)} />
            <Pressable accessibilityRole="button" accessibilityLabel={speaking ? "Stop reading" : "Nothing is being read"} accessibilityState={{ disabled: !speaking }} disabled={!speaking} onPress={stop}
              style={({ pressed }) => ({ width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark, opacity: speaking ? 1 : 0.35,
                boxShadow: "0 14px 28px -14px rgba(14,18,27,0.6)", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
              <View style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: palette.white }} />
            </Pressable>
            <CircleButton d={GLYPH.keyboard} size={56} label="Type a question" onPress={() => leave(onType)} />
          </Animated.View>
        </View>}
  </View>;
}

/**
 * Gemini's picker: a finger drags `pos` (the current voice as a fractional index) on the UI thread;
 * letting go snaps to the nearest voice (a flick is enough) and says hello in it. Each name and line
 * sits on `pos` (the line on `lag`, 40 ms behind), so they slide and fade together. VoiceOver swipes
 * up or down to change voice; the arrows do the same for anyone who doesn't swipe.
 */
function Picker({ voices, initial, onPreview, onStart, onClose }: { voices: SonaVoice[]; initial: number; onPreview: (v: SonaVoice) => void; onStart: (v: SonaVoice) => void; onClose: () => void }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
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
      <CircleButton d={ICON.close} label="Close" onPress={onClose} />
      <Text accessibilityRole="header" style={{ flex: 1, textAlign: "center", ...type.headline, color: palette.ink }}>Choose Sona's voice</Text>
      <View style={{ width: 44 }} />
    </View>
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1, justifyContent: "center", gap: 28 }}
        accessible accessibilityRole="adjustable" accessibilityLabel={`Voice ${index + 1} of ${voices.length}: ${v.name}. ${v.line}`} accessibilityHint="Swipe up or down to hear another voice"
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={e => go(index + (e.nativeEvent.actionName === "increment" ? 1 : -1))}>
        <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>Swipe to hear each voice. It reads your answers aloud.</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ opacity: index > 0 ? 1 : 0 }} pointerEvents={index > 0 ? "auto" : "none"}><CircleButton d={ICON.back} label="Previous voice" onPress={() => go(index - 1)} /></View>
          <View style={{ flex: 1, overflow: "hidden" }}>
            {/* The current voice, invisible, sizes the stage (so large text still fits); the moving copies sit on top. */}
            <Sizer v={v} />
            {voices.map((x, i) => <Slide key={x.id} i={i} v={x} pos={pos} lag={lag} />)}
          </View>
          <View style={{ opacity: index < last ? 1 : 0 }} pointerEvents={index < last ? "auto" : "none"}><CircleButton d={GLYPH.next} label="Next voice" onPress={() => go(index + 1)} /></View>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, height: 8 }}>
          {voices.map((x, i) => <PageDot key={x.id} i={i} pos={pos} />)}
        </View>
      </View>
    </GestureDetector>
    <View style={{ alignSelf: "center", minWidth: 160 }}><Button label="Start" onPress={() => onStart(v)} /></View>
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
  return <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: palette.blue }, style]} />;
}

/** A suggested question as a white row with a ↗ circle (Life OS AI chat); `big` for the voice session. */
export function SuggestionRow({ question, onPress, big }: { question: string; onPress: () => void; big?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={question} accessibilityHint={big ? "Reads the answer aloud" : undefined} onPress={onPress}
    style={({ pressed }) => [surfaceStyle, { minHeight: big ? 64 : 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingLeft: 18, paddingRight: 10, borderRadius: big ? 24 : 20, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
    <Text style={{ flex: 1, fontSize: big ? 18 : 16, lineHeight: big ? 24 : 22, fontWeight: "500", color: palette.ink }}>{question}</Text>
    <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: palette.blueWash }}>
      <Svg width={16} height={16} viewBox="0 0 24 24"><Path d={GLYPH.out} fill="none" stroke={palette.blue} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
    </View>
  </Pressable>;
}

// The ambient wave: three soft ribbons of light near the bottom, blue easing to violet across the
// screen, a fill of glow under them. `breathe` is a slow 7 s swell; `energy` (0–1, while Sona speaks)
// lifts the ribbons, widens and quickens them.
const wave = Skia.RuntimeEffect.Make(`
uniform float2 size;
uniform float t;
uniform float energy;

half4 main(float2 p) {
  float2 uv = p / size;
  float breathe = 0.5 + 0.5 * sin(t * 0.9);
  float lift = 0.05 * breathe + 0.14 * energy;
  float3 sum = float3(0.0);
  float g = 0.0;
  for (int i = 0; i < 3; i++) {
    float f = float(i);
    float amp = (0.03 + 0.02 * breathe + 0.08 * energy) * (1.0 - 0.25 * f);
    float speed = 0.3 + 1.5 * energy;
    float y = 0.62 - lift + 0.08 * f
      + amp * sin(uv.x * (4.2 + 1.6 * f) + t * speed * (1.0 + 0.35 * f) + 2.1 * f)
      + amp * 0.45 * sin(uv.x * (9.0 - f) - t * speed * 0.7);
    float d = uv.y - y;
    float w = 0.045 + 0.035 * energy + 0.012 * breathe;
    float band = exp(-(d * d) / (w * w));
    float body = smoothstep(-0.03, 0.35, d) * 0.5;
    float k = (band + body) * (1.0 - 0.2 * f);
    float3 c = mix(mix(float3(0.20, 0.36, 1.0), float3(0.49, 0.32, 0.96), uv.x), float3(0.55, 0.76, 1.0), 0.3 * f);
    sum += c * k;
    g += k;
  }
  float a = clamp(g * (0.26 + 0.16 * energy), 0.0, 0.8) * smoothstep(0.1, 0.55, uv.y);
  float3 col = sum / max(g, 0.0001);
  return half4(half3(col * a), half(a));
}`)!;

function Wave({ energy }: { energy: SharedValue<number> }) {
  const still = useReducedMotion();
  const clock = useClock();
  const { width, height } = useWindowDimensions();
  const h = Math.round(height * 0.42);
  const uniforms = useDerivedValue(() => ({ size: [width, h], t: still ? 0 : clock.value / 1000, energy: still ? 0 : energy.get() }));
  return <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h }}>
    <Fill><Shader source={wave} uniforms={uniforms} /></Fill>
  </Canvas>;
}
