import { SAMPLE_SCAN_KEY } from "@sona-ai/api/contracts";
import { medicineLabel, SAMPLE_NOTE, scanDoneLine, segments, unsureWords, type HandwrittenNote, type MedicineChange, type ScanSections } from "@sona-ai/domain/scan";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Keyboard, Modal, Pressable, TextInput, View, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { CaptureScan } from "@/components/sona/capture-scan";
import { SampleLabel } from "@/components/sona/model-answer";
import { EASE_OUT, LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Expand, Icon, IconButton, Notice, Screen, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { WithSona } from "@/features/ask";
import { toCheck } from "@/features/ask/answers";
import { useEncounter } from "@/features/encounter/store";
import { OriginalImageViewer } from "@/features/imaging/viewer";
import { api, errorText, requestId, useLive } from "@/features/live";
import { LockedAction, useRole } from "@/features/live/roles";
import { useServerEncounter } from "@/features/live/sync";
import { wakingOf } from "@/features/live/waking";
import { applyLocally, countsOf, itemsOf, keptOf, replaceWord, type ItemKey } from "./model";
import { NoVisit } from "@/components/sona/no-visit";

/**
 * Scan a handwritten note: photograph a ward-round note, drug chart or referral letter, watch it read,
 * then review every item before anything reaches the record.
 *   Capture: camera or library, frozen under the capture scan (CaptureScan, confirm mode).
 *   Reading (after 60fps "Remy AI Analysis Checklist Animation",
 *   https://60fps.design/shots/remy-ai-analysis-checklist-animation): the photo shrinks into a thumbnail
 *   at the top while a checklist rises beneath it, each check popping in with a soft glow, 600 ms apart
 *   (live: the upload and the read, each as it returns).
 *   Review (after 60fps "Recollect Value Prop Morph Interaction",
 *   https://60fps.design/shots/recollect-value-prop-morph-interaction, calmed): the thumbnail settles as
 *   a card and what was read springs out beneath it in groups, 70 ms apart, on a near-critical spring.
 * Reduce Motion: the photo is a thumbnail from the start, the checklist fills without pops, groups fade.
 * Nothing is written until "Add to the record"; fixture mode applies to the local draft, live mode via scan.apply.
 */
type Photo = { source: number | { uri: string }; sample: boolean; base64?: string | null; mimeType?: string | null };
type Reading = HandwrittenNote & ({ source: "fixture" } | { source: "model"; model: string });
type Phase =
  | { kind: "start"; error?: string }
  | { kind: "confirm"; photo: Photo }
  | { kind: "reading"; photo: Photo; error?: string }
  | { kind: "review"; photo: Photo; key: string; reading: Reading }
  | { kind: "done"; photo: Photo; line: string; medicines: number };

const SAMPLE = require("../../assets/scan/sample-ward-note.jpg") as number;
const STEPS = ["Reading handwriting", "Finding medicines", "Finding tasks", "Structuring the note"];
// Live: the real calls, each ticked as it returns (the bundled sample is already stored, so it is only read).
const LIVE_STEPS = ["Uploading the photo", "Reading the note"];
const SECTION_TITLE: Record<keyof ScanSections, string> = { history: "History", examination: "Examination", assessment: "Assessment", plan: "Plan" };
// The reconciliation colours (as on the discharge card): changed amber, new blue, stopped and continuing neutral.
const TAG: Record<MedicineChange, { label: string; ink: string; fill: string }> = {
  changed: { label: "Changed", ink: palette.amber, fill: "rgba(196,120,20,0.12)" },
  new: { label: "New", ink: palette.blue, fill: "rgba(36,91,204,0.1)" },
  stopped: { label: "Stopped", ink: palette.muted, fill: "rgba(20,28,40,0.06)" },
  continue: { label: "Continue", ink: palette.muted, fill: "rgba(20,28,40,0.06)" },
};
const UNSURE = { color: palette.amber, textDecorationLine: "underline", textDecorationColor: palette.amber, backgroundColor: "rgba(196,120,20,0.10)" } as const;
const haptic = (kind: "tap" | "done" | "warn") => {
  if (process.env.EXPO_OS !== "ios") return;
  if (kind === "tap") Haptics.selectionAsync().catch(() => {});
  else Haptics.notificationAsync(kind === "done" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
};
const first = (name: string) => name.split(" ")[0]!;

export function ScanScreen() {
  const { patient, updateEncounter, request } = useEncounter();
  const { on: live } = useLive();
  const role = useRole();
  const { refresh } = useServerEncounter(patient);
  const [phase, setPhase] = useState<Phase>({ kind: "start" });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  // The checklist decides when the review appears (it waits for the reading); see Checklist.
  const [ready, setReady] = useState<{ photo: Photo; key: string; reading: Reading }>();
  const [uploaded, setUploaded] = useState(false);

  if (!patient) return <NoVisit view="scan" what="a scan" />;
  if (!role.can("scan.read")) return <Screen><LockedAction label="Needs a doctor to scan a note" path="scan.read" /></Screen>;
  const { encounterId } = patient;

  const pick = async (from: "camera" | "library") => {
    if (busy) return;
    setBusy(true);
    try {
      if (from === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) { setPhase({ kind: "start", error: "Camera access is off. Choose from the library, or allow the camera in Settings." }); return; }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: false, base64: live, quality: 0.8 };
      const result = from === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset) setPhase({ kind: "confirm", photo: { source: { uri: asset.uri }, sample: false, base64: asset.base64, mimeType: asset.mimeType } });
    } catch {
      setPhase({ kind: "start", error: from === "camera" ? "No camera here (a simulator has none). Choose from the library or use the sample note." : "The photo library could not be opened. Try again or check access in Settings." });
    } finally { setBusy(false); }
  };

  // Live: upload (unless it is the bundled sample) and read on the server; fixture mode: the sample reading, honestly labelled.
  const read = async (photo: Photo) => {
    setPhase({ kind: "reading", photo }); setUploaded(false);
    try {
      let key = SAMPLE_SCAN_KEY, reading: Reading = { ...structuredClone(SAMPLE_NOTE), source: "fixture" };
      if (live) {
        if (!photo.sample) {
          if (!photo.base64) throw new Error("The photo could not be read for upload");
          key = (await api.scan.upload({ encounterId, contentType: photo.mimeType ?? "image/jpeg", dataBase64: photo.base64 })).key;
          setUploaded(true);
        }
        reading = await api.scan.read({ encounterId, key }) as Reading;
      }
      return { key, reading };
    } catch (e) {
      haptic("warn");
      setPhase({ kind: "reading", photo, error: errorText(e) });
    }
  };

  const start = async (photo: Photo) => {
    const got = await read(photo);
    if (got) setReady({ photo, ...got });
  };
  const showReview = () => { if (ready) setPhase({ kind: "review", ...ready }); };

  const apply = async (note: HandwrittenNote, off: ReadonlySet<ItemKey>, key: string, photo: Photo) => {
    const kept = keptOf(note, off);
    const from = `From a scanned handwritten note (${key})`;
    const id = requestId();
    setBusy(true);
    try {
      let line: string;
      if (live) {
        line = (await api.scan.apply({ encounterId, key, requestId: id, ...kept })).line;
        void refresh(true).catch(() => {});
      } else {
        updateEncounter(current => applyLocally(current, patient, kept, from, `scan-${id}`), true);
        line = scanDoneLine(countsOf(kept));
      }
      haptic("done");
      AccessibilityInfo.announceForAccessibility(line);
      setPhase({ kind: "done", photo, line, medicines: countsOf(kept).medicines });
    } catch (e) {
      haptic("warn");
      throw new Error(errorText(e));
    } finally { setBusy(false); }
  };

  return <View style={{ flex: 1 }} onLayout={e => setBox(e.nativeEvent.layout)}>
    {phase.kind === "start" && <Start patientName={patient.name} live={live} busy={busy} error={phase.error}
      onCamera={() => void pick("camera")} onLibrary={() => void pick("library")} onSample={() => setPhase({ kind: "confirm", photo: { source: SAMPLE, sample: true } })} />}

    {(phase.kind === "reading" || phase.kind === "done") && <Screen>
      <Text selectable style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{patient.name} · scanned note</Text>
      <PhotoHeader photo={phase.photo} settled={phase.kind === "done"} />
      {phase.kind === "reading" && <Checklist steps={live ? LIVE_STEPS.slice(phase.photo.sample ? 1 : 0) : STEPS} returned={live ? Number(uploaded) : undefined} ready={Boolean(ready)} error={phase.error} onFinished={showReview}
        onRetry={() => { setReady(undefined); void start(phase.photo); }} onSample={() => { setReady(undefined); void start({ source: SAMPLE, sample: true }); }} />}
      {phase.kind === "done" && <Done line={phase.line} medicines={phase.medicines} live={live}
        onNote={() => router.replace("/note")} onMedicines={() => { request("medication"); if (router.canGoBack()) router.back(); }}
        onAnother={() => { setReady(undefined); setPhase({ kind: "start" }); }} />}
    </Screen>}
    {/* The thumbnail is already small when the review mounts, so it reads as the same card staying put. */}
    {phase.kind === "review" && <Review key={phase.key} patientFirst={first(patient.name)} reading={phase.reading} live={live} busy={busy}
      header={<>
        <Text selectable style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{patient.name} · scanned note</Text>
        <PhotoHeader photo={phase.photo} settled source={phase.reading} />
      </>}
      onApply={(note, off) => apply(note, off, phase.key, phase.photo)} />}

    {/* No crop here: the reading uploads the original photo's base64. */}
    {phase.kind === "confirm" && box.width > 0 && <CaptureScan source={phase.photo.source} width={box.width} height={box.height} suggested="Document" crop={false}
      confirm={{ title: "Read this note?", line: "Sona reads it, then you review every item. Nothing is added until you do.", action: "Read note" }}
      onRetake={() => setPhase({ kind: "start" })} onAttach={() => { setReady(undefined); void start(phase.photo); }} />}
  </View>;
}

