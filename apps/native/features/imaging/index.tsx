import { Text } from "@/components/sona/text";
import { Image } from "expo-image";
import { BottomSheet, Button as NativeButton, Column, Host, Text as NativeText } from "@expo/ui";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Action, Body, Card, Icon, Label, Notice, Reveal, Screen, SourceLink } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { teachingImage, type TeachingImage } from "./fixture";

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
  return <Card label={attachment ? "Imaging · local attachment" : "Imaging · reference example"} title="Chest X-ray" footer={sections >= 3 ? attachment ? <Body muted>User-selected local image · no upload or inference.</Body> : referenceImage ? <><Body muted>{referenceImage.attribution} · {referenceImage.license}</Body><SourceLink label="Read original description & license" onPress={() => { void Linking.openURL(referenceImage.sourceUrl).catch(() => setSourceError(true)); }} />{sourceError && <Notice warning>The source page could not be opened. Attribution remains available here.</Notice>}</> : undefined : undefined}>
    <View style={{ minHeight: 164, backgroundColor: "#252930", borderRadius: 18, padding: 22, justifyContent: "center", alignItems: "center", gap: 12 }}>
      {imageSource ? <Image source={imageSource} contentFit="contain" style={{ width: "100%", height: 220 }} accessibilityLabel={attachment ? "Selected local teaching image" : "Reference radiograph, unrelated to this patient"} /> : <Icon name="photo" size={32} color="#BDC9D8" />}
      <Text selectable style={{ color: "#E7EDF5", fontSize: 15, textAlign: "center" }}>{attachment?.name ?? (referenceImage ? referenceImage.title : "Teaching image not attached")}</Text>
    </View>
    <Notice>{attachment ? "Local image · no model analysis or upload." : "Reference example — not model analysis or this patient’s image."}</Notice>
    {sections < 2 && <View accessibilityLiveRegion="polite" style={{ gap: 8 }}><Label muted>{interrupted ? "Response interrupted" : "Analysing · simulated workflow"}</Label><Body muted>{interrupted ? "The preview and attachment are kept." : "Preparing the fixture response. No image inference is running."}</Body></View>}
    {sections >= 2 && <Reveal>{scenario === "unsupported" ? <><Label>Unsupported category · simulation</Label><Notice warning>This sample response represents a category outside chest radiography. No interpretation is available. The attached image has not been classified by a model.</Notice></> : scenario === "no-finding" || attachment ? <><Label muted>Findings unavailable</Label><Body muted>{attachment ? "The selected image has no linked interpretation. Its modality and clinical meaning have not been verified." : "This fixture returned no finding result. An unavailable result does not establish a normal examination."}</Body></> : referenceImage?.referenceSummary ? <><Label>{sections < 3 ? "Partial reference response" : "Source-described finding"}</Label><Body>{referenceImage.referenceSummary}</Body></> : <Notice>No image is attached and no findings have been generated.</Notice>}</Reveal>}
    {sections >= 3 && <Reveal><View style={{ gap: 8 }}><Label muted>Limitations</Label><Body muted>{attachment || scenario !== "reference" ? "No image-derived conclusion can be made from this simulated response. Its original attachment remains available for inspection." : "This summary belongs only to the published example. It does not assess the current encounter or establish model accuracy."}</Body></View><Label muted>Fixture response complete</Label></Reveal>}
    {sections === 2 && !interrupted && <Body muted>Completing provenance and limitations…</Body>}
    {superseded && <Notice>This response preserves an earlier image and scenario. New requests use the current encounter image.</Notice>}
    {(interrupted || sections >= 3 && scenario !== "reference") && <Action label={superseded ? "Analyse current encounter image" : "Retry simulated analysis"} secondary icon="arrow.clockwise" disabled={busy} onPress={() => onRequest("xray")} />}
    <Action label={attachment || referenceImage ? "Open original image" : "Add a teaching image"} icon="arrow.up.left.and.arrow.down.right" onPress={() => { if (result && (attachment || referenceImage)) router.push({ pathname: "/xray", params: { recordCardId: result.id, patientId: result.patientId } }); else onOpen("xray"); }} />
  </Card>;
}

