import { Text } from "@/components/sona/text";
import * as Haptics from "expo-haptics";
import { Image, type ImageSource } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, useSharedValue, withRepeat, withSpring, withTiming } from "react-native-reanimated";
import { Caption } from "@/components/sona/parts";
import { HalftoneShimmer } from "@/components/sona/halftone-shimmer";
import { EASE_OUT, LAYOUT, riseIn } from "@/components/sona/motion";
import { IconRow, Section } from "@/components/sona/sections";
import { palette } from "@/components/sona/theme";
import { Action, Chip, Expand, Glass, Icon, Notice, pillStyle, Reveal, Screen, SourceLink, Surface, surfaceStyle, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { Encounter, FeatureProps } from "@/features/encounter/types";
import { FindingsCard } from "@/features/findings";
import { useFindings } from "@/features/live/findings-sync";
import { useXrayUpload } from "@/features/live/xray-upload";
import { teachingImage, type TeachingImage } from "./fixture";
import { ImageEdge, OriginalImageViewer, VIEWING } from "./viewer";

export { OriginalImageViewer } from "./viewer";

type Scenario = NonNullable<Encounter["imagingScenario"]>;
const SCENARIOS: Record<Scenario, string> = { reference: "Reference", unsupported: "Unsupported category", "no-finding": "No finding result" };

function haptic() { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); }

/**
 * The answer in the conversation: the image as hero with one provenance line, what the source says,
 * then the one limit that travels with it. Tap the image to open the original.
 */
export function XrayCard({ onOpen, onRequest, result }: FeatureProps) {
  const { encounter } = useEncounter();
  const evidence = result?.imagingSnapshot ?? encounter;
  const sections = result?.sections ?? 3;
  const scenario = evidence?.imagingScenario ?? "reference";
  const superseded = Boolean(result && result.revision !== encounter?.revision);
  const busy = encounter?.requests.some(item => item.kind === "xray" && item.status === "streaming") ?? false;
  const requestState = result ? encounter?.requests.find(item => item.id === result.requestId) : undefined;
  const interrupted = requestState?.status === "failed" || requestState?.status === "cancelled";
  const attachment = evidence?.imagingAttachment;
  const referenceImage = evidence?.hideTeachingImage ? undefined : teachingImage;
  const [sourceError, setSourceError] = useState(false);
  const imageSource = attachment ? { uri: attachment.uri } : referenceImage?.source;
  const openOriginal = () => { if (result && (attachment || referenceImage)) router.push({ pathname: "/xray", params: { recordCardId: result.id, patientId: result.patientId } }); else onOpen("xray"); };
  return <View style={{ gap: 18 }}>
    <View style={{ gap: 8 }}>
      <Preview source={imageSource} label={attachment ? "Selected local teaching image" : referenceImage ? "Reference radiograph, unrelated to this patient" : "Add a teaching image"} onPress={openOriginal} />
      {attachment && <Caption icon={null}>{attachment.name} · local, not uploaded or analysed</Caption>}
      {!attachment && referenceImage && <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Caption icon={null}>Reference example, not this patient · {referenceImage.attribution} · {referenceImage.license}</Caption>
        <SourceLink label="Source" onPress={() => { void Linking.openURL(referenceImage.sourceUrl).catch(() => setSourceError(true)); }} />
      </View>}
      {sourceError && <Notice warning>The source page could not be opened. Attribution remains available here.</Notice>}
    </View>
    {sections < 2 && <AnalysisStatus interrupted={interrupted} />}
    {sections >= 2 && <Reveal><Findings scenario={scenario} attachment={Boolean(attachment)} summary={referenceImage?.referenceSummary} /></Reveal>}
    {sections === 2 && !interrupted && <Caption icon={null}>Completing provenance and limitations…</Caption>}
    {sections >= 3 && <Reveal><View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <Icon name="info.circle" size={15} color={palette.muted} />
      <Caption icon={null}>{attachment || scenario !== "reference"
        ? "Simulated response: no image-derived conclusion can be made. The original stays available to inspect."
        : "Describes only the published example, not this encounter, and does not establish model accuracy."}</Caption>
    </View></Reveal>}
    {superseded && <Notice>This response preserves an earlier image and scenario. New requests use the current encounter image.</Notice>}
    {(interrupted || sections >= 3 && scenario !== "reference") && <View style={{ alignSelf: "flex-start" }}>
      <Action label={superseded ? "Analyse current encounter image" : "Retry simulated analysis"} secondary icon="arrow.clockwise" disabled={busy} onPress={() => onRequest("xray")} />
    </View>}
  </View>;
}