/** Insight first: what this does and that nothing is added without review; then the three ways in. */
function Start({ patientName, live, busy, error, onCamera, onLibrary, onSample }: { patientName: string; live: boolean; busy: boolean; error?: string; onCamera: () => void; onLibrary: () => void; onSample: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Screen>
    <Animated.View entering={reducedMotion ? undefined : riseIn({ distance: 8 })} style={{ gap: 6 }}>
      <Text selectable accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>Paper to {first(patientName)}’s record</Text>
      <Text selectable style={{ ...type.callout, color: palette.muted }}>Ward-round notes, drug charts and referral letters become note sections, medicine changes and tasks. You review every item before anything is added.</Text>
    </Animated.View>
    <Animated.View entering={reducedMotion ? undefined : riseIn({ delay: 60, distance: 10 })}>
      <Surface feature style={{ padding: 18, gap: 12 }}>
        <Action label={busy ? "Opening…" : "Take photo"} icon="camera" disabled={busy} onPress={onCamera} />
        <Action label="Choose from library" icon="photo.on.rectangle" secondary disabled={busy} onPress={onLibrary} />
        <Action label="Use sample note" icon="doc.text" secondary disabled={busy} onPress={onSample} />
        {error && <Notice warning>{error}</Notice>}
        <Text selectable style={{ ...type.footnote, color: palette.muted }}>{live
          ? "The photo stays in your hospital’s storage."
          : "The photo stays on this device. Until the handwriting model is switched on, the reading is a sample."}</Text>
      </Surface>
    </Animated.View>
  </Screen>;
}

/**
 * The photo: large at first, shrinking into a 72 pt thumbnail at the top (520 ms, ease-out) while the
 * checklist starts; in review it is a card with the source line, and tapping it opens the original.
 */
function PhotoHeader({ photo, settled, source }: { photo: Photo; settled: boolean; source?: Reading }) {
  const { width } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const [open, setOpen] = useState(false);
  // Mounted settled (review, done), it is a thumbnail from the start; only the reading shrinks it.
  const [shrink] = useState(!settled && !reducedMotion);
  const p = useSharedValue(shrink ? 0 : 1);
  useEffect(() => { if (shrink) p.set(withDelay(250, withTiming(1, { duration: 520, easing: EASE_OUT }))); }, [shrink, p]);
  const full = width - 40;
  const image = useAnimatedStyle(() => ({ width: interpolate(p.value, [0, 1], [full, 72]), height: interpolate(p.value, [0, 1], [full * 1.1, 92]), borderRadius: interpolate(p.value, [0, 1], [24, 14]) }));
  const words = source ? unsureWords(source).length : 0;
  return <>
    <Pressable accessibilityRole="imagebutton" accessibilityLabel="Scanned note photo" accessibilityHint="Opens the original to compare with the reading" disabled={!settled} onPress={() => { haptic("tap"); setOpen(true); }}>
      <Surface layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 10, borderRadius: radius.card, flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Animated.View style={[{ overflow: "hidden", borderCurve: "continuous", backgroundColor: palette.dark }, image]}>
          <Image source={photo.source} contentFit="cover" style={{ flex: 1 }} accessibilityIgnoresInvertColors />
        </Animated.View>
        {settled && <Animated.View entering={reducedMotion ? undefined : riseIn({ distance: 4, duration: 300 })} style={{ flex: 1, gap: 3 }}>
          <Text style={{ ...type.headline, color: palette.ink }}>{photo.sample ? "Sample ward-round note" : "Your photo"}</Text>
          {source?.source === "fixture" ? <SampleLabel source="fixture" waking={wakingOf(source)} what="handwriting" />
            : source && <Text style={{ ...type.footnote, color: palette.muted }}>Read by {source.model} · check every item</Text>}
          <Text style={{ ...type.caption, color: palette.blue }}>{words ? `${words} ${words === 1 ? "word" : "words"} to check · ` : ""}Tap to compare</Text>
        </Animated.View>}
      </Surface>
    </Pressable>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.canvas }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, paddingLeft: 20 }}>
          <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Original photo</Text>
          <IconButton name="xmark" label="Close photo" onPress={() => setOpen(false)} />
        </View>
        <View style={{ paddingHorizontal: 20 }}>
          <OriginalImageViewer asset={{ id: "scan", source: photo.source, title: "scanned note", attribution: photo.sample ? "Sample photo" : "Your photo", license: "pinch or double-tap to zoom", sourceUrl: "" }} />
        </View>
      </GestureHandlerRootView>
    </Modal>
  </>;
}

