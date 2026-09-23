import { Text } from "@/components/sona/text";
import * as Haptics from "expo-haptics";
import { Image, type ImageSource } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { HalftoneShimmer } from "@/components/sona/halftone-shimmer";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { IconRow, Section } from "@/components/sona/sections";
import { palette } from "@/components/sona/theme";
import { Action, Body, Chip, Expand, Icon, Notice, Reveal, Screen, SourceLink, Surface, surfaceStyle, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { Encounter, FeatureProps } from "@/features/encounter/types";
import { teachingImage, type TeachingImage } from "./fixture";
import { ImageEdge, OriginalImageViewer, VIEWING } from "./viewer";

export { OriginalImageViewer } from "./viewer";

type Scenario = NonNullable<Encounter["imagingScenario"]>;
const SCENARIOS: Record<Scenario, string> = { reference: "Reference", unsupported: "Unsupported category", "no-finding": "No finding result" };

function haptic() { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); }

/**
 * The answer in the conversation, as generated sections: the image as hero with its provenance,
 * then what the source says, then the limits that travel with it. Tap the image to open the original.
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
  return <View style={{ gap: 34 }}>
    <Section title={attachment ? "Your attached image" : referenceImage ? "Reference radiograph" : "No image attached"}
      subtitle={attachment ? "User-selected local image · no upload or inference." : referenceImage ? "Reference example — not model analysis or this patient’s image." : "Add a teaching image to review it here."}>
      <Preview source={imageSource} label={attachment ? "Selected local teaching image" : referenceImage ? "Reference radiograph, unrelated to this patient" : "Add a teaching image"} onPress={openOriginal} />
      <View style={{ gap: 2 }}>
        <Text selectable style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>{attachment?.name ?? (referenceImage ? referenceImage.title : "Teaching image not attached")}</Text>
        {!attachment && referenceImage && <>
          <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>{referenceImage.attribution} · {referenceImage.license}</Text>
          <SourceLink label="Read original description & license" onPress={() => { void Linking.openURL(referenceImage.sourceUrl).catch(() => setSourceError(true)); }} />
        </>}
      </View>
      {sourceError && <Notice warning>The source page could not be opened. Attribution remains available here.</Notice>}
      {sections < 2 && <AnalysisStatus interrupted={interrupted} />}
    </Section>

    {sections >= 2 && <Reveal><Findings scenario={scenario} attachment={Boolean(attachment)} summary={referenceImage?.referenceSummary} partial={sections < 3} /></Reveal>}
    {sections >= 3 && <Reveal><Section title="What this can’t tell you" subtitle="Limits that stay with this response.">
      {attachment || scenario !== "reference"
        ? <IconRow icon="eye.slash" title="No image-derived conclusion" detail="No image-derived conclusion can be made from this simulated response. Its original attachment remains available for inspection." />
        : <IconRow icon="person.crop.circle.badge.questionmark" title="Only the published example" detail="This summary belongs only to the published example. It does not assess the current encounter or establish model accuracy." />}
    </Section></Reveal>}
    {sections === 2 && !interrupted && <Text style={{ fontSize: 13, color: palette.muted }}>Completing provenance and limitations…</Text>}

    {superseded && <Notice>This response preserves an earlier image and scenario. New requests use the current encounter image.</Notice>}
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Action label={attachment || referenceImage ? "Open original image" : "Add a teaching image"} icon="arrow.up.left.and.arrow.down.right" onPress={openOriginal} />
        {(interrupted || sections >= 3 && scenario !== "reference") && <Action label={superseded ? "Analyse current encounter image" : "Retry simulated analysis"} secondary icon="arrow.clockwise" disabled={busy} onPress={() => onRequest("xray")} />}
      </View>
      {sections >= 3 && <Text style={{ fontSize: 12, color: palette.muted }}>Fixture response complete</Text>}
    </View>
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
function Findings({ scenario, attachment, summary, partial }: { scenario: Scenario; attachment: boolean; summary?: string; partial: boolean }) {
  if (scenario === "unsupported") return <Section title="Outside chest radiography" subtitle="Unsupported category · simulation">
    <Notice warning>This sample response represents a category outside chest radiography. No interpretation is available. The attached image has not been classified by a model.</Notice>
  </Section>;
  if (scenario === "no-finding" || attachment) return <Section title="Findings unavailable" subtitle={attachment ? "Nothing has been read from this image." : "Sample response · no finding result"}>
    <Body muted>{attachment ? "The selected image has no linked interpretation. Its modality and clinical meaning have not been verified." : "This fixture returned no finding result. An unavailable result does not establish a normal examination."}</Body>
  </Section>;
  if (summary) return <Section title="What the source describes" subtitle={partial ? "Partial reference response" : "In the uploader’s words, not a model reading."}>
    <IconRow icon="text.quote" title="Source-described finding" detail={summary} />
  </Section>;
  return <Section title="No findings" subtitle="There is no image to describe."><Notice>No image is attached and no findings have been generated.</Notice></Section>;
}

/** Focused viewer page: canvas like `Screen`, but a gesture-handler scroll view that stops scrolling while the image is zoomed. */
function ViewerPage({ children, scrollEnabled = true }: { children: ReactNode; scrollEnabled?: boolean }) {
  return <ScrollView scrollEnabled={scrollEnabled} style={{ flex: 1, backgroundColor: palette.canvas, experimental_backgroundImage: "linear-gradient(to bottom, #F5F6F8 0%, #EFF2F7 45%, #E3EBF7 100%)" }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 44, gap: 20 }}>{children}</ScrollView>;
}
function Identity({ title, detail }: { title: string; detail: string }) {
  return <View style={{ gap: 4 }}>
    <Text selectable style={{ fontSize: 13, fontWeight: "600", color: palette.blue }}>{title}</Text>
    <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>{detail}</Text>
  </View>;
}

