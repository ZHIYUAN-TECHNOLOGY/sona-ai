import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import type { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { ErrorLine, TextLink } from "@/components/sona/parts";
import { router } from "expo-router";
import { ThreadBubble } from "@/features/inbox/thread";
import { Icon } from "@/components/sona/ui";
import type { Patient } from "@/features/encounter/types";
import { api, errorText, requestId, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { useRole } from "@/features/live/roles";
import { refreshServerData } from "@/features/live/server-day";

/**
 * Sona Care messages on the patient sheet, under the check-ins: the patient's thread with the care
 * team and a one-line reply (which closes their message tasks on My Day). Live mode only, for roles
 * that may read them; a quiet line while loading, when empty, or when the read failed (with Retry).
 * Bubbles match the inbox thread (who wrote it and when); "Open thread" goes there for the rest.
 * Only a doctor or a nurse replies (messages.reply); management reads.
 */
type Message = Awaited<ReturnType<AppRouterClient["messages"]["list"]>>[number];
const SHOWN = 4;

export function CareMessages({ patient, entering }: { patient: Patient; entering?: ReturnType<typeof riseIn> }) {
  const role = useRole();
  const { on: live } = useLive();
  const on = live && role.can("messages.list");
  const canReply = role.can("messages.reply");
  const [thread, setThread] = useState<Message[]>();
  const [text, setText] = useState("");
  // One ID per draft, so a retried send is stored once.
  const [draftId, setDraftId] = useState(requestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const load = () => api.messages.list({ patientId: patient.id }).then(t => { setThread(t); setLoadError(undefined); }, e => setLoadError(errorText(e)));
  useEffect(() => { if (on) void load(); }, [on, patient.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveChanges(["messages"], () => { if (on) void load(); });
  if (!on) return null;

  const first = patient.name.split(" ")[0];
  const quiet = (text: string) => <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.muted }}>{text}</Text>;
  const reply = async () => {
    setBusy(true); setError(undefined);
    try {
      await api.messages.reply({ patientId: patient.id, text: text.trim(), requestId: draftId });
    } catch (e) { setError(errorText(e)); setBusy(false); return; }
    // Sent: the draft clears; a failed re-read afterwards is the thread's own error, not the send's.
    setText(""); setDraftId(requestId()); setBusy(false);
    await Promise.all([load(), refreshServerData().catch(() => {})]);
  };

  return <Animated.View entering={entering} style={{ gap: 8 }}>
    <Text style={{ ...type.overline, color: palette.muted }}>Sona Care messages</Text>
    {!thread ? (loadError ? <ErrorLine text={`Messages didn't load: ${loadError}`} onRetry={() => { void load(); }} /> : quiet("Loading messages…"))
      : !thread.length ? quiet(`No messages from ${first} yet.`)
      : <View style={{ borderRadius: 22, borderCurve: "continuous", backgroundColor: "rgba(255,255,255,0.55)", padding: 14, gap: 10 }}>
      {/* The latest few; the whole thread and Sona's drafted reply are one tap away. */}
      {thread.slice(-SHOWN).map(m => <ThreadBubble key={m.id} message={m} reduced />)}
      <TextLink label={thread.length > SHOWN ? `Open thread · ${thread.length} messages` : "Open thread"} onPress={() => router.push(`/inbox/${patient.id}`)} />
      {canReply && <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput value={text} onChangeText={setText} placeholder={`Reply to ${first}`} placeholderTextColor={palette.placeholder} maxLength={1000} editable={!busy} returnKeyType="send"
          onSubmitEditing={() => { if (text.trim()) void reply(); }} accessibilityLabel={`Reply to ${first} in Sona Care`}
          style={{ flex: 1, fontSize: 16, color: palette.ink, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, borderRadius: 14, backgroundColor: "rgba(20,28,40,0.04)" }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send reply" accessibilityState={{ disabled: busy || !text.trim(), busy }} disabled={busy || !text.trim()} onPress={() => { void reply(); }}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.ink, opacity: busy || !text.trim() ? 0.4 : pressed ? 0.8 : 1 })}>
          <Icon name="arrow.up" size={15} color={palette.white} />
        </Pressable>
      </View>}
    </View>}
    {error && <ErrorLine text={`Not sent: ${error}`} onRetry={() => { void reply(); }} />}
  </Animated.View>;
}