/** Gesture transforms affect positioning only; no filter, tint, blur or shader touches pixels. */
export function OriginalImageViewer({ asset }: { asset: TeachingImage }) {
  const { height, width } = useWindowDimensions();
  const imageHeight = Math.max(240, Math.min(500, height * 0.44, width * 1.15));
  const [sourceError, setSourceError] = useState(false);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const reset = () => { scale.set(1); startScale.set(1); x.set(0); y.set(0); startX.set(0); startY.set(0); };
  const gestures = useMemo(() => {
    const pinch = Gesture.Pinch().enabled(status === "ready").onStart(() => { startScale.set(scale.get()); }).onUpdate(event => {
      scale.set(Math.max(1, Math.min(5, startScale.get() * event.scale)));
      const boundX = viewport.width * (scale.get() - 1) / 2;
      const boundY = viewport.height * (scale.get() - 1) / 2;
      x.set(Math.max(-boundX, Math.min(boundX, x.get())));
      y.set(Math.max(-boundY, Math.min(boundY, y.get())));
    });
    const pan = Gesture.Pan().enabled(status === "ready").maxPointers(1).onTouchesDown((_event, manager) => {
      // At fit-to-screen size, a swipe scrolls the page instead of a stationary image.
      if (scale.get() <= 1) manager.fail();
    }).onStart(() => { startX.set(x.get()); startY.set(y.get()); }).onUpdate(event => {
      const boundX = viewport.width * (scale.get() - 1) / 2;
      const boundY = viewport.height * (scale.get() - 1) / 2;
      x.set(Math.max(-boundX, Math.min(boundX, startX.get() + event.translationX)));
      y.set(Math.max(-boundY, Math.min(boundY, startY.get() + event.translationY)));
    });
    return Gesture.Simultaneous(pinch, pan);
  }, [scale, startScale, x, y, startX, startY, viewport, status]);
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));
  return <View style={{ gap: 16 }}>
    <View style={{ height: imageHeight, overflow: "hidden" }} onLayout={event => { setViewport(event.nativeEvent.layout); reset(); }}>
      <GestureDetector gesture={gestures}><Animated.View style={[{ width: "100%", height: "100%" }, transform]}>
        <Image key={`${asset.id}-${attempt}`} source={asset.source} contentFit="contain" style={{ width: "100%", height: "100%" }} accessibilityLabel={`Original teaching image: ${asset.title}`} onLoadStart={() => setStatus("loading")} onLoad={() => setStatus("ready")} onError={() => setStatus("failed")} />
      </Animated.View></GestureDetector>
      {status !== "ready" && <View style={{ position: "absolute", inset: 0, backgroundColor: "#171A1F", justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}>
        {status === "loading" ? <><ActivityIndicator color="#DCE7F8" /><Text style={{ color: "#DCE7F8" }}>Loading original image…</Text></> : <><Text selectable style={{ color: "#DCE7F8", textAlign: "center" }}>This attachment could not be opened.</Text><Action label="Retry image" secondary onPress={() => { setStatus("loading"); setAttempt(value => value + 1); }} /></>}
      </View>}
    </View>
    <Text style={{ color: "#BEC8D6", fontSize: 13, textAlign: "center" }}>Pinch to zoom · drag to inspect</Text>
    <View style={{ flexDirection: "row", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
      <Action label="Zoom in" secondary disabled={status !== "ready"} onPress={() => scale.set(Math.min(5, scale.get() + 0.5))} />
      <Action label="Reset view" secondary disabled={status !== "ready"} onPress={reset} />
    </View>
    <Text selectable style={{ color: "#BEC8D6", fontSize: 12, lineHeight: 18 }}>{asset.attribution} · {asset.license}</Text>
    {asset.sourceUrl.startsWith("https://") ? <Pressable accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }} onPress={() => { void Linking.openURL(asset.sourceUrl).catch(() => setSourceError(true)); }}><Text style={{ color: "#AAC7F6", fontSize: 14 }}>Original source & license ↗</Text></Pressable> : <Text selectable style={{ color: "#BEC8D6", fontSize: 12 }}>{asset.sourceUrl}</Text>}
    {sourceError && <Text selectable style={{ color: "#DCE7F8", fontSize: 13 }}>Source page unavailable. Try again when connected.</Text>}
  </View>;
}

