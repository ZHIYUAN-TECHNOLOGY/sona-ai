import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { Host, Switch } from "@expo/ui";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { TINT } from "@/components/sona/marked-text";
import { EASE_OUT_CSS, LAYOUT, riseIn } from "@/components/sona/motion";
import { Caption, ErrorLine } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Body, Card, Icon, Insight, Notice, Screen, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { exportBlockers } from "@/features/ask/answers";
import { ASK_SPACE, WithSona } from "@/features/ask";
import { haptic } from "@/features/clinical/medication-parts";
import { api, errorText, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { useRole } from "@/features/live/roles";
import { exported, insight, leakLine, type Part, type Placeholder, placeholderParts, redactedWords, removed, spoken } from "./model";

type Status = Awaited<ReturnType<AppRouterClient["training"]["status"]>>;
type Sample = Awaited<ReturnType<AppRouterClient["training"]["samples"]>>[number];
type Exported = Awaited<ReturnType<AppRouterClient["training"]["export"]>>;

const TEAL = palette.green;
const SOURCE: Record<string, string> = { "note-edit": "Note edit", "check-in-reply": "Check-in reply", transcript: "Transcript", "handwritten-scan": "Scanned note" };
// Both sides of a sample, named for what they are: the scribe's draft vs the doctor's saved note (the edit is the signal).
const SIDES: Record<string, [string, string]> = { "note-edit": ["Draft", "Saved"], "check-in-reply": ["Reply", "Read as"], transcript: ["Heard", "Written"], "handwritten-scan": ["Read", "Kept"] };
const SETTLED: Record<string, [string, string]> = { approved: ["Approved", TEAL], excluded: ["Excluded", palette.muted], withdrawn: ["Withdrawn by patient", palette.muted] };
const codeOf = (e: unknown) => (e as { data?: { code?: string } } | undefined)?.data?.code;

/** Management in live mode: the training status for the ward's entry row, re-read when the ward comes into view. */
export function useTrainingStatus() {
  const { on } = useLive();
  const role = useRole();
  const allowed = on && role.can("training.status");
  const [status, setStatus] = useState<Status>();
  useFocusEffect(useCallback(() => {
    if (!allowed) return;
    let alive = true;
    api.training.status().then(s => { if (alive) setStatus(s); }, () => {});
    return () => { alive = false; };
  }, [allowed]));
  return { allowed, status: allowed ? status : undefined };
}

/**
 * Training data (management, live only): the continuous-training review queue. One insight line,
 * the export with its receipt (the page's one feature card), the hospital's contribute switch, then
 * each de-identified sample with its placeholders marked and Approve / Exclude in place. Re-read whenever the screen focuses.
 */
export function TrainingScreen() {
  const { on: live } = useLive();
  const role = useRole();
  const { reducedMotion } = useAccessibleEffects();
  const allowed = live && role.can("training.status");
  const [status, setStatus] = useState<Status>();
  const [samples, setSamples] = useState<Sample[]>();
  const [loadError, setLoadError] = useState<string>();
  // Decided this visit: those cards stay, showing their new state, so the decision is confirmed in place.
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string>();
  const [cardError, setCardError] = useState<Record<string, string>>({});
  const [switchError, setSwitchError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [receipt, setReceipt] = useState<Exported>();
  const [exportNote, setExportNote] = useState<{ text: string; red: boolean }>();

  const readStatus = useCallback(() => api.training.status().then(setStatus, () => {}), []);
  const load = useCallback(() => {
    setLoadError(undefined);
    return Promise.all([api.training.status(), api.training.samples()])
      // Blocked first (must not miss); sorted once here, so a card decided later keeps its place.
      .then(([s, list]) => { setStatus(s); setSamples([...list].sort((a, b) => Number(b.status === "blocked") - Number(a.status === "blocked"))); }, e => setLoadError(errorText(e)));
  }, []);
  useFocusEffect(useCallback(() => { if (allowed) void load(); }, [allowed, load]));
  // A consent change, a new sample or a decision elsewhere refreshes the queue while it is open.
  useLiveChanges(["training"], () => { if (allowed) void load(); });

  if (!live) return <Screen><Notice>Training data comes from the live backend. Switch it on in Settings and sign in as management.</Notice></Screen>;
  if (role.known && !allowed) return <Screen><Notice>{role.why("training.status")}</Notice></Screen>;

  const toggle = (contributes: boolean) => {
    if (!status) return;
    haptic("select"); setSwitchError(undefined);
    setStatus({ ...status, contributes });
    api.training.setContributes({ contributes }).catch(e => { setStatus(s => s && { ...s, contributes: !contributes }); setSwitchError(`Not changed: ${errorText(e)}`); });
  };
  const decide = (sample: Sample, decision: "approve" | "exclude") => {
    setBusy(sample.id); setCardError(({ [sample.id]: _, ...rest }) => rest);
    setDecided(set => new Set(set).add(sample.id));
    api.training.decide({ id: sample.id, decision })
      .then(next => { haptic(decision === "approve" ? "success" : "select"); setSamples(list => list?.map(s => s.id === next.id ? next : s)); void readStatus(); },
        e => { haptic("warning"); setCardError(c => ({ ...c, [sample.id]: errorText(e) })); if (codeOf(e) !== "SAMPLE_BLOCKED") void load(); })
      .finally(() => setBusy(undefined));
  };
  const runExport = () => {
    setExporting(true); setReceipt(undefined); setExportNote(undefined);
    api.training.export()
      .then(r => { haptic("success"); setReceipt(r); },
        e => {
          haptic("warning");
          const code = codeOf(e);
          setExportNote(code === "NOTHING_TO_EXPORT" ? { text: "Nothing approved is waiting to export.", red: false }
            : code === "LEAK_FOUND" ? { text: `${errorText(e)}.`, red: true } : { text: `Not exported: ${errorText(e)}`, red: true });
        })
      .finally(() => { setExporting(false); void load(); });
  };

  const queue = samples?.filter(s => s.status === "pending" || s.status === "blocked" || decided.has(s.id)) ?? [];
  const rise = (i: number) => reducedMotion ? undefined : riseIn({ delay: 40 * Math.min(i, 6), distance: 8, duration: 320 });
  const ready = status?.ready ?? 0, next = (status?.lastDataset?.version ?? 0) + 1;
  // Sona reads the same queue the page shows: what is still pending or blocked.
  const open = queue.flatMap(s => s.status === "pending" || s.status === "blocked" ? [{ id: s.id, title: `${SOURCE[s.source] ?? s.source} · ${s.patientLabel}`, status: s.status, leak: leakLine(s.leak) }] : []);

  // The next decision leads, as the page's one feature surface: the review queue while anything waits, then the
  // export (it glides above the decided cards once the last one is decided).
  const dataset = status && <Animated.View key="dataset" layout={reducedMotion ? undefined : LAYOUT}><Card feature={!open.length} label="Dataset">
    <Text style={{ ...type.subhead, color: palette.ink }}>{ready
      ? `${ready} approved ${ready === 1 ? "row" : "rows"} will export as v${next}, after a fresh leak check.`
      : status.lastDataset ? `Everything approved is in v${status.lastDataset.version}.` : "Approve samples to build the first dataset."}</Text>
    {(ready > 0 || exporting) && <Action label={exporting ? "Exporting…" : "Export dataset"} icon="square.and.arrow.up" disabled={exporting} onPress={runExport} />}
    {receipt && <View accessible accessibilityLiveRegion="polite" style={{ gap: 2 }}>
      <Text style={{ ...type.subhead, fontWeight: "600", color: TEAL }}>{exported(receipt)}</Text>
      <Text selectable style={{ ...type.caption, color: palette.muted }}>{receipt.key}</Text>
    </View>}
    {exportNote && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: exportNote.red ? palette.red : palette.muted }}>{exportNote.text}</Text>}
  </Card></Animated.View>;
  const cards = queue.map((s, i) => <Animated.View key={s.id} entering={rise(i)} layout={reducedMotion ? undefined : LAYOUT}>
    <SampleCard sample={s} reducedMotion={reducedMotion} busy={busy === s.id} error={cardError[s.id]} onDecide={d => decide(s, d)} />
  </Animated.View>);

  return <WithSona scope="training" hidden={!status || !samples} answers={[exportBlockers({ ready, next }, open)]}><Screen>
    <Insight eyebrow="Live">{status ? insight(status) : loadError ? "Training data didn't load" : "Reading training data…"}</Insight>
    {loadError && <ErrorLine text={loadError} onRetry={() => void load()} />}

    {open.length ? [...cards, dataset] : [dataset, ...cards]}
    {samples && !queue.length && <Body muted>Nothing to review — samples appear when consented patients reply or doctors save notes.</Body>}

    {/* A rare setting, so it sits last; the insight line already says when sharing is off. */}
    {status && <Surface style={{ padding: 16, gap: 8 }}>
      <Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Contribute de-identified data" value={status.contributes} onValueChange={toggle} /></Host>
      <Text style={{ ...type.footnote, color: palette.muted }}>Only patients who opted in are captured. Names, IC and phone numbers are replaced before a sample reaches this screen.</Text>
      {switchError && <ErrorLine text={switchError} />}
    </Surface>}
    {status && <Caption icon="info.circle">Export only — fine-tuning on Baseten isn't connected yet</Caption>}
    <View style={{ height: ASK_SPACE }} />
  </Screen></WithSona>;
}

/** Samples whose redaction has played this session: a card shows its removals being made once, when it is new to the reviewer. */
const SHOWN = new Set<string>();

/** One sample: where it came from, who (without saying who), both sides with placeholders marked, what was removed and by whom, and the decision in place. */
function SampleCard({ sample, reducedMotion, busy, error, onDecide }: { sample: Sample; reducedMotion: boolean; busy: boolean; error?: string; onDecide: (d: "approve" | "exclude") => void }) {
  const [fresh] = useState(() => !SHOWN.has(sample.id));
  useEffect(() => { SHOWN.add(sample.id); }, [sample.id]);
  const motion: Motion | undefined = fresh ? reducedMotion ? "fade" : "strike" : undefined;
  const blocked = sample.status === "blocked";
  const settled = SETTLED[sample.status];
  const [inLabel, outLabel] = SIDES[sample.source] ?? ["Input", "Output"];
  // Reading order: the input side's placeholders strike first, then the output's; the line saying what went lands last.
  const first = chips(sample.input), total = first + chips(sample.output);
  return <Surface style={{ padding: 16, gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ paddingHorizontal: 9, height: 22, borderRadius: 11, justifyContent: "center", backgroundColor: palette.blueWash }}>
        <Text style={{ ...type.caption, fontWeight: "700", color: palette.blue }}>{SOURCE[sample.source] ?? sample.source}</Text>
      </View>
      <Text numberOfLines={1} style={{ ...type.footnote, flex: 1, color: palette.muted }}>{sample.patientLabel}</Text>
      {settled && <Text style={{ ...type.caption, fontWeight: "700", color: settled[1] }}>{settled[0]}</Text>}
    </View>
    <Side label={inLabel} text={sample.input} muted={sample.source === "note-edit"} motion={motion} first={0} />
    <Side label={outLabel} text={sample.output} motion={motion} first={first} />
    <Animated.View style={[{ flexDirection: "row", alignItems: "center", gap: 6 }, motion && reveal(total ? strikeAt(total - 1) + STRIKE_MS : strikeAt(0), "fade")]}>
      <Icon name="shield.lefthalf.filled" size={13} color={palette.muted} />
      <RemovedLine sample={sample} />
    </Animated.View>
    {blocked && <Text style={{ ...type.footnote, fontWeight: "600", color: palette.red }}>{leakLine(sample.leak)}</Text>}
    {error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    {!settled && <View style={{ flexDirection: "row", gap: 8 }}>
      {!blocked && <View style={{ flex: 1 }}><Action label="Approve" accessibilityLabel={`Approve ${SOURCE[sample.source] ?? "sample"}, ${sample.patientLabel}`} disabled={busy} onPress={() => onDecide("approve")} /></View>}
      <View style={{ flex: 1 }}><Action label="Exclude" secondary accessibilityLabel={`Exclude ${SOURCE[sample.source] ?? "sample"}, ${sample.patientLabel}`} disabled={busy} onPress={() => onDecide("exclude")} /></View>
    </View>}
  </Surface>;
}

const chips = (text: string) => placeholderParts(text).filter(p => p.placeholder).length;
/*
 * Redactions are colour-coded by what was taken out: people plum, ID numbers olive, contact details ocean. They stay
 * clear of the clinical key (violet medicine, teal finding, blue symptom, amber caution), and [LEAK] keeps the alert red
 * (must not miss). The chip's own label says the kind too, so colour is never the only cue.
 */
const PEOPLE = { color: "#8E3A78", backgroundColor: "rgba(142,58,120,0.12)" };
const ID_NUMBER = { color: "#5C6A1E", backgroundColor: "rgba(92,106,30,0.13)" };
const CONTACT = { color: "#1B6C8F", backgroundColor: "rgba(27,108,143,0.12)" };
const REDACTED: Record<Placeholder, { color: string; backgroundColor: string }> = { NAME: PEOPLE, IC: ID_NUMBER, MRN: ID_NUMBER, PHONE: CONTACT, EMAIL: CONTACT, LEAK: TINT.alert };
const chipStyle = (placeholder: Placeholder) => ({ fontWeight: "600" as const, ...REDACTED[placeholder] });

/** "OpenMed removed 4 names · 1 phone number", each count in its chips' colour: the card's key. */
function RemovedLine({ sample }: { sample: Sample }) {
  const { who, counts } = removed(sample.replacements, sample.deidentifier);
  return <Text style={{ ...type.footnote, flex: 1, color: palette.muted }}>
    {counts.length ? <>{who} removed {counts.map((c, i) => <Text key={c.placeholder}>{i ? " · " : ""}<Text style={{ fontWeight: "600", color: REDACTED[c.placeholder].color }}>{c.text}</Text></Text>)}</>
      : `${who} found nothing to remove`}
  </Text>;
}

/** A labelled side of the sample. Seen before: one selectable paragraph with inline chips. New: word by word, so each chip can be struck out. */
function Side({ label, text, muted = false, motion, first }: { label: string; text: string; muted?: boolean; motion?: Motion; first: number }) {
  const color = muted ? palette.muted : palette.ink;
  return <View accessible accessibilityLabel={`${label}: ${spoken(text)}`} style={{ flexDirection: "row", gap: 10 }}>
    <Text style={{ ...type.caption, width: 52, paddingTop: 2, fontWeight: "600", color: palette.muted }}>{label}</Text>
    {motion ? <Redacting text={text} color={color} motion={motion} first={first} />
      : <Text selectable style={{ ...type.callout, flex: 1, color }}>
        {placeholderParts(text).map((p, i) => p.placeholder ? <Text key={i} style={chipStyle(p.placeholder)}>{" "}{p.text}{" "}</Text> : p.text)}
      </Text>}
  </View>;
}

/*
 * The redaction, played once per new sample, after its card has risen in: in reading order, 70 ms apart, a marker in the
 * kind's colour strikes across each placeholder from the left (180 ms), holds, then lifts (200 ms) as the tinted chip fades in under it.
 * The original words are never on the device: the marker covers the chip's own label, so nothing is revealed. Reduced
 * motion: no marker, the chips only fade in.
 */
type Motion = "strike" | "fade";
const STRIKE_MS = 440, LIFT_AT = 240;
const strikeAt = (i: number) => 320 + 70 * i;
const STRIKE = {
  "0%": { opacity: 1, transform: [{ scaleX: 0 }] },
  "41%": { opacity: 1, transform: [{ scaleX: 1 }] },
  "55%": { opacity: 1, transform: [{ scaleX: 1 }] },
  "100%": { opacity: 0, transform: [{ scaleX: 1 }] },
};
const SHOW = { from: { opacity: 0 }, to: { opacity: 1 } };
const reveal = (delay: number, motion: Motion) =>
  ({ animationName: SHOW, animationDuration: 200, animationDelay: delay + (motion === "strike" ? LIFT_AT : 0), animationFillMode: "both", animationTimingFunction: EASE_OUT_CSS }) as const;

function Redacting({ text, color, motion, first }: { text: string; color: string; motion: Motion; first: number }) {
  let n = first;
  return <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 2 }}>
    {redactedWords(text).map((word, i) => <View key={i} style={{ flexDirection: "row", alignItems: "center" }}>
      {word.parts.map((p, j) => p.placeholder ? <RedactedChip key={j} part={p as Required<Part>} delay={strikeAt(n++)} motion={motion} />
        : <Text key={j} style={{ ...type.callout, color }}>{p.text}</Text>)}
      {word.space && <Text style={{ ...type.callout, color }}> </Text>}
    </View>)}
  </View>;
}

function RedactedChip({ part, delay, motion }: { part: Required<Part>; delay: number; motion: Motion }) {
  return <View>
    <Animated.Text style={[{ ...type.callout, paddingHorizontal: 4, ...chipStyle(part.placeholder) }, reveal(delay, motion)]}>{part.text}</Animated.Text>
    {motion === "strike" && <Animated.View pointerEvents="none" style={{
      position: "absolute", top: 1, bottom: 1, left: 0, right: 0, borderRadius: 3, backgroundColor: REDACTED[part.placeholder].color, transformOrigin: "left",
      animationName: STRIKE, animationDuration: STRIKE_MS, animationDelay: delay, animationFillMode: "both", animationTimingFunction: EASE_OUT_CSS,
    }} />}
  </View>;
}
