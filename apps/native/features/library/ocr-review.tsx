import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { AlertRow, Caption, Mark, type MarkState, TextLink } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Card, Label, Notice, Screen, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/scribe/parts";
import { lastScan } from "./scan-state";
import { ScannedPages } from "./scan-parts";
import { CONFIDENCE_FLOOR, keptPages, SAMPLE_READING, WORD_FLOOR, type OcrDose, type OcrPage, type OcrResult } from "./ocr-sample";

/**
 * Route `/library-ocr?title=…&scope=…`: a scanned PDF read by OCR, reviewed before anything is added.
 * While it reads, the pages sit large and wiggle gently, a light sweeps down the active one, and a
 * checklist ticks off each step in turn (after 60fps "Remy AI Analysis Checklist Animation",
 * https://60fps.design/shots/remy-ai-analysis-checklist-animation). When it is done the pages shrink
 * into a pinned strip and the review slides up beneath them, card by card (after "Arc Search
 * Summarize Interaction", https://60fps.design/shots/arc-search-summarize-interaction): what read
 * clearly, what was left out, and any dose outside its usual range, which must be confirmed or
 * corrected before adding. Until PaddleOCR-VL is hosted this shows a fixed synthetic sample, says
 * so, and saves nothing.
 */
const STEPS = ["Reading each page", "Checking for patient details", "Checking doses against the drug table"];
const STEP_MS = 900;

export function OcrReviewScreen() {
  const { title, scanned: fromScan } = useLocalSearchParams<{ title?: string; scope?: string; scanned?: string }>();
  const { reducedMotion } = useAccessibleEffects();
  const reading: OcrResult = SAMPLE_READING;
  // Only a scan from Add a source shows its pages; a scanned PDF or an attachment scan never borrows them.
  const [scanned] = useState(fromScan ? lastScan : []);
  const [step, setStep] = useState(0);
  const done = step >= STEPS.length;
  // ponytail: the sample paces itself on timers; a real reading advances on the server's progress events.
  useEffect(() => {
    if (done) { haptic("done"); return; }
    const t = setTimeout(() => setStep(s => s + 1), reducedMotion ? 150 : STEP_MS);
    return () => clearTimeout(t);
  }, [step, done, reducedMotion]);

  const kept = keptPages(reading);
  const [doses, setDoses] = useState<Record<string, "confirmed" | string>>({});
  const open = reading.doses.filter(d => d.status === "check" && kept.some(p => p.page === d.page) && !doses[d.id]);

  return <Screen>
    <View style={{ gap: 4 }}>
      <Label>{reading.source === "sample" ? "Sample reading" : "Read by OCR"}</Label>
      <Text accessibilityRole="header" numberOfLines={2} style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{title ?? reading.title}</Text>
    </View>
    {scanned.length > 0 && <View style={{ gap: 8 }}>
      <Label muted>Your scan · {scanned.length} page{scanned.length === 1 ? "" : "s"}</Label>
      <ScannedPages pages={scanned} pass={done ? "still" : "reading"} width={84} />
    </View>}
    {reading.source === "sample" && <Notice>{scanned.length ? "Your pages are scanned and straightened. The OCR model isn't hosted yet, so the reading below is a fixed synthetic sample, not your pages. Nothing here is saved." : "The OCR model isn't hosted yet, so this is a fixed synthetic sample, not your file. Nothing here is saved."}</Notice>}
    <PageStrip pages={reading.pages} compact={done} />
    {!done && <Card>
      {STEPS.map((label, i) => <Step key={label} label={label} state={i < step ? "done" : i === step ? "pending" : "open"} />)}
    </Card>}
    {done && <Review reading={reading} kept={kept} open={open} doses={doses} onDose={(id, v) => { haptic("tap"); setDoses(d => ({ ...d, [id]: v })); }} />}
  </Screen>;
}

function Step({ label, state }: { label: string; state: MarkState }) {
  return <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }}>
    <Mark state={state} size={22} />
    <Text style={{ ...type.callout, color: state === "open" ? palette.muted : palette.ink, fontWeight: state === "pending" ? "600" : "400" }}>{label}</Text>
  </View>;
}

