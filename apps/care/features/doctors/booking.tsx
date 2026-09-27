import { useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { errorText } from "@/features/errors";
import { Text, TextInput } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { Button, field, surfaceStyle } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import { DoctorAvatar } from "./avatar";
import { bookingText, dayParts, type Doctor, type Slot } from "./data";

const newRequestId = () => `care-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Review before sending (in-screen, over Doctor details): the doctor, the day and time, an optional
 * reason, and what will happen. "Send request" messages the care team (it is a request, not a
 * booking); then a check springs in with "Request sent" and the way back to the doctors. A failed send
 * stays on the card with the error and can be sent again under the same request ID (no double send).
 */
export function BookingSheet({ doctor, slot, onClose }: { doctor: Doctor; slot: Slot; onClose: () => void }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  // One ID per message text, so a retry after a dropped connection is not sent twice (as in the thread).
  const [attempt, setAttempt] = useState({ text: "", requestId: newRequestId() });
  const send = useMutation({
    mutationFn: (m: { text: string; requestId: string }) => client.care.messages.send(m),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() });
      if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Request sent. The clinic will confirm by message.");
    },
  });
  const go = () => {
    const text = bookingText(doctor, slot.date, reason);
    const requestId = text === attempt.text ? attempt.requestId : newRequestId();
    setAttempt({ text, requestId });
    send.mutate({ text, requestId });
  };
  const day = dayParts(slot.date);
  const done = send.isSuccess;

  return <KeyboardAvoidingView behavior="padding" style={{ position: "absolute", inset: 0, justifyContent: "flex-end" }}>
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(14,18,27,0.28)" }}>
      <Pressable accessibilityLabel="Close" style={{ flex: 1 }} disabled={send.isPending} onPress={onClose} />
    </Animated.View>
    <Animated.View accessibilityViewIsModal entering={still ? FadeIn.duration(180) : SlideInDown.springify().duration(380).dampingRatio(1)} exiting={still ? FadeOut.duration(160) : SlideOutDown.duration(220)}
      style={[surfaceStyle, { margin: 12, marginBottom: Math.max(insets.bottom, 12), borderRadius: 30, padding: 20, gap: 14 }]}>
      {done ? <>
        <Animated.View entering={still ? FadeIn.duration(200) : pop} style={{ alignSelf: "center", width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: palette.success }}>
          <Svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={palette.white} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><Path d="M20 6L9 17l-5-5" /></Svg>
        </Animated.View>
        <View accessible accessibilityRole="header" style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: "500", letterSpacing: -0.5, color: palette.ink }}>Request sent</Text>
          <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>The clinic will confirm by message. It isn't booked until they do.</Text>
        </View>
        <Button label="Back to doctors" onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/doctors"); }} />
      </> : <>
        <Text accessibilityRole="header" style={{ fontSize: 22, lineHeight: 28, fontWeight: "500", letterSpacing: -0.5, color: palette.ink }}>Request this visit</Text>
        <View accessible accessibilityLabel={`${doctor.name}, ${doctor.specialty}. ${day.spoken} at ${slot.label}. ${doctor.room}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 20, borderCurve: "continuous", backgroundColor: palette.mutedWash }}>
          <DoctorAvatar doctor={doctor} size={48} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ ...type.headline, color: palette.ink }}>{doctor.name}</Text>
            <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{day.weekday} {day.date} · {slot.label}</Text>
            <Text style={{ ...type.footnote, color: palette.muted }}>{doctor.room}</Text>
          </View>
        </View>
        <TextInput value={reason} onChangeText={setReason} placeholder="Reason (optional), e.g. still coughing" placeholderTextColor={palette.muted} maxLength={200}
          editable={!send.isPending} returnKeyType="done" accessibilityLabel="Reason for the visit, optional" style={{ ...field, backgroundColor: palette.white, borderColor: palette.line }} />
        <Text style={{ ...type.footnote, color: palette.muted }}>This sends a request to your care team. The clinic confirms the time by message.</Text>
        {send.error && <Text selectable accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.red }}>{errorText(send.error)} Your request wasn't sent.</Text>}
        <Button label={send.error ? "Try again" : "Send request"} busy={send.isPending} onPress={go} />
        <Button quiet label="Cancel" disabled={send.isPending} onPress={onClose} />
      </>}
    </Animated.View>
  </KeyboardAvoidingView>;
}

/** The check lands on the confirm spring (380 ms, damping 0.72) from 0.6. */
const pop = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] },
    animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};
