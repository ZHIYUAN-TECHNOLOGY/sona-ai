import { SAMPLE_PHOTO_KEY } from "@sona-ai/api/contracts";
import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, TextInput, View, type TextStyle } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { FadeIn } from "react-native-reanimated";
import { SampleLabel } from "@/components/sona/model-answer";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { ErrorLine, TextLink } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Icon, IconButton, pillStyle, Surface, surfaceStyle, useAccessibleEffects } from "@/components/sona/ui";
import { DoneLine } from "@/features/bookings/parts";
import { OriginalImageViewer } from "@/features/imaging/viewer";
import { api, errorText } from "@/features/live";
import { useRole } from "@/features/live/roles";

/**
 * A medicine photo from Sona Care in the care team's thread: the photo in a rounded glass frame (tap for
 * the full-screen zoom the imaging viewer uses), and under it what Sona read with the decision in place:
 * Edit, "Add to medicines" (joins reconciliation unconfirmed) or "Not this one" (Amelia is told calmly).
 * Once decided, the card folds into a done line. Doctors and nurses only; others see the reading and outcome.
 */
type MessageAttachment = NonNullable<Awaited<ReturnType<AppRouterClient["messages"]["thread"]>>["messages"][number]["attachment"]>;
type Reading = MessageAttachment["reading"];
const SAMPLE = require("../../assets/scan/sample-medicine.jpg") as number;
const line = (r: Reading) => [[r.name, r.dose].filter(Boolean).join(" "), r.frequency].filter(Boolean).join(", ");

export function PhotoMessage({ messageId, attachment, first }: { messageId: string; attachment: MessageAttachment; first: string }) {
  const role = useRole();
  const canSee = role.can("messages.photo"), canDecide = role.can("messages.resolveMedicinePhoto");
  const { reducedMotion } = useAccessibleEffects();
  // Someone else deciding arrives through the thread's live re-read, and the card folds the same way.
  const [decided, setDecided] = useState<MessageAttachment["decision"]>();
  const decision = attachment.decision ?? decided;

  // The photo: bundled sample, fetched on demand (base64, never a public link), or it stayed on the phone.
  const stored = Boolean(attachment.key && attachment.key !== SAMPLE_PHOTO_KEY);
  const [uri, setUri] = useState<string>();
  const [photoError, setPhotoError] = useState<string>();
  const load = () => api.messages.photo({ messageId }).then(p => { setUri(`data:${p.contentType};base64,${p.dataBase64}`); setPhotoError(undefined); }, e => setPhotoError(errorText(e)));
  useEffect(() => { if (stored && canSee) void load(); }, [stored, canSee, messageId]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = attachment.key === SAMPLE_PHOTO_KEY ? SAMPLE : uri ? { uri } : undefined;
  const [open, setOpen] = useState(false);

  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState<Reading>(attachment.reading);
  const [busy, setBusy] = useState<"add" | "reject">();
  const [error, setError] = useState<string>();
  const decide = async (choice: "add" | "reject") => {
    if (busy || !reading.name.trim()) return;
    setBusy(choice); setError(undefined);
    const edited = editing ? { name: reading.name.trim(), dose: reading.dose?.trim() || undefined, frequency: reading.frequency?.trim() || undefined } : undefined;
    try {
      const d = await api.messages.resolveMedicinePhoto({ messageId, decision: choice, edited });
      setDecided(d);
      AccessibilityInfo.announceForAccessibility(doneText(d.status, first));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(undefined); }
  };

  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 8, width: 248 }}>
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Photo from ${first}: ${line(attachment.reading)}`} accessibilityHint={source ? "Opens the photo full screen to zoom" : undefined}
      disabled={!source} onPress={() => setOpen(true)} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View style={{ ...pillStyle, borderRadius: 26, borderCurve: "continuous", padding: 5 }}>
        <View style={{ height: 180, borderRadius: 21, borderCurve: "continuous", overflow: "hidden", backgroundColor: "rgba(20,28,40,0.05)", alignItems: "center", justifyContent: "center" }}>
          {source ? <Image source={source} contentFit="cover" transition={reducedMotion ? 0 : 200} style={{ position: "absolute", inset: 0 }} accessibilityIgnoresInvertColors />
            : <View style={{ alignItems: "center", gap: 6, padding: 16 }}>
              <Icon name="camera" size={22} color={palette.muted} />
              <Text style={{ ...type.caption, color: palette.muted, textAlign: "center" }}>
                {!stored ? `The photo stayed on ${first}'s phone` : !canSee ? "Photo for doctors and nurses" : photoError ? "Photo didn't load" : "Loading photo…"}
              </Text>
            </View>}
        </View>
      </View>
    </Pressable>
    {photoError && <ErrorLine text={`Photo didn't load: ${photoError}`} onRetry={() => { void load(); }} />}

    {decision ? <DoneLine text={doneText(decision.status, first)} />
      : <Animated.View entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 6, duration: 300 })}>
        <Surface style={{ padding: 14, gap: 8, borderRadius: 20 }}>
          <Text style={{ ...type.footnote, color: palette.muted }}>
            Sona read: <Text style={{ fontWeight: "600", color: palette.ink }}>{line(reading)}</Text>
          </Text>
          <SampleLabel source={attachment.sampleReading ? "fixture" : undefined} what="photo reading" />
          {canDecide ? <>
            {editing ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(160)} style={{ gap: 6 }}>
              {([["name", "Medicine"], ["dose", "Dose"], ["frequency", "How often"]] as const).map(([k, label]) =>
                <TextInput key={k} value={reading[k] ?? ""} onChangeText={v => setReading(r => ({ ...r, [k]: v }))} placeholder={label} placeholderTextColor="#A2A8B1" accessibilityLabel={label} editable={!busy}
                  style={{ ...surfaceStyle, borderRadius: 14, minHeight: 44, paddingHorizontal: 12, fontSize: 15, color: palette.ink } as TextStyle} />)}
            </Animated.View> : <TextLink label="Edit" onPress={() => setEditing(true)} />}
            {error && <ErrorLine text={`Not saved: ${error}`} />}
            <Action label={busy === "add" ? "Adding…" : "Add to medicines"} disabled={Boolean(busy) || !reading.name.trim()}
              accessibilityLabel={`Add ${line(reading)} to ${first}'s medicines, to confirm in reconciliation`} onPress={() => { void decide("add"); }} />
            <Action secondary label={busy === "reject" ? "Telling " + first + "…" : "Not this one"} disabled={Boolean(busy)}
              accessibilityLabel={`Not this one. Tells ${first} not to take it without asking`} onPress={() => { void decide("reject"); }} />
          </> : <Text style={{ ...type.caption, color: palette.muted }}>{role.why("messages.resolveMedicinePhoto") ?? "A doctor or a nurse decides."}</Text>}
        </Surface>
      </Animated.View>}

    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.canvas }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, paddingLeft: 20 }}>
          <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Photo from {first}</Text>
          <IconButton name="xmark" label="Close photo" onPress={() => setOpen(false)} />
        </View>
        {source && <View style={{ paddingHorizontal: 20 }}>
          <OriginalImageViewer asset={{ id: messageId, source, title: `medicine photo from ${first}`, attribution: attachment.key === SAMPLE_PHOTO_KEY ? "Sample photo" : `Sent by ${first} from Sona Care`, license: "pinch or double-tap to zoom", sourceUrl: "" }} />
        </View>}
      </GestureHandlerRootView>
    </Modal>
  </Animated.View>;
}

const doneText = (status: "added" | "declined", first: string) => status === "added" ? `Added to ${first}'s medicines · to confirm` : `Declined · ${first} was told`;