/** The pop: from 0.6 on a lively spring (the only bounce on this screen). */
function popIn() {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 140 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.55 }) }] } };
}
/** The glow: a green halo that swells and fades behind the check. */
function glowOut() {
  "worklet";
  return { initialValues: { opacity: 0.55, transform: [{ scale: 1 }] }, animations: { opacity: withTiming(0, { duration: 650, easing: EASE_OUT }), transform: [{ scale: withTiming(2.1, { duration: 650, easing: EASE_OUT }) }] } };
}

/**
 * The steps rising in, then the review. Demo: ticked 600 ms apart, the last waiting for the reading. Live
 * (`returned`, the calls back so far): each step ticks when its call returns, and the last with the reading.
 */
function Checklist({ steps, returned, ready, error, onFinished, onRetry, onSample }: { steps: string[]; returned?: number; ready: boolean; error?: string; onFinished: () => void; onRetry: () => void; onSample: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const [timed, setTimed] = useState(0);
  const cap = error ? 0 : ready ? steps.length : steps.length - 1;
  const ticked = returned === undefined ? timed : ready ? steps.length : returned;
  useEffect(() => {
    if (returned !== undefined || timed >= cap) return;
    const t = setTimeout(() => setTimed(n => Math.min(cap, n + 1)), timed === 0 ? 900 : 600);
    return () => clearTimeout(t);
  }, [timed, cap, returned]);
  useEffect(() => {
    if (ticked !== steps.length) return;
    haptic("done");
    const t = setTimeout(onFinished, reducedMotion ? 150 : 450);
    return () => clearTimeout(t);
  }, [ticked, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Expand>
    <Surface style={{ padding: 18, gap: 12 }}>
      <Notice warning>{`The note could not be read: ${error}`}</Notice>
      <Action label="Try again" icon="arrow.clockwise" onPress={onRetry} />
      <Action label="Use sample note" secondary onPress={onSample} />
    </Surface>
  </Expand>;
  return <Surface style={{ padding: 8, gap: 0 }}>
    <View accessibilityLiveRegion="polite">
      {steps.map((step, i) => {
        const done = i < ticked, current = i === ticked;
        return <Animated.View key={step} entering={reducedMotion ? undefined : riseIn({ delay: 300 + i * 90, distance: 18 })} accessible accessibilityLabel={`${step}, ${done ? "done" : current ? "in progress" : "waiting"}`}
          style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 12 }}>
          <View style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center" }}>
            {done ? <>
              {!reducedMotion && <Animated.View entering={glowOut} style={{ position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(15,110,102,0.45)" }} />}
              <Animated.View entering={reducedMotion ? undefined : popIn} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: palette.green, alignItems: "center", justifyContent: "center", boxShadow: "0 0 10px rgba(15,110,102,0.45)" }}>
                <Icon name="checkmark" size={13} color={palette.white} />
              </Animated.View>
            </> : <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: current ? palette.blue : palette.line }} />}
          </View>
          <Text style={{ ...type.callout, fontWeight: done ? "600" : "400", color: done ? palette.ink : current ? palette.ink : palette.muted }}>{step}</Text>
        </Animated.View>;
      })}
    </View>
  </Surface>;
}