export function XrayScreen() {
  const { patient, encounter, updateEncounter, request } = useEncounter();
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
  const activePatient = useRef(patient?.id);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  activePatient.current = patient?.id;
  const pickImage = async () => {
    if (picking || historical) return;
    const patientId = patient?.id;
    setPicking(true); setPickerError(undefined);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false });
      if (result.canceled || !mounted.current || activePatient.current !== patientId) return;
      const asset = result.assets[0];
      if (!asset) return;
      updateEncounter(current => ({ ...current, imagingAttachment: { uri: asset.uri, name: asset.fileName ?? "Selected teaching image" } }), true);
    } catch { setPickerError("The photo library could not be opened. Try again or check access in Settings."); }
    finally { setPicking(false); }
  };
  const attachment = evidence?.imagingAttachment;
  const referenceImage = evidence?.hideTeachingImage ? undefined : teachingImage;
  const image: TeachingImage | undefined = attachment ? { id: attachment.uri, source: { uri: attachment.uri }, title: attachment.name, attribution: "User-selected local image", license: "Rights and deidentification not verified by this prototype", sourceUrl: "Kept on this device · no upload or inference" } : referenceImage;
  const analysing = encounter?.requests.some(item => item.kind === "xray" && item.status === "streaming") ?? false;
  const analyse = () => { if (!image || analysing || historical) return; request("xray", "Analyse X-ray · simulated workflow"); router.dismissTo("/"); };
  const scenario = evidence?.imagingScenario ?? "reference";
  const pickScenario = (value: Scenario) => { if (analysing) return; haptic(); updateEncounter(current => ({ ...current, imagingScenario: value }), true); setShowScenarios(false); };

  if (!patient) return <Screen><Notice>Choose a patient before opening an attachment.</Notice></Screen>;
  if (historical && (sourcePatientId !== patient.id || !savedCard?.imagingSnapshot)) return <Screen><Notice warning>This saved image is unavailable in the active patient’s encounter. No current image has been substituted.</Notice><Action label="Return to encounter" secondary onPress={() => router.dismissTo("/")} /></Screen>;
  if (historical) return <ViewerPage scrollEnabled={!zoomed}>
    <Identity title={`${patient.name} · saved response revision ${savedCard?.revision}`} detail={attachment ? "Original local attachment · no model inference" : "Original reference example · unrelated to this patient"} />
    {image ? <OriginalImageViewer key={image.id} asset={image} onZoomChange={setZoomed} /> : <Notice>No image was attached when this response was created.</Notice>}
    <Action label="Open current image & analysis" secondary onPress={() => router.replace("/xray")} />
  </ViewerPage>;

  if (!image) return <ViewerPage>
    <Identity title={`${patient.name} · ${patient.id}`} detail="Attachment unavailable" />
    <Section title="An original image belongs here" subtitle="Image review will preserve the original pixels, with zoom, pan and reset controls.">
      <View style={[VIEWING, { minHeight: 250, alignItems: "center", justifyContent: "center", gap: 18, padding: 26 }]}>
        <Icon name="photo.badge.exclamationmark" color={palette.line} size={40} />
        <Text selectable style={{ color: palette.line, fontSize: 16, lineHeight: 24, textAlign: "center" }}>No licensed teaching radiograph has been attached to this demonstration.</Text>
        <ImageEdge />
      </View>
      <Notice>There is no image analysis result to interpret. This empty state does not indicate a normal chest X-ray.</Notice>
    </Section>
    <Surface feature style={{ padding: 18, gap: 14 }}>
      <Text selectable style={{ fontSize: 15, lineHeight: 21, color: palette.muted, paddingRight: 40 }}>Choose a deidentified teaching image you have permission to use. It stays on this device and is not analysed.</Text>
      <Action label={picking ? "Opening photo library…" : "Choose teaching image"} icon="photo.badge.plus" disabled={picking} onPress={pickImage} />
      {pickerError && <Notice warning>{pickerError}</Notice>}
    </Surface>
    <Action label="Restore bundled reference" secondary onPress={() => updateEncounter(current => ({ ...current, hideTeachingImage: false }))} />
  </ViewerPage>;

  return <ViewerPage scrollEnabled={!zoomed}>
    <Identity title={attachment ? `${patient.name} · local teaching image` : "Reference example · unrelated to this patient"} detail="No model analysis has been run." />
    <OriginalImageViewer key={image.id} asset={image} onZoomChange={setZoomed} />

    {/* The one feature surface: the simulated review this screen asks for. */}
    <Surface feature layout={layout} style={{ padding: 18, gap: 14 }}>
      <View style={{ gap: 4, paddingRight: 40 }}>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "600", letterSpacing: -0.2, color: palette.ink }}>Simulated review</Text>
        <Text selectable style={{ fontSize: 14, lineHeight: 20, color: palette.muted }}>Sends a sample response to the conversation. It does not classify or read this image.</Text>
      </View>
      <Animated.View layout={layout} pointerEvents={analysing ? "none" : "auto"} style={{ gap: 10, opacity: analysing ? 0.45 : 1 }}>
        <View style={{ alignSelf: "flex-start" }}>
          <Chip label={`Demo response: ${SCENARIOS[scenario]}`} filled expanded={showScenarios} onPress={() => { haptic(); setShowScenarios(value => !value); }} accessibilityLabel={`Demo response, ${SCENARIOS[scenario]}. Change`} />
        </View>
        {showScenarios && <Expand key="scenarios" style={{ gap: 10 }}>
          <Text selectable style={{ fontSize: 13, lineHeight: 19, color: palette.muted }}>Choose a UI sample response. This does not classify the image.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(Object.keys(SCENARIOS) as Scenario[]).map(value => <Chip key={value} label={SCENARIOS[value]} selected={scenario === value} onPress={() => pickScenario(value)} />)}
          </View>
        </Expand>}
      </Animated.View>
      <Animated.View layout={layout}>
        <Action label={analysing ? "Analysing · simulation…" : "Analyse X-ray · simulation"} icon="sparkles" disabled={analysing || picking} onPress={analyse} />
      </Animated.View>
    </Surface>

    <Animated.View layout={layout} style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Action label={picking ? "Opening library…" : "Choose local image"} icon="photo.on.rectangle" secondary disabled={picking || analysing} onPress={pickImage} />
        <Action label="Remove image" icon="trash" secondary disabled={analysing} onPress={() => updateEncounter(current => ({ ...current, imagingAttachment: undefined, hideTeachingImage: true }), true)} />
      </View>
      {pickerError && <Notice warning>{pickerError}</Notice>}
    </Animated.View>
  </ViewerPage>;
}