/** The image as hero: a dark viewing tile that settles in (Arc's source-to-summary, calmed) and opens the original. */
function Preview({ source, label, onPress }: { source?: ImageSource | number; label: string; onPress: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View entering={reducedMotion ? undefined : riseIn({ distance: 8, scale: 0.97 })}>
    <Pressable accessibilityRole={source ? "imagebutton" : "button"} accessibilityLabel={label} accessibilityHint={source ? "Opens the original image" : undefined} onPress={onPress}
      style={({ pressed }) => ({ ...VIEWING, aspectRatio: 1.25, transform: [{ scale: pressed ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
      {source
        ? <Image source={source} contentFit="contain" style={{ flex: 1 }} transition={reducedMotion ? 0 : 200} />
        : <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}><Icon name="photo" size={32} color={palette.line} /><Text style={{ fontSize: 15, color: palette.line }}>Add a teaching image</Text></View>}
      {source && <View pointerEvents="none" style={{ position: "absolute", right: 12, bottom: 12, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" }}>
        <Icon name="arrow.up.left.and.arrow.down.right" size={14} color={palette.white} />
      </View>}
      <ImageEdge />
    </Pressable>
  </Animated.View>;
}

/** While the fixture streams: a quiet status with a halftone sweep beside the image, never over its pixels. */
function AnalysisStatus({ interrupted }: { interrupted: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sweep = useSharedValue(0);
  const live = !interrupted && !reducedMotion;
  useEffect(() => {
    if (!live) return;
    sweep.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1));
    return () => cancelAnimation(sweep);
  }, [live, sweep]);
  return <View accessibilityLiveRegion="polite" onLayout={e => setSize(e.nativeEvent.layout)} style={[surfaceStyle, { borderRadius: 18, padding: 14, gap: 3 }]}>
    {live && size.width > 0 && <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: 17, overflow: "hidden" }}><HalftoneShimmer width={size.width} height={size.height} progress={sweep} /></View>}
    <Text style={{ fontSize: 14, fontWeight: "600", color: interrupted ? palette.amber : palette.ink }}>{interrupted ? "Response interrupted" : "Analysing · simulated workflow"}</Text>
    <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>{interrupted ? "The preview and attachment are kept." : "Preparing the fixture response. No image inference is running."}</Text>
  </View>;
}

/** Only ever the source's own description or an honest unavailable state; nothing is read from the pixels. */
/** What an X-ray answer said, shown under the image so the viewer and its analysis are one page. */
function AnalysisDetails({ snapshot }: { snapshot?: Pick<Encounter, "imagingAttachment" | "hideTeachingImage" | "imagingScenario"> }) {
  if (!snapshot) return null;
  const attachment = Boolean(snapshot.imagingAttachment);
  const scenario = snapshot.imagingScenario ?? "reference";
  const summary = snapshot.hideTeachingImage ? undefined : teachingImage?.referenceSummary;
  return <View style={{ gap: 14 }}>
    <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "600", letterSpacing: -0.2, color: palette.ink }}>Analysis</Text>
    <Findings scenario={scenario} attachment={attachment} summary={summary} />
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <Icon name="info.circle" size={15} color={palette.muted} />
      <Caption icon={null}>{attachment || scenario !== "reference" ? "Simulated response: no image-derived conclusion can be made." : "Describes only the published example, not this encounter, and does not establish model accuracy."}</Caption>
    </View>
  </View>;
}

function Findings({ scenario, attachment, summary }: { scenario: Scenario; attachment: boolean; summary?: string }) {
  if (scenario === "unsupported") return <Notice warning>Unsupported category (simulation): outside chest radiography. No interpretation is available, and the image has not been classified by a model.</Notice>;
  if (scenario === "no-finding" || attachment) return <IconRow icon="eye.slash" title="Findings unavailable" detail={attachment ? "Nothing has been read from this image. Its modality and clinical meaning have not been verified." : "This sample returned no finding result. That does not establish a normal examination."} />;
  if (summary) return <IconRow icon="text.quote" title="In the uploader’s words, not a model reading" detail={summary} />;
  return <Notice>No image is attached and no findings have been generated.</Notice>;
}

/** Focused viewer page: canvas like `Screen`, but a gesture-handler scroll view that stops scrolling while the image is zoomed. */
function ViewerPage({ children, scrollEnabled = true }: { children: ReactNode; scrollEnabled?: boolean }) {
  return <ScrollView scrollEnabled={scrollEnabled} style={{ flex: 1, backgroundColor: palette.canvas, experimental_backgroundImage: "linear-gradient(to bottom, #F5F6F8 0%, #EFF2F7 45%, #E3EBF7 100%)" }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 44, gap: 20 }}>{children}</ScrollView>;
}
/** The screen's one header line: whose image this is, or that it is not this patient's. */
function Identity({ children, trailing }: { children: string; trailing?: ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, zIndex: 2 }}>
    <Text selectable accessibilityRole="header" style={{ flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600", color: palette.blue }}>{children}</Text>
    {trailing}
  </View>;
}

/** Menu pop (after Edits' discard menu): scales up from the trigger with a subtle spring overshoot while it fades in. */
const MENU_SPRING = { duration: 300, dampingRatio: 0.8 };
function menuIn() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -6 }, { scale: 0.9 }] },
    animations: { opacity: withTiming(1, { duration: 150, easing: EASE_OUT }), transform: [{ translateY: withSpring(0, MENU_SPRING) }, { scale: withSpring(1, MENU_SPRING) }] },
  };
}

