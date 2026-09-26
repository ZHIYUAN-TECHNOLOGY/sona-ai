import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText } from "@/features/errors";
import { markRead, useThread } from "@/features/messages/row";
import { palette, type } from "@/lib/theme";
import { Button, Card, field, surfaceStyle, Title } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";

/**
 * The thread with the care team: the patient on the right, the care team on the left, the composer
 * at the bottom with the emergency line always in view. Re-read every 15 s while open.
 */
const REFETCH_MS = 15_000;
const newRequestId = () => `care-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const time = (at: Date) => new Date(at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });

export default function Messages() {
  const { data } = useThread(REFETCH_MS);
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const [text, setText] = useState("");
  // One ID per draft, so a retry after a dropped connection is not sent twice.
  const [requestId, setRequestId] = useState(newRequestId);
  const send = useMutation({
    mutationFn: () => client.care.messages.send({ text: text.trim(), requestId }),
    onSuccess: () => { setText(""); setRequestId(newRequestId()); void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() }); },
  });
  const lastId = data?.at(-1)?.id;
  useEffect(() => { if (lastId) markRead(lastId); }, [lastId]);

  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title line="Questions about your recovery, medicines or follow-ups.">Your care team</Title>
      {!data ? <ActivityIndicator color={palette.muted} />
        : !data.length ? <Card><Text style={{ ...type.body, color: palette.muted }}>Ask anything about your recovery. Your care team will reply here.</Text></Card>
          : data.map(m => {
            const mine = m.from === "patient";
            return <View key={m.id} accessible accessibilityLabel={`${mine ? "You" : "Care team"}, ${time(m.createdAt)}: ${m.text}`} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", gap: 4, alignItems: mine ? "flex-end" : "flex-start" }}>
              <View style={[mine ? { backgroundColor: palette.dark, borderRadius: 20, borderCurve: "continuous" } : { ...surfaceStyle, borderRadius: 20 }, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                <Text selectable style={{ ...type.body, color: mine ? palette.white : palette.ink }}>{m.text}</Text>
              </View>
              <Text style={{ ...type.footnote, color: palette.muted }}>{mine ? "You" : "Care team"} · {time(m.createdAt)}</Text>
            </View>;
          })}
    </ScrollView>
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), gap: 8 }}>
      {send.error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(send.error)}</Text>}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
        <TextInput value={text} onChangeText={setText} placeholder="Write to your care team" placeholderTextColor={palette.muted} multiline maxLength={1000}
          accessibilityLabel="Message to your care team" style={{ ...field, flex: 1, maxHeight: 140, paddingTop: 13, paddingBottom: 13, backgroundColor: "rgba(255,255,255,0.8)" }} />
        <Button label="Send" busy={send.isPending} disabled={!text.trim()} onPress={() => send.mutate()} />
      </View>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.amber, textAlign: "center" }}>Not for emergencies · call 999</Text>
    </View>
  </KeyboardAvoidingView>;
}
