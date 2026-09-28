import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { Host, Switch } from "@expo/ui";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { TINT } from "@/components/sona/marked-text";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Caption, ErrorLine } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Body, Card, Label, Notice, Screen, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import { api, errorText, useLive } from "@/features/live";
import { useRole } from "@/features/live/roles";
import { exported, insight, leakLine, placeholderParts, spoken } from "./model";

type Status = Awaited<ReturnType<AppRouterClient["training"]["status"]>>;
type Sample = Awaited<ReturnType<AppRouterClient["training"]["samples"]>>[number];
type Exported = Awaited<ReturnType<AppRouterClient["training"]["export"]>>;

const TEAL = "#0F6E66";
const SOURCE: Record<string, string> = { "note-edit": "Note edit", "check-in-reply": "Check-in reply", transcript: "Transcript" };
// Both sides of a sample, named for what they are: the scribe's draft vs the doctor's saved note (the edit is the signal).
const SIDES: Record<string, [string, string]> = { "note-edit": ["Draft", "Saved"], "check-in-reply": ["Reply", "Read as"], transcript: ["Heard", "Written"] };
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
 * the hospital's contribute switch, each de-identified sample with its placeholders marked and
 * Approve / Exclude in place, then the export with its receipt. Re-read whenever the screen focuses.
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
      .then(([s, list]) => { setStatus(s); setSamples(list); }, e => setLoadError(errorText(e)));
  }, []);
  useFocusEffect(useCallback(() => { if (allowed) void load(); }, [allowed, load]));

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

  return <Screen>
    <View accessible accessibilityRole="header" style={{ gap: 6 }}>
      <Label>Training data · live</Label>
      <Text selectable style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{status ? insight(status) : loadError ? "Training data didn't load" : "Reading training data…"}</Text>
    </View>
    {loadError && <ErrorLine text={loadError} onRetry={() => void load()} />}

    {status && <Surface style={{ padding: 16, gap: 8 }}>
      <Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Contribute de-identified data" value={status.contributes} onValueChange={toggle} /></Host>
      <Text style={{ ...type.footnote, color: palette.muted }}>Only patients who opted in are captured. Names, IC and phone numbers are replaced before a sample reaches this screen.</Text>
      {switchError && <ErrorLine text={switchError} />}
    </Surface>}

    {samples && !queue.length && <Body muted>Nothing to review — samples appear when consented patients reply or doctors save notes.</Body>}
    {queue.map((s, i) => <Animated.View key={s.id} entering={rise(i)} layout={reducedMotion ? undefined : LAYOUT}>
      <SampleCard sample={s} busy={busy === s.id} error={cardError[s.id]} onDecide={d => decide(s, d)} />
    </Animated.View>)}

    {status && <Card feature label="Dataset">
      <Text style={{ ...type.subhead, color: palette.ink }}>{ready
        ? `${ready} approved ${ready === 1 ? "row" : "rows"} will export as v${next}, after a fresh leak check.`
        : status.lastDataset ? `Everything approved is in v${status.lastDataset.version}.` : "Approve samples to build the first dataset."}</Text>
      <Action label={exporting ? "Exporting…" : "Export dataset"} icon="square.and.arrow.up" disabled={exporting || !ready} onPress={runExport} />
      {receipt && <View accessible accessibilityLiveRegion="polite" style={{ gap: 2 }}>
        <Text style={{ ...type.subhead, fontWeight: "600", color: TEAL }}>{exported(receipt)}</Text>
        <Text selectable style={{ ...type.caption, color: palette.muted }}>{receipt.key}</Text>
      </View>}
      {exportNote && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: exportNote.red ? palette.red : palette.muted }}>{exportNote.text}</Text>}
    </Card>}

    {status && <View style={{ gap: 6 }}>
      <Caption icon="shield.lefthalf.filled">{status.deidentifier === "rules" ? "Rule-based de-identification · OpenMed when hosted" : `De-identified by ${status.deidentifier}`}</Caption>
      <Caption icon="info.circle">Export only — fine-tuning on Baseten isn't connected yet</Caption>
    </View>}
  </Screen>;
}

/** One sample: where it came from, who (without saying who), both sides with placeholders marked, and the decision in place. */
function SampleCard({ sample, busy, error, onDecide }: { sample: Sample; busy: boolean; error?: string; onDecide: (d: "approve" | "exclude") => void }) {
  const blocked = sample.status === "blocked";
  const settled = SETTLED[sample.status];
  const [inLabel, outLabel] = SIDES[sample.source] ?? ["Input", "Output"];
  return <Surface style={{ padding: 16, gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ paddingHorizontal: 9, height: 22, borderRadius: 11, justifyContent: "center", backgroundColor: palette.blueWash }}>
        <Text style={{ ...type.caption, fontWeight: "700", color: palette.blue }}>{SOURCE[sample.source] ?? sample.source}</Text>
      </View>
      <Text numberOfLines={1} style={{ ...type.footnote, flex: 1, color: palette.muted }}>{sample.patientLabel}</Text>
      {settled && <Text style={{ ...type.caption, fontWeight: "700", color: settled[1] }}>{settled[0]}</Text>}
    </View>
    <Side label={inLabel} text={sample.input} muted={sample.source === "note-edit"} />
    <Side label={outLabel} text={sample.output} />
    {blocked && <Text style={{ ...type.footnote, fontWeight: "600", color: palette.red }}>{leakLine(sample.leak)}</Text>}
    {error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    {!settled && <View style={{ flexDirection: "row", gap: 8 }}>
      {!blocked && <View style={{ flex: 1 }}><Action label="Approve" accessibilityLabel={`Approve ${SOURCE[sample.source] ?? "sample"}, ${sample.patientLabel}`} disabled={busy} onPress={() => onDecide("approve")} /></View>}
      <View style={{ flex: 1 }}><Action label="Exclude" secondary accessibilityLabel={`Exclude ${SOURCE[sample.source] ?? "sample"}, ${sample.patientLabel}`} disabled={busy} onPress={() => onDecide("exclude")} /></View>
    </View>}
  </Surface>;
}

/** A labelled side of the sample; placeholders are quiet grey chips, and [LEAK] is red (must not miss). */
function Side({ label, text, muted = false }: { label: string; text: string; muted?: boolean }) {
  return <View accessible accessibilityLabel={`${label}: ${spoken(text)}`} style={{ flexDirection: "row", gap: 10 }}>
    <Text style={{ ...type.caption, width: 52, paddingTop: 2, fontWeight: "600", color: palette.muted }}>{label}</Text>
    <Text selectable style={{ ...type.callout, flex: 1, color: muted ? palette.muted : palette.ink }}>
      {placeholderParts(text).map((p, i) => p.placeholder
        ? <Text key={i} style={{ fontWeight: "600", ...p.placeholder === "LEAK" ? TINT.alert : { color: palette.muted, backgroundColor: "rgba(20,28,40,0.07)" } }}>{" "}{p.text}{" "}</Text>
        : p.text)}
    </Text>
  </View>;
}