/** Recollect's payoff, calmed: groups spring out from under the card, 70 ms apart, barely overshooting. */
const groupIn = (i: number) => () => {
  "worklet";
  const spring = { duration: 480, dampingRatio: 0.82 };
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -14 }, { scale: 0.96 }] },
    animations: { opacity: withDelay(i * 70, withTiming(1, { duration: 220 })), transform: [{ translateY: withDelay(i * 70, withSpring(0, spring)) }, { scale: withDelay(i * 70, withSpring(1, spring)) }] },
  };
};

function Check({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={() => { haptic("tap"); onToggle(); }} hitSlop={4}
    style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -8 }}>
    <Icon name={on ? "checkmark.circle.fill" : "circle"} size={22} color={on ? palette.blue : palette.line} />
  </Pressable>;
}

function Group({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View entering={reducedMotion ? undefined : groupIn(index)} layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted, paddingLeft: 4 }}>{title}</Text>
    <Surface style={{ paddingVertical: 6, paddingHorizontal: 14 }}>{children}</Surface>
  </Animated.View>;
}

function Row({ children, last }: { children: ReactNode; last?: boolean }) {
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, paddingVertical: 6, borderBottomWidth: last ? 0 : 1, borderColor: "rgba(20,28,40,0.06)" }}>{children}</View>;
}