export function XrayScreen() {
  const { patient, encounter, updateEncounter, request } = useEncounter();
  const { recordCardId, patientId: sourcePatientId } = useLocalSearchParams<{ recordCardId?: string; patientId?: string }>();
  const savedCard = recordCardId ? encounter?.cards.find(card => card.id === recordCardId && card.kind === "xray" && card.patientId === patient?.id && card.encounterId === patient?.encounterId) : undefined;
  const historical = Boolean(recordCardId);
  const evidence = historical ? savedCard?.imagingSnapshot : encounter;
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string>();
  const activePatient = useRef(patient?.id);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  activePatient.current = patient?.id;
  const insets = useSafeAreaInsets();
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
  const [showScenarios, setShowScenarios] = useState(false);
  if (!patient) return <Screen><Notice>Choose a patient before opening an attachment.</Notice></Screen>;
  if (historical && (sourcePatientId !== patient.id || !savedCard?.imagingSnapshot)) return <Screen><Notice warning>This saved image is unavailable in the active patient’s encounter. No current image has been substituted.</Notice><Action label="Return to encounter" secondary onPress={() => router.dismissTo("/")} /></Screen>;
  if (historical) return <ScrollView style={{ flex: 1, backgroundColor: "#171A1F" }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 12 }}><Text selectable style={{ color: "#E5EBF3", fontSize: 15 }}>{patient.name} · saved response revision {savedCard?.revision}</Text><Text selectable style={{ color: "#BEC8D6", fontSize: 13 }}>{attachment ? "Original local attachment · no model inference" : "Original reference example · unrelated to this patient"}</Text>{image ? <OriginalImageViewer key={image.id} asset={image} /> : <Notice>No image was attached when this response was created.</Notice>}<Action label="Open current image & analysis" secondary onPress={() => router.replace("/xray")} /></ScrollView>;
  if (!image) return <Screen>
    <Label>{patient.name} · {patient.id}</Label>
    <Card label="Attachment unavailable" title="An original image belongs here">
      <View style={{ backgroundColor: "#252930", minHeight: 250, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 20, padding: 26 }}><Icon name="photo.badge.exclamationmark" color="#BEC8D6" size={44} /><Text selectable style={{ color: "#DCE7F8", fontSize: 16, lineHeight: 24, textAlign: "center" }}>No licensed teaching radiograph has been attached to this demonstration.</Text></View>
      <Body>Image review will preserve the original pixels, with zoom, pan and reset controls.</Body>
      <Notice>There is no image analysis result to interpret. This empty state does not indicate a normal chest X-ray.</Notice>
      <Action label={picking ? "Opening photo library…" : "Choose teaching image"} icon="photo.badge.plus" disabled={picking} onPress={pickImage} />
      {pickerError && <Notice warning>{pickerError}</Notice>}
    </Card>
    <Action label="Restore bundled reference" secondary onPress={() => updateEncounter(current => ({ ...current, hideTeachingImage: false }))} /><Body muted>Choose a deidentified teaching image you have permission to use. It stays on this device and is not analysed.</Body>
  </Screen>;
  return <ScrollView style={{ flex: 1, backgroundColor: "#171A1F" }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 10 }}><Text selectable style={{ color: "#E5EBF3", fontSize: 15 }}>{attachment ? `${patient.name} · local teaching image` : "Reference example · unrelated to this patient"}</Text><Text selectable style={{ color: "#BEC8D6", fontSize: 13 }}>No model analysis has been run.</Text><OriginalImageViewer key={image.id} asset={image} />
    <Action label={analysing ? "Analysing · simulation…" : "Analyse X-ray · simulation"} icon="sparkles" disabled={analysing || picking} onPress={analyse} />
    <Action label={`Demo response: ${scenario === "no-finding" ? "no finding result" : scenario}`} secondary disabled={analysing} onPress={() => setShowScenarios(value => !value)} />
    <Host colorScheme="light" style={{ position: "absolute" }}><BottomSheet isPresented={showScenarios} onDismiss={() => setShowScenarios(false)} snapPoints={["half", "full"]}><Column spacing={16}><NativeText>Choose a UI sample response. This does not classify the image.</NativeText>{(["reference", "unsupported", "no-finding"] as const).map(value => <NativeButton key={value} label={value === "no-finding" ? "No finding result" : value === "reference" ? "Reference" : "Unsupported category"} onPress={() => { if (analysing) return; updateEncounter(current => ({ ...current, imagingScenario: value }), true); setShowScenarios(false); }} />)}</Column></BottomSheet></Host>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Action label="Remove image" secondary disabled={analysing} onPress={() => updateEncounter(current => ({ ...current, imagingAttachment: undefined, hideTeachingImage: true }), true)} /><Action label={picking ? "Opening library…" : "Choose local image"} secondary disabled={picking || analysing} onPress={pickImage} /></View>{pickerError && <Notice warning>{pickerError}</Notice>}</ScrollView>;
}