type MenuItem = { label: string; icon: string; disabled?: boolean; onPress: () => void };
/** The `⋯` trigger, placed in the navigation header's right slot; it dips while its menu is open. */
function MenuTrigger({ open, onPress }: { open: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Image options" accessibilityState={{ expanded: open }} onPress={() => { haptic(); onPress(); }} hitSlop={6}
    style={({ pressed }) => ({ ...pillStyle, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.96 : open ? 0.92 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
    <Icon name="ellipsis" size={18} />
  </Pressable>;
}
/** Secondary image actions: a compact glass menu that springs open from the header's `⋯`. */
function MenuPanel({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View entering={reducedMotion ? FadeIn.duration(120) : menuIn} exiting={FadeOut.duration(120)} style={{ position: "absolute", top: 0, right: 0, width: 224, zIndex: 10, transformOrigin: "top right", boxShadow: "0 12px 32px rgba(24,32,48,0.18)", borderRadius: 18 }}>
    <Glass style={{ borderRadius: 18, paddingVertical: 4 }}>
      {items.map(item => <Pressable key={item.label} accessibilityRole="button" accessibilityState={{ disabled: item.disabled }} disabled={item.disabled} onPress={() => { onClose(); item.onPress(); }}
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, opacity: item.disabled ? 0.4 : 1, backgroundColor: pressed ? "rgba(20,28,40,0.06)" : "transparent" })}>
        <Icon name={item.icon} size={17} />
        <Text style={{ fontSize: 15, color: palette.ink }}>{item.label}</Text>
      </Pressable>)}
    </Glass>
  </Animated.View>;
}

export function XrayScreen() {
  const { patient, encounter, updateEncounter, request, showDemoControls } = useEncounter();
  const { recordCardId, patientId: sourcePatientId } = useLocalSearchParams<{ recordCardId?: string; patientId?: string }>();
  const savedCard = recordCardId ? encounter?.cards.find(card => card.id === recordCardId && card.kind === "xray" && card.patientId === patient?.id && card.encounterId === patient?.encounterId) : undefined;
  const historical = Boolean(recordCardId);
  const evidence = historical ? savedCard?.imagingSnapshot : encounter;
  const { reducedMotion } = useAccessibleEffects();
  const layout = reducedMotion ? undefined : LAYOUT;
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string>();
  const [showScenarios, setShowScenarios] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const activePatient = useRef(patient?.id);
  // Live backend mode: the chosen image is also uploaded to the server (not analysed there either).
  const server = useXrayUpload();
  // Demo flow 6: findings beyond the question asked, marked on the image and listed under it.
  const found = useFindings();
  const findings = found.findings.filter(f => f.encounterId === patient?.encounterId);
  const markers = useMemo(() => findings.filter(f => f.status !== "dismissed").map(f => ({ id: f.id, n: findings.indexOf(f) + 1, x: f.location.x, y: f.location.y, label: f.label, box: f.location.box })), [findings.map(f => `${f.id}:${f.status}`).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // The finding under the torch; one tap on a marker or its row, and a dismissed finding lets go of it.
  const [focus, setFocus] = useState<string>();
  const focused = markers.some(m => m.id === focus) ? focus : undefined;
  const focusOn = useCallback((id: string | undefined) => { haptic(); setFocus(current => (id === current ? undefined : id)); }, []);
  useEffect(() => { if (patient) found.detect(patient.encounterId); }, [found.live, patient?.encounterId]); // eslint-disable-line react-hooks/exhaustive-deps
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  activePatient.current = patient?.id;
  const pickImage = async () => {
    if (picking || historical) return;
    const patientId = patient?.id;
    setPicking(true); setPickerError(undefined);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false, base64: server.live, quality: server.live ? 0.8 : undefined });
      if (result.canceled || !mounted.current || activePatient.current !== patientId) return;
      const asset = result.assets[0];
      if (!asset) return;
      updateEncounter(current => ({ ...current, imagingAttachment: { uri: asset.uri, name: asset.fileName ?? "Selected teaching image" } }), true);
      if (server.live && patient) void server.send(patient.encounterId, asset);
    } catch { setPickerError("The photo library could not be opened. Try again or check access in Settings."); }
    finally { setPicking(false); }
  };
  const attachment = evidence?.imagingAttachment;
  const referenceImage = evidence?.hideTeachingImage ? undefined : teachingImage;
  // A local image has no source page: its provenance line says it stays on this device and is not analysed.
  const upload = attachment && server.upload?.uri === attachment.uri ? server.upload : undefined;
  const kept = !upload ? "Kept on this device · not uploaded or analysed"
    : upload.state === "uploading" ? "Uploading to the live backend (synthetic) · not analysed"
    : upload.state === "uploaded" ? "Uploaded to the live backend (synthetic) · not analysed"
    : `Kept on this device · upload failed: ${upload.error} · not analysed`;
  const image: TeachingImage | undefined = attachment ? { id: attachment.uri, source: { uri: attachment.uri }, title: attachment.name, attribution: kept, license: "rights and deidentification not verified", sourceUrl: "" } : referenceImage;
  const analysing = encounter?.requests.some(item => item.kind === "xray" && item.status === "streaming") ?? false;
  const analyse = () => { if (!image || analysing || historical) return; request("xray", "Analyse X-ray · simulated workflow"); if (router.canGoBack()) router.back(); };
  const scenario = evidence?.imagingScenario ?? "reference";
  const pickScenario = (value: Scenario) => { if (analysing) return; haptic(); updateEncounter(current => ({ ...current, imagingScenario: value }), true); setShowScenarios(false); };

  if (!patient) return <Screen><Notice>Choose a patient before opening an attachment.</Notice></Screen>;
  if (historical && (sourcePatientId !== patient.id || !savedCard?.imagingSnapshot)) return <Screen><Notice warning>This saved image is unavailable in the active patient’s encounter. No current image has been substituted.</Notice><Action label="Return to encounter" secondary onPress={() => (router.canGoBack() ? router.back() : undefined)} /></Screen>;
  if (historical) return <ViewerPage scrollEnabled={!zoomed}>
    <Identity>{`${patient.name} · saved revision ${savedCard?.revision} · ${attachment ? "local image, no model inference" : "reference example, not this patient"}`}</Identity>
    {image ? <OriginalImageViewer key={image.id} asset={image} onZoomChange={setZoomed} /> : <Notice>No image was attached when this response was created.</Notice>}
    <AnalysisDetails snapshot={savedCard?.imagingSnapshot} />
  </ViewerPage>;

  if (!image) return <ViewerPage>
    <Identity>{`${patient.name} · no image attached`}</Identity>
    <Section icon="photo" tone="blue" title="An original image belongs here" subtitle="Image review will preserve the original pixels, with zoom, pan and reset controls.">
      <View style={[VIEWING, { minHeight: 250, alignItems: "center", justifyContent: "center", gap: 18, padding: 26 }]}>
        <Icon name="photo.badge.exclamationmark" color={palette.line} size={40} />
        <Text selectable style={{ color: palette.line, fontSize: 16, lineHeight: 24, textAlign: "center" }}>No licensed teaching radiograph has been attached to this demonstration.</Text>
        <ImageEdge />
      </View>
      <Notice>There is no image analysis result to interpret. This empty state does not indicate a normal chest X-ray.</Notice>
    </Section>
    <Surface feature style={{ padding: 18, gap: 14 }}>
      <Text selectable style={{ fontSize: 15, lineHeight: 21, color: palette.muted, paddingRight: 40 }}>{`Choose a deidentified teaching image you have permission to use. ${server.live ? "Live backend mode uploads it to the server; it" : "It stays on this device and"} is not analysed.`}</Text>
      <Action label={picking ? "Opening photo library…" : "Choose teaching image"} icon="photo.badge.plus" disabled={picking} onPress={pickImage} />
      {pickerError && <Notice warning>{pickerError}</Notice>}
    </Surface>
    <Action label="Restore bundled reference" secondary onPress={() => updateEncounter(current => ({ ...current, hideTeachingImage: false }))} />
  </ViewerPage>;

  return <ViewerPage scrollEnabled={!zoomed}>
    {/* Image actions live in the header's right slot, level with the back button. */}
    <Stack.Screen options={{ headerRight: () => <MenuTrigger open={menuOpen} onPress={() => setMenuOpen(value => !value)} /> }} />
    {menuOpen && <MenuPanel onClose={() => setMenuOpen(false)} items={[
      { label: picking ? "Opening library…" : "Choose local image", icon: "photo.on.rectangle", disabled: picking || analysing, onPress: pickImage },
      { label: "Remove image", icon: "trash", disabled: analysing, onPress: () => updateEncounter(current => ({ ...current, imagingAttachment: undefined, hideTeachingImage: true }), true) },
    ]} />}
    <Identity>{attachment ? `${patient.name} · local teaching image` : "Reference example · not this patient"}</Identity>
    {pickerError && <Notice warning>{pickerError}</Notice>}
    <OriginalImageViewer key={image.id} asset={image} onZoomChange={setZoomed} markers={markers} focus={focused} onFocus={focusOn} />
    <FindingsCard findings={findings} error={found.error} focus={focused} onFocus={focusOn} onTrack={f => void found.track(f)} onDismiss={(f, reason) => void found.dismiss(f, reason)} />
    {/* The latest analysis sits right under the image: one page, no separate details screen. */}
    <AnalysisDetails snapshot={encounter?.cards.findLast(card => card.kind === "xray" && card.imagingSnapshot)?.imagingSnapshot} />

    {/* The one feature surface: the simulated review this screen asks for. */}
    <Surface feature layout={layout} style={{ padding: 18, gap: 14 }}>
      <View style={{ gap: 4, paddingRight: 40 }}>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "600", letterSpacing: -0.2, color: palette.ink }}>Simulated review</Text>
        <Text selectable style={{ fontSize: 14, lineHeight: 20, color: palette.muted }}>Sends a sample response. No model reads or classifies this image.</Text>
      </View>
      {showDemoControls && <Animated.View layout={layout} pointerEvents={analysing ? "none" : "auto"} style={{ gap: 10, opacity: analysing ? 0.45 : 1 }}>
        <View style={{ alignSelf: "flex-start" }}>
          <Chip label={`Demo response: ${SCENARIOS[scenario]}`} filled expanded={showScenarios} onPress={() => { haptic(); setShowScenarios(value => !value); }} accessibilityLabel={`Demo response, ${SCENARIOS[scenario]}. Change`} />
        </View>
        {showScenarios && <Expand key="scenarios" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(Object.keys(SCENARIOS) as Scenario[]).map(value => <Chip key={value} label={SCENARIOS[value]} selected={scenario === value} onPress={() => pickScenario(value)} />)}
        </Expand>}
      </Animated.View>}
      <Animated.View layout={layout}>
        <Action label={analysing ? "Analysing · simulation…" : "Analyse X-ray · simulation"} icon="sparkles" disabled={analysing || picking} onPress={analyse} />
      </Animated.View>
    </Surface>
  </ViewerPage>;
}