/** Everything read, grouped and ticked; unsure words underlined in amber and fixable in place; one action. */
function Review({ header, patientFirst, reading, live, busy, onApply }: { header: ReactNode; patientFirst: string; reading: Reading; live: boolean; busy: boolean; onApply: (note: HandwrittenNote, off: ReadonlySet<ItemKey>) => Promise<void> }) {
  const { reducedMotion } = useAccessibleEffects();
  const [note, setNote] = useState<HandwrittenNote>(reading);
  const [unsure, setUnsure] = useState(() => unsureWords(reading));
  const [off, setOff] = useState<ReadonlySet<ItemKey>>(new Set());
  const [editing, setEditing] = useState<keyof ScanSections>();
  const [fixing, setFixing] = useState<{ word: string; to: string }>();
  const [error, setError] = useState<string>();
  const toggle = (k: ItemKey) => setOff(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const items = itemsOf(note), sections = items.filter(k => k.startsWith("section:")).map(k => k.slice(8) as keyof ScanSections);
  const counts = countsOf(keptOf(note, off));
  const any = items.some(k => !off.has(k));
  const fix = () => {
    if (!fixing) return;
    const to = fixing.to.trim();
    if (to && to !== fixing.word) setNote(n => replaceWord(n, fixing.word, to));
    setUnsure(u => u.filter(w => w !== fixing.word));
    setFixing(undefined); Keyboard.dismiss(); haptic("tap");
  };
  const preview = [
    counts.sections && `${counts.sections} ${counts.sections === 1 ? "section" : "sections"} to the note${live ? "" : " draft"}`,
    counts.medicines && `${counts.medicines} ${counts.medicines === 1 ? "medicine" : "medicines"} to confirm`,
    counts.tasks && `${counts.tasks} ${counts.tasks === 1 ? "task" : "tasks"}`,
  ].filter(Boolean).join(" · ");
  let group = 0;
  // Sona beside the decision: the unsure words and low-confidence medicines still to check, and what is unticked.
  const label = (k: ItemKey) => k === "followUp" ? `Follow-up in ${note.followUp?.in ?? ""}` : k.startsWith("section:") ? SECTION_TITLE[k.slice(8) as keyof ScanSections]
    : k.startsWith("med:") ? medicineLabel(note.medicines[Number(k.slice(4))]!) : note.tasks[Number(k.slice(5))]?.title ?? k;
  const check = toCheck({ unsure, off: items.filter(k => off.has(k)).map(k => ({ id: k, label: label(k) })),
    low: note.medicines.flatMap((m, i) => m.confidence === "low" && !off.has(`med:${i}`) ? [{ id: `low-${i}`, label: medicineLabel(m) }] : []) });

  // Review before deciding: what will happen sits on the button's bar; nothing is written before the tap.
  return <WithSona scope="scan" inline answers={[check]}><Screen bottom={<>
    <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: error ? palette.amber : palette.muted, paddingHorizontal: 4 }}>
      {error ?? (any ? `Adds ${preview || "nothing new"} · recorded as from this scanned note` : "Tick at least one item to add")}
    </Text>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}><Action label={busy ? "Adding…" : `Add to ${patientFirst}’s record`} icon="plus" disabled={!any || busy}
        onPress={() => { setError(undefined); onApply(note, off).catch((e: Error) => setError(e.message)); }} /></View>
    </View>
  </>}>
    {header}
    {/* Insight first: what was found, and how much still needs your eyes. */}
    <Animated.View entering={reducedMotion ? undefined : groupIn(group++)}>
      <Text selectable style={{ ...type.headline, color: palette.ink }}>
        {`${sections.length} sections · ${note.medicines.length} medicine ${note.medicines.length === 1 ? "change" : "changes"} · ${note.tasks.length + (note.followUp ? 1 : 0)} to do`}
        {unsure.length > 0 && <Text style={{ color: palette.amber }}>{` · ${unsure.length} ${unsure.length === 1 ? "word" : "words"} to check`}</Text>}
      </Text>
    </Animated.View>

    {sections.length > 0 && <Group index={group++} title="Note sections">
      {sections.map((k, i) => {
        const key = `section:${k}` as const, parts = segments(note.sections[k], unsure);
        const inside = unsure.filter(w => parts.some(p => p.unsure && p.text === w));
        return <Row key={k} last={i === sections.length - 1}>
          <Check on={!off.has(key)} label={`Add ${SECTION_TITLE[k]}`} onToggle={() => toggle(key)} />
          <View style={{ flex: 1, gap: 4, paddingTop: 10, opacity: off.has(key) ? 0.45 : 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{SECTION_TITLE[k]}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={editing === k ? `Done editing ${SECTION_TITLE[k]}` : `Edit ${SECTION_TITLE[k]}`} onPress={() => { haptic("tap"); setEditing(e => e === k ? undefined : k); }} hitSlop={12} style={{ minHeight: 32, justifyContent: "center" }}>
                <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{editing === k ? "Done" : "Edit"}</Text>
              </Pressable>
            </View>
            {editing === k
              ? <TextInput accessibilityLabel={`${SECTION_TITLE[k]} text`} value={note.sections[k]} onChangeText={v => setNote(n => ({ ...n, sections: { ...n.sections, [k]: v } }))} multiline autoFocus
                style={{ ...type.callout, color: palette.ink, padding: 10, borderRadius: radius.control, backgroundColor: "rgba(255,255,255,0.8)", borderWidth: 1, borderColor: "rgba(36,91,204,0.4)", minHeight: 64 }} />
              : <Text selectable={false} accessibilityActions={inside.map(w => ({ name: `check-${w}`, label: `Check “${w}”` }))}
                  onAccessibilityAction={e => { const w = e.nativeEvent.actionName.slice(6); setFixing({ word: w, to: w }); }}
                  style={{ ...type.callout, color: palette.ink }}>
                  {parts.map((p, j) => p.unsure
                    ? <Text key={j} onPress={() => { haptic("tap"); setFixing({ word: p.text, to: p.text }); }} style={UNSURE}>{p.text}</Text>
                    : <Text key={j}>{p.text}</Text>)}
                </Text>}
            {fixing && inside.includes(fixing.word) && editing !== k && <Expand key={`fix-${fixing.word}`} style={{ gap: 8, paddingTop: 4 }}>
              <Text style={{ ...type.footnote, color: palette.amber }}>{`Handwriting unclear: read as “${fixing.word}”. Compare with the photo, then keep or correct it.`}</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput accessibilityLabel={`Correct “${fixing.word}”`} value={fixing.to} onChangeText={to => setFixing(f => f && { ...f, to })} onSubmitEditing={fix} autoFocus autoCapitalize="none" returnKeyType="done"
                  style={{ flex: 1, height: 44, paddingHorizontal: 12, borderRadius: radius.control, ...type.callout, color: palette.ink, backgroundColor: "rgba(255,255,255,0.85)", borderWidth: 1, borderColor: "rgba(196,120,20,0.4)" }} />
                <Action label={fixing.to.trim() && fixing.to.trim() !== fixing.word ? "Correct" : "Keep"} onPress={fix} />
              </View>
            </Expand>}
          </View>
        </Row>;
      })}
    </Group>}

    {note.medicines.length > 0 && <Group index={group++} title="Medicines">
      {note.medicines.map((m, i) => {
        const key = `med:${i}` as const, tag = TAG[m.change];
        return <Row key={i} last={i === note.medicines.length - 1}>
          <Check on={!off.has(key)} label={`Add ${medicineLabel(m)}, ${tag.label}`} onToggle={() => toggle(key)} />
          <View style={{ flex: 1, gap: 4, paddingTop: 10, opacity: off.has(key) ? 0.45 : 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ ...type.callout, fontWeight: "600", color: palette.ink, textDecorationLine: m.change === "stopped" ? "line-through" : "none" }}>{m.name}</Text>
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: tag.fill }}><Text style={{ ...type.caption, fontWeight: "700", color: tag.ink }}>{tag.label}</Text></View>
            </View>
            <Text style={{ ...type.footnote, color: palette.muted }}>
              {[m.dose, m.frequency].filter(Boolean).map((part, j) => <Text key={j} style={unsure.some(w => part!.split(/\s+/).includes(w)) ? UNSURE : undefined}>{j ? " " : ""}{part}</Text>)}
            </Text>
            <Text style={{ ...type.caption, color: m.confidence === "low" ? palette.amber : palette.muted }}>
              {m.change === "continue" ? "No change to the list" : `Joins medicines unconfirmed${m.confidence === "low" ? " · read with low confidence, check the photo" : ""}`}
            </Text>
          </View>
        </Row>;
      })}
    </Group>}

    {(note.tasks.length > 0 || note.followUp) && <Group index={group++} title="Tasks and follow-up">
      {note.tasks.map((t, i) => {
        const key = `task:${i}` as const;
        return <Row key={i} last={!note.followUp && i === note.tasks.length - 1}>
          <Check on={!off.has(key)} label={`Create task: ${t.title}`} onToggle={() => toggle(key)} />
          <View style={{ flex: 1, gap: 2, paddingTop: 10, opacity: off.has(key) ? 0.45 : 1 }}>
            <Text style={{ ...type.callout, fontWeight: "600", color: palette.ink }}>{t.title}</Text>
            <Text style={{ ...type.footnote, color: palette.muted }}>{[t.due, t.owner].filter(Boolean).join(" · ") || "No date or owner written"}</Text>
          </View>
        </Row>;
      })}
      {note.followUp && <Row last>
        <Check on={!off.has("followUp")} label={`Create a task to book follow-up in ${note.followUp.in}`} onToggle={() => toggle("followUp")} />
        <View style={{ flex: 1, gap: 2, paddingTop: 10, opacity: off.has("followUp") ? 0.45 : 1 }}>
          <Text style={{ ...type.callout, fontWeight: "600", color: palette.ink }}>Follow-up in {note.followUp.in}</Text>
          <Text style={{ ...type.footnote, color: palette.muted }}>A task to book it</Text>
        </View>
      </Row>}
    </Group>}
  </Screen></WithSona>;
}

