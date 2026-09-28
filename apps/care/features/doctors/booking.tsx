import { useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, SlideInDown, SlideOutDown, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { errorText } from "@/features/errors";
import { Text, TextInput } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText, Button, field } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import { DoctorAvatar } from "./avatar";
import { dayParts, type Doctor, type Slot } from "./data";

/**
 * Review before sending (the kit's white sheet: 40 pt corners, a grabber, a centred light-then-gradient
 * title; springs up after Canopi), over Doctor details: the doctor, the day and time, an optional
 * reason, and what will happen. "Send request" sends a real booking request (care.bookings.request):
 * it holds the slot and is a task for the care team, who confirm or offer another time; the Schedule
 * shows it as requested until then. A failed send stays on the card with the error and can be sent
 * again (the server keeps one request per doctor and slot, so a retry never sends two).
 *
 * Sent, after 60fps "Fold Successful Payment Check Animation"
 * (https://60fps.design/shots/fold-successful-payment-check-animation), kept calm (no particles): the
 * green badge pops on a subtle spring, the check draws inside it, then the title, the line and the
 * booked card rise in 60 ms apart. Reduce Motion: everything appears still.
 */
export function BookingSheet({ doctor, slot, onClose }: { doctor: Doctor; slot: Slot; onClose: () => void }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  const send = useMutation({
    mutationFn: () => client.care.bookings.request({ doctorId: doctor.id, startsAt: slot.date, reason: reason.trim() || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.care.bookings.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.care.doctors.key() });
      if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Request sent. Your care team will confirm the time.");
    },
  });
  const go = () => send.mutate();
  const day = dayParts(slot.date);
  const done = send.isSuccess;

  return <KeyboardAvoidingView behavior="padding" style={{ position: "absolute", inset: 0, justifyContent: "flex-end" }}>
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(14,18,27,0.28)" }}>
      <Pressable accessibilityLabel="Close" style={{ flex: 1 }} disabled={send.isPending} onPress={onClose} />
    </Animated.View>
    <Animated.View accessibilityViewIsModal entering={still ? FadeIn.duration(180) : SlideInDown.springify().duration(380).dampingRatio(1)} exiting={still ? FadeOut.duration(160) : SlideOutDown.duration(220)}
      style={{ margin: 8, marginBottom: Math.max(insets.bottom, 8), borderRadius: 40, borderCurve: "continuous", backgroundColor: palette.white, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, gap: 14 }}>
      <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "#E5E5E5" }} />
      {done ? <>
        <Animated.View entering={still ? FadeIn.duration(200) : pop} style={{ alignSelf: "center", width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: palette.success }}>
          <DrawnCheck still={still} />
        </Animated.View>
        <Animated.View entering={still ? undefined : after(0)} accessible accessibilityRole="header" style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: "600", letterSpacing: -1, color: palette.ink }}>Request sent</Text>
          <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>Your care team will confirm the time. Until then it shows on your Schedule as requested.</Text>
        </Animated.View>
        <Animated.View entering={still ? undefined : after(1)} accessible accessibilityLabel={`Requested: ${doctor.name}, ${day.spoken} at ${slot.label}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 24, borderCurve: "continuous", backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line }}>
          <DoctorAvatar doctor={doctor} size={40} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ ...type.headline, color: palette.ink }}>{doctor.name}</Text>
            <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{day.weekday} {day.date} · {slot.label} · requested</Text>
          </View>
        </Animated.View>
        <Animated.View entering={still ? undefined : after(2)} style={{ gap: 8 }}>
          <Button label="See my schedule" onPress={() => router.replace("/follow-ups")} />
          <Button quiet label="Back to doctors" onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/doctors"); }} />
        </Animated.View>
      </> : <>
        <View accessible accessibilityRole="header" accessibilityLabel="Request this visit" style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 20, lineHeight: 26, letterSpacing: -0.6, color: palette.faint }}>Request</Text>
          <AccentText style={{ fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -1.9, color: palette.ink, textAlign: "center" }}>this visit</AccentText>
        </View>
        <View accessible accessibilityLabel={`${doctor.name}, ${doctor.specialty}. ${day.spoken} at ${slot.label}. ${doctor.room}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 24, borderCurve: "continuous", backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line }}>
          <DoctorAvatar doctor={doctor} size={48} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ ...type.headline, color: palette.ink }}>{doctor.name}</Text>
            <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{day.weekday} {day.date} · {slot.label}</Text>
            <Text style={{ ...type.footnote, color: palette.muted }}>{doctor.room}</Text>
          </View>
        </View>
        <TextInput value={reason} onChangeText={setReason} placeholder="Reason (optional), e.g. still coughing" placeholderTextColor={palette.muted} maxLength={200}
          editable={!send.isPending} returnKeyType="done" accessibilityLabel="Reason for the visit, optional" style={field} />
        <Text style={{ ...type.footnote, color: palette.muted }}>This asks your care team for this time. It is booked once they confirm; you will see it on your Schedule.</Text>
        {send.error && <Text selectable accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.red }}>{errorText(send.error)} Your request wasn't sent.</Text>}
        {/* Someone took the time meanwhile: retrying cannot help, so the next step is another time. */}
        {(send.error as { code?: string } | null)?.code === "CONFLICT" ? <Button label="Choose another time" onPress={onClose} />
          : <Button label={send.error ? "Try again" : "Send request"} busy={send.isPending} onPress={go} />}
        <Button quiet label="Cancel" disabled={send.isPending} onPress={onClose} />
      </>}
    </Animated.View>
  </KeyboardAvoidingView>;
}

/** The check draws inside the badge once it has landed (Fold). */
const CHECK = "M20 6L9 17l-5-5", CHECK_LENGTH = 23;
const AnimatedPath = Animated.createAnimatedComponent(Path);
function DrawnCheck({ still }: { still: boolean }) {
  const drawn = useSharedValue(still ? 0 : CHECK_LENGTH);
  useEffect(() => { if (!still) drawn.set(withDelay(140, withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) }))); }, [still, drawn]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: drawn.value }));
  return <Svg width={30} height={30} viewBox="0 0 24 24" fill="none"><AnimatedPath d={CHECK} stroke={palette.white} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={CHECK_LENGTH} animatedProps={props} /></Svg>;
}
/** Title, line and card rise in after the check, 60 ms apart. */
const after = (i: number) => FadeInDown.duration(320).easing(Easing.out(Easing.cubic)).delay(300 + i * 60);

/** The badge lands on the confirm spring (380 ms, damping 0.72) from 0.6. */
const pop = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] },
    animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};
