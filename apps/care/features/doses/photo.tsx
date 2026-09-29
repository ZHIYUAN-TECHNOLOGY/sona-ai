import { SAMPLE_PHOTO_KEY } from "@sona-ai/api/contracts";
import { useQuery } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, TextInput, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeInDown, SlideInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { motion, palette, type } from "@/lib/theme";
import { Button, field, ICON, pillStyle, SampleLabel, surfaceStyle } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import { Pill } from "./pill";
import { addWaiting, medLine, messageFor, statusOf, unplanned, type PhotoMedicine, type PhotoReading } from "./photo-model";
import { useMe } from "../me";
import "./strings";

/**
 * "Add from a photo" on the Medicine tab: a photo of a medicine box or letter is read (care.readMedicinePhoto,
 * a labelled sample until the vision model is on), the patient checks and can edit it, and it goes to
 * their care team as a message with the photo and reading attached. It then sits in their medicines as
 * "Waiting for your care team", never confirmed and with no dose timer, kept on this phone. When the care
 * team decides (live, through the thread), it reads "Added by your care team", or leaves with their reply.
 */
// The picker is a native module: a build without it still opens the sheet and offers the sample photo.
let picker: typeof import("expo-image-picker") | undefined;
try { picker = require("expo-image-picker"); } catch { picker = undefined; }
const SAMPLE = require("../../assets/scan/sample-medicine.jpg") as number;
const CAMERA = "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3zM12 17a4 4 0 1 0 0-8a4 4 0 0 0 0 8";

// Waiting medicines, kept on the phone (read through useSyncExternalStore, like the dose log).
const KEY = "sona-care.photo-medicines";
let waiting: PhotoMedicine[] = [];
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
SecureStore.getItemAsync(KEY).then(v => { if (v) { waiting = addAll(JSON.parse(v) as PhotoMedicine[]); listeners.forEach(l => l()); } }).catch(() => {});
function addAll(list: PhotoMedicine[]) { return list.reduce(addWaiting, waiting); }
function keep(m: PhotoMedicine) {
  waiting = addWaiting(waiting, m);
  listeners.forEach(l => l());
  SecureStore.setItemAsync(KEY, JSON.stringify(waiting)).catch(() => {});
}
const newRequestId = () => `care-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Photo = { source: number | { uri: string }; base64?: string | null; mimeType?: string | null };
type Step = { kind: "choose"; error?: string } | { kind: "reading"; photo: Photo } | { kind: "read"; photo: Photo; reading: PhotoReading; key?: string; sample: boolean } | { kind: "sent"; med: string };

/** The entry (under the medicine list) and the waiting medicines above it, leaving out any the plan (`planned`) already lists. */
export function PhotoMedicines({ planned }: { planned: string[] }) {
  const t = tFor(useLang());
  const { state } = useMe();
  const thread = useQuery({ ...orpc.care.messages.list.queryOptions(), enabled: state === "joined" }).data;
  const list = unplanned(useSyncExternalStore(subscribe, () => waiting), planned).map(m => ({ ...m, status: statusOf(m, thread) })).filter(m => m.status !== "declined");
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 12 }}>
    {list.map(m => <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${medLine(m)}. ${t(m.status === "added" ? "photo.added" : "photo.waiting")}`} accessibilityHint={t("photo.openMessages")} onPress={() => router.push("/messages")}
      style={({ pressed }) => [surfaceStyle, { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, transform: [{ scale: pressed ? motion.press : 1 }] }]}>
      <Pill name={m.name} size={52} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ ...type.headline, color: palette.ink }}>{m.name}</Text>
        {(m.dose || m.how) && <Text style={{ ...type.footnote, color: palette.faint }}>{[m.dose, m.how].filter(Boolean).join(", ")}</Text>}
        {/* Amber while the care team checks it, green once they added it. */}
        <Animated.View key={m.status} entering={FadeIn.duration(220)} style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: m.status === "added" ? palette.greenWash : palette.amberWash }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: m.status === "added" ? palette.success : palette.warning }} />
          <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "600", color: m.status === "added" ? palette.green : palette.amber }}>{t(m.status === "added" ? "photo.added" : "photo.waiting")}</Text>
        </Animated.View>
      </View>
    </Pressable>)}
    <Pressable accessibilityRole="button" accessibilityLabel={t("photo.add")} accessibilityHint={t("photo.addLine")} onPress={() => setOpen(true)}
      style={({ pressed }) => [surfaceStyle, { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 64, transform: [{ scale: pressed ? motion.press : 1 }] }]}>
      <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.blueWash }}>
        <Svg width={22} height={22} viewBox="0 0 24 24"><Path d={CAMERA} fill="none" stroke={palette.blue} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ ...type.headline, color: palette.ink }}>{t("photo.add")}</Text>
        <Text style={{ ...type.footnote, color: palette.faint }}>{t("photo.addLine")}</Text>
      </View>
      <Svg width={18} height={18} viewBox="0 0 24 24"><Path d={ICON.plus} fill="none" stroke={palette.muted} strokeWidth={2} strokeLinecap="round" /></Svg>
    </Pressable>
    {open && <PhotoSheet onClose={() => setOpen(false)} />}
  </View>;
}