/** The receipt, then the likely next move: confirm the medicine, read the note, or scan the next page. */
function Done({ line, medicines, live, onNote, onMedicines, onAnother }: { line: string; medicines: number; live: boolean; onNote: () => void; onMedicines: () => void; onAnother: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View entering={reducedMotion ? undefined : groupIn(0)}>
    <Surface feature style={{ padding: 18, gap: 14 }}>
      <View accessible style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Animated.View entering={reducedMotion ? undefined : popIn} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: palette.green, alignItems: "center", justifyContent: "center" }}>
          <Icon name="checkmark" size={16} color={palette.white} />
        </Animated.View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.headline, color: palette.ink }}>{line}</Text>
          <Text style={{ ...type.footnote, color: palette.muted }}>{live ? "Saved to the record as from a scanned handwritten note." : "Added to this visit’s draft as from a scanned handwritten note. Save the note to keep it."}</Text>
        </View>
      </View>
      {medicines > 0 && <Action label="Confirm medicines" icon="pills" onPress={onMedicines} />}
      <Action label={live ? "Open the note" : "Review and save the note"} icon="doc.text" secondary={medicines > 0} onPress={onNote} />
      <Action label="Scan another page" icon="doc.viewfinder" secondary onPress={onAnother} />
    </Surface>
  </Animated.View>;
}
