import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import type { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon } from "@/components/sona/ui";
import type { Patient } from "@/features/encounter/types";
import { api, errorText, requestId, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { refreshServerData } from "@/features/live/server-day";

/**
 * Sona Care messages on the patient sheet, under the check-ins: the patient's thread with the care
 * team and a one-line reply (which closes their message tasks on My Day). Live mode only; hidden
 * until the patient has written.
 */
type Message = Awaited<ReturnType<AppRouterClient["messages"]["list"]>>[number];

export function CareMessages({ patient, entering }: { patient: Patient; entering?: ReturnType<typeof riseIn> }) {
  const { on } = useLive();
  const [thread, setThread] = useState<Message[]>();
  const [text, setText] = useState("");
  // One ID per draft, so a retried send is stored once.
  const [draftId, setDraftId] = useState(requestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const load = () => api.messages.list({ patientId: patient.id }).then(setThread, e => setError(errorText(e)));
  useEffect(() => { if (on) void load(); }, [on, patient.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveChanges(["messages"], () => { if (on) void load(); });
  if (!on || !thread?.length) return null;

  const first = patient.name.split(" ")[0];
  const reply = async () => {
    setBusy(true); setError(undefined);
    try {
      await api.messages.reply({ patientId: patient.id, text: text.trim(), requestId: draftId });
      setText(""); setDraftId(requestId());
      await Promise.all([load(), refreshServerData()]);
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };

  return <Animated.View entering={entering} style={{ gap: 8 }}>
    <Text style={{ ...type.overline, color: palette.muted }}>Sona Care messages</Text>
    <View style={{ borderRadius: 22, borderCurve: "continuous", backgroundColor: palette.white, padding: 14, gap: 10 }}>
      {thread.map(m => {
        const team = m.from === "care-team";
        return <View key={m.id} style={{ alignSelf: team ? "flex-end" : "flex-start", maxWidth: "85%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderCurve: "continuous", backgroundColor: team ? "rgba(20,28,40,0.05)" : "rgba(36,91,204,0.07)" }}>
          <Text selectable style={{ ...type.subhead, color: palette.ink }}>{m.text}</Text>
        </View>;
      })}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput value={text} onChangeText={setText} placeholder={`Reply to ${first}`} placeholderTextColor="#A2A8B1" maxLength={1000} editable={!busy} returnKeyType="send"
          onSubmitEditing={() => { if (text.trim()) void reply(); }} accessibilityLabel={`Reply to ${first} in Sona Care`}
          style={{ flex: 1, fontSize: 16, color: palette.ink, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, borderRadius: 14, backgroundColor: "rgba(20,28,40,0.04)" }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send reply" accessibilityState={{ disabled: busy || !text.trim(), busy }} disabled={busy || !text.trim()} onPress={() => { void reply(); }}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.ink, opacity: busy || !text.trim() ? 0.4 : pressed ? 0.8 : 1 })}>
          <Icon name="arrow.up" size={15} color={palette.white} />
        </Pressable>
      </View>
    </View>
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
  </Animated.View>;
}