/** The sheet (white, 40 pt corners, rows springing up 40 ms apart, like "Remind me later"): choose → reading → check and send → sent. */
function PhotoSheet({ onClose }: { onClose: () => void }) {
  const lang = useLang(), t = tFor(lang);
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [requestId] = useState(newRequestId);
  const row = (i: number) => reduced ? undefined : FadeInDown.springify().duration(motion.spring.duration).dampingRatio(1).delay(60 + i * motion.stagger);

  const read = async (photo: Photo, sample: boolean) => {
    setStep({ kind: "reading", photo });
    try {
      const [r] = await Promise.all([
        client.care.readMedicinePhoto(sample || !photo.base64 ? {} : { photo: { contentType: photo.mimeType ?? "image/jpeg", dataBase64: photo.base64 } }),
        new Promise(done => setTimeout(done, reduced ? 300 : 1200)), // long enough to see it read, never a wait for nothing
      ]);
      setStep({ kind: "read", photo, sample: r.source === "fixture", key: r.key, reading: { name: r.name, dose: r.dose, how: r.frequency } });
    } catch { setStep({ kind: "choose", error: t("photo.failed") }); }
  };
  const pick = async (from: "camera" | "library") => {
    if (!picker) { setStep({ kind: "choose", error: t("photo.noCamera") }); return; }
    try {
      if (from === "camera" && !(await picker.requestCameraPermissionsAsync()).granted) { setStep({ kind: "choose", error: t("photo.noCamera") }); return; }
      const options = { mediaTypes: ["images"] as ("images")[], base64: true, quality: 0.6 };
      const result = from === "camera" ? await picker.launchCameraAsync(options) : await picker.launchImageLibraryAsync(options);
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset) void read({ source: { uri: asset.uri }, base64: asset.base64, mimeType: asset.mimeType }, false);
    } catch { setStep({ kind: "choose", error: t("photo.noCamera") }); }
  };
  const send = async () => {
    if (step.kind !== "read" || sending || !step.reading.name.trim()) return;
    const reading = { name: step.reading.name.trim(), dose: step.reading.dose?.trim() || undefined, how: step.reading.how?.trim() || undefined };
    setSending(true); setError(undefined);
    try {
      // The sample photo is bundled in both apps, so it travels as the sample key; a photo that couldn't be stored has none.
      const key = step.key ?? (step.photo.source === SAMPLE ? SAMPLE_PHOTO_KEY : undefined);
      await client.care.messages.send({ text: messageFor(reading, t), requestId,
        attachment: { kind: "medicine-photo", key, reading: { name: reading.name, dose: reading.dose, frequency: reading.how }, sampleReading: step.sample } });
      void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() });
      keep({ id: requestId, ...reading, key: step.key, sentAt: new Date().toISOString() });
      AccessibilityInfo.announceForAccessibility(t("photo.sent"));
      setStep({ kind: "sent", med: medLine(reading) });
    } catch { setError(t("photo.sendFailed")); }
    finally { setSending(false); }
  };
  const edit = (patch: Partial<PhotoReading>) => setStep(s => s.kind === "read" ? { ...s, reading: { ...s.reading, ...patch } } : s);

  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(31,31,31,0.28)" }} />
    <Animated.View accessibilityViewIsModal entering={reduced ? undefined : SlideInDown.springify().duration(420).dampingRatio(0.86)}
      style={{ position: "absolute", left: 10, right: 10, bottom: Math.max(insets.bottom, 10), borderRadius: 40, borderCurve: "continuous", backgroundColor: palette.white, padding: 24, paddingTop: 28, gap: 14 } as ViewStyle}>
      {step.kind === "choose" && <>
        <Animated.View entering={row(0)} accessible accessibilityRole="header"><Text style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{t("photo.title")}</Text></Animated.View>
        <Animated.View entering={row(1)}><Text style={{ ...type.body, color: palette.muted }}>{t("photo.intro")}</Text></Animated.View>
        {step.error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber }}>{step.error}</Text>}
        <Animated.View entering={row(2)}><Button label={t("photo.camera")} onPress={() => void pick("camera")} /></Animated.View>
        <Animated.View entering={row(3)}><Button quiet label={t("photo.library")} onPress={() => void pick("library")} /></Animated.View>
        <Animated.View entering={row(4)}><Button quiet label={t("photo.sample")} onPress={() => void read({ source: SAMPLE }, true)} /></Animated.View>
      </>}

      {step.kind === "reading" && <View accessible accessibilityLabel={t("photo.reading")} accessibilityLiveRegion="polite" style={{ alignItems: "center", gap: 14, paddingVertical: 8 }}>
        <Image source={step.photo.source} contentFit="cover" style={{ width: 132, height: 132, borderRadius: 24 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <ActivityIndicator color={palette.blue} />
          <Text style={{ ...type.headline, color: palette.ink }}>{t("photo.reading")}</Text>
        </View>
      </View>}

      {step.kind === "read" && <>
        <Animated.View entering={row(0)} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Image source={step.photo.source} contentFit="cover" style={{ width: 64, height: 64, borderRadius: 16 }} accessibilityIgnoresInvertColors />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.footnote, fontWeight: "600", color: palette.faint }}>{t("photo.weRead")}</Text>
            <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{medLine(step.reading)}</Text>
          </View>
          <Pill name={step.reading.name} size={48} />
        </Animated.View>
        <SampleLabel source={step.sample ? "fixture" : undefined} what="photo" />
        {editing ? <Animated.View entering={reduced ? undefined : FadeIn.duration(160)} style={{ gap: 10 }}>
          {([["name", "photo.name"], ["dose", "photo.dose"], ["how", "photo.how"]] as const).map(([k, label]) => <View key={k} style={{ gap: 4 }}>
            <Text style={{ ...type.footnote, color: palette.muted }}>{t(label)}</Text>
            <TextInput accessibilityLabel={t(label)} value={step.reading[k] ?? ""} onChangeText={v => edit({ [k]: v })} style={field} autoCapitalize={k === "name" ? "words" : "none"} />
          </View>)}
        </Animated.View>
          : <Pressable accessibilityRole="button" onPress={() => setEditing(true)} style={({ pressed }) => [pillStyle, { alignSelf: "flex-start", minHeight: 44, paddingHorizontal: 16, justifyContent: "center", opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>{t("photo.edit")}</Text>
          </Pressable>}
        <Text style={{ ...type.footnote, color: palette.muted }}>{t("photo.notYet")}</Text>
        {error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber }}>{error}</Text>}
        <Button label={t("photo.send")} busy={sending} disabled={!step.reading.name.trim()} onPress={() => void send()} />
      </>}

      {step.kind === "sent" && <>
        <Animated.View entering={row(0)} accessible accessibilityRole="header" style={{ alignItems: "center", gap: 10 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: palette.success, alignItems: "center", justifyContent: "center" }}>
            <Svg width={28} height={28} viewBox="0 0 24 24"><Path d="M20 6 9 17l-5-5" fill="none" stroke={palette.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></Svg>
          </View>
          <Text style={{ ...type.title, fontWeight: "600", color: palette.ink, textAlign: "center" }}>{t("photo.sent")}</Text>
        </Animated.View>
        <Animated.View entering={row(1)}><Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{t("photo.sentLine", { med: step.med })}</Text></Animated.View>
        <Animated.View entering={row(2)}><Button label={t("common.done")} onPress={onClose} /></Animated.View>
      </>}
    </Animated.View>
  </Modal>;
}