/** The scan's pages: large while reading, a small pinned strip once done; each shows how clearly it read. */
function PageStrip({ pages, compact }: { pages: OcrPage[]; compact: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ flexDirection: "row", gap: compact ? 8 : 12, justifyContent: compact ? "flex-start" : "center" }}>
    {pages.map((p, i) => <PageThumb key={p.page} page={p} compact={compact} reading={!compact} delay={i * 120} />)}
  </Animated.View>;
}

function PageThumb({ page, compact, reading, delay }: { page: OcrPage; compact: boolean; reading: boolean; delay: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const w = compact ? 44 : 64, h = compact ? 58 : 86;
  const sweep = useSharedValue(0), tilt = useSharedValue(0);
  useEffect(() => {
    if (!reading || reducedMotion) { cancelAnimation(sweep); cancelAnimation(tilt); tilt.set(withTiming(0, { duration: 200 })); return; }
    sweep.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, false));
    // The Arc wiggle: a small rotation back and forth, offset per page so the stack breathes rather than marches.
    tilt.set(withRepeat(withSequence(withTiming(1.2, { duration: 260 + delay / 4 }), withTiming(-1.2, { duration: 260 + delay / 4 })), -1, true));
  }, [reading, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  const light = useAnimatedStyle(() => ({ transform: [{ translateY: -24 + sweep.value * (h + 24) }] }));
  const wobble = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));
  const unclear = page.confidence < CONFIDENCE_FLOOR;
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ alignItems: "center", gap: 4 }} accessibilityLabel={`Page ${page.page}${compact ? `, ${Math.round(page.confidence * 100)}% clear${unclear ? ", left out" : ""}` : ""}`}>
    <Animated.View style={[{ width: w, height: h, borderRadius: 8, borderCurve: "continuous", backgroundColor: palette.white, overflow: "hidden", padding: compact ? 6 : 9, gap: compact ? 3 : 5, boxShadow: "0 0 0 0.5px rgba(20,28,40,0.08), 0 4px 12px rgba(40,70,140,0.12)", opacity: compact && unclear ? 0.5 : 1 }, wobble]}>
      {[0.9, 0.7, 0.8, 0.55, 0.75].map((f, i) => <View key={i} style={{ width: `${f * 100}%`, height: compact ? 2 : 3, borderRadius: 2, backgroundColor: i === 0 ? "rgba(29,31,35,0.35)" : "rgba(29,31,35,0.14)" }} />)}
      {reading && !reducedMotion && <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, right: 0, top: 0, height: 24 }, light]}>
        <LinearGradient colors={["rgba(36,91,204,0)", "rgba(36,91,204,0.22)", "rgba(36,91,204,0)"]} style={{ flex: 1 }} />
      </Animated.View>}
    </Animated.View>
    {compact && <Text style={{ ...type.caption, fontWeight: "600", fontVariant: ["tabular-nums"], color: unclear ? palette.amber : palette.muted }}>{Math.round(page.confidence * 100)}%</Text>}
  </Animated.View>;
}

function Review({ reading, kept, open, doses, onDose }: { reading: OcrResult; kept: OcrPage[]; open: OcrDose[]; doses: Record<string, string>; onDose: (id: string, v: string) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const left = reading.pages.length - kept.length;
  const flagged = reading.doses.filter(d => d.status === "check" && kept.some(p => p.page === d.page));
  const rise = (i: number) => reducedMotion ? undefined : riseIn({ delay: 80 + i * 70, distance: 14, duration: 340 });
  return <>
    <Animated.View entering={rise(0)}>
      <Text accessibilityLiveRegion="polite" style={{ ...type.headline, color: palette.ink }}>
        {kept.length} of {reading.pages.length} pages read clearly{open.length ? `. ${open.length} dose${open.length === 1 ? "" : "s"} to check.` : flagged.length ? ". Doses checked." : "."}
      </Text>
    </Animated.View>
    {flagged.map((d, i) => <Animated.View key={d.id} entering={rise(1 + i)} layout={reducedMotion ? undefined : LAYOUT}>
      <DoseCheck dose={d} value={doses[d.id]} onDose={v => onDose(d.id, v)} />
    </Animated.View>)}
    {kept.map((p, i) => <Animated.View key={p.page} entering={rise(1 + flagged.length + i)}>
      <PageText page={p} corrected={flagged.filter(d => d.page === p.page && doses[d.id] && doses[d.id] !== "confirmed")} doses={doses} />
    </Animated.View>)}
    {left > 0 && <Animated.View entering={rise(1 + flagged.length + kept.length)}>
      <Caption icon="eye.slash">{left === 1 ? "1 page was" : `${left} pages were`} too unclear to cite and will be left out: {reading.pages.filter(p => p.confidence < CONFIDENCE_FLOOR).map(p => `page ${p.page}`).join(", ")}. Upload a clearer scan to include {left === 1 ? "it" : "them"}.</Caption>
    </Animated.View>}
    <Animated.View entering={rise(2 + flagged.length + kept.length)} style={{ gap: 8 }}>
      <Action label={`Add ${kept.length} page${kept.length === 1 ? "" : "s"}`} icon="plus" disabled={reading.source === "sample" || open.length > 0} onPress={() => {}} />
      <Caption icon={null}>{open.length ? "Confirm or correct each flagged dose first." : reading.source === "sample" ? "Adding switches on when the OCR model is hosted." : "Each page is labelled \"Read by OCR\" wherever it is cited."}</Caption>
    </Animated.View>
  </>;
}

/** A dose outside its usual range: possibly misread, so the doctor says what the original shows before it can be cited. */
function DoseCheck({ dose, value, onDose }: { dose: OcrDose; value?: string; onDose: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (value) return <View style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: 14, borderRadius: 18, borderCurve: "continuous", backgroundColor: "rgba(40,104,80,0.06)" }}>
    <Mark state="done" size={22} />
    <Text style={{ flex: 1, ...type.callout, color: palette.ink }}>{dose.drug} {value === "confirmed" ? `${dose.dose}, confirmed against the original` : `corrected to ${value}`}</Text>
    <TextLink label="Undo" onPress={() => onDose("")} />
  </View>;
  return <AlertRow title={`${dose.drug} ${dose.dose}`} kind={`PAGE ${dose.page} · POSSIBLY MISREAD`} detail={`Usual dose is ${dose.usual}. Check the original before this page can be cited.`}>
    {editing ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
      <TextInput accessibilityLabel={`Correct ${dose.drug} dose`} value={text} onChangeText={setText} autoFocus placeholder={`What the original says (read as ${dose.dose})`} placeholderTextColor="#A2A8B1" autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => { if (text.trim()) onDose(text.trim()); }}
        style={{ flex: 1, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: palette.ink, backgroundColor: palette.white }} />
      <Action label="Save" disabled={!text.trim() || text.trim() === dose.dose} onPress={() => onDose(text.trim())} />
    </View> : <View style={{ flexDirection: "row", gap: 16 }}>
      <TextLink label="Correct it" onPress={() => setEditing(true)} />
      <TextLink label={`Original says ${dose.dose}`} onPress={() => onDose("confirmed")} />
    </View>}
  </AlertRow>;
}

/** One page's text as read; lines read with low confidence are tinted amber so the eye lands on them, until the doctor corrects them. */
function PageText({ page, corrected, doses }: { page: OcrPage; corrected: OcrDose[]; doses: Record<string, string> }) {
  const fix = (line: string) => corrected.reduce((l, d) => l.replace(d.dose, doses[d.id]!), line);
  return <Card>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Label muted>Page {page.page}</Label>
      <Text style={{ ...type.caption, fontWeight: "600", fontVariant: ["tabular-nums"], color: palette.muted }}>{Math.round(page.confidence * 100)}% clear</Text>
    </View>
    {/* The tint sits on an inner span so it hugs the words line by line; on the line's own box it would stretch to the card's edge. */}
    {page.lines.map((l, i) => { const low = l.confidence < WORD_FLOOR && !corrected.some(d => l.text.includes(d.dose)); return <Text key={i} selectable accessibilityHint={low ? "Read with low confidence" : undefined}
      style={{ ...type.callout, color: palette.ink, fontWeight: i === 0 ? "600" : "400" }}>{low ? <Text style={{ backgroundColor: "rgba(240,176,72,0.30)" }}>{fix(l.text)}</Text> : fix(l.text)}</Text>; })}
  </Card>;
}
