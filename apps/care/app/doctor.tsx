import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { Easing, FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { DoctorAvatar } from "@/features/doctors/avatar";
import { BookingSheet } from "@/features/doctors/booking";
import { dayParts, doctorById, nameLines, slots, type Doctor } from "@/features/doctors/data";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText, BackButton, Card, ICON, pillStyle, surfaceStyle } from "@/lib/ui";
import { now as clockNow } from "@/lib/clock";

const STAR = "M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21L12 17.77L5.82 21L7 14.14l-5-4.87l6.91-1.01z";
const AWARD = "M12 15a7 7 0 1 0 0-14a7 7 0 0 0 0 14M8.21 13.89L7 23l5-3l5 3l-1.21-9.12";
/** First appearance: a 40 ms ease-out stagger (60fps Vakitler); still under Reduce Motion. */
const rise = (i: number) => FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
const BAR = 56 + 8 + 48;

/**
 * Doctor details (the AI Health Companion kit): back; the initials avatar, the name large on two lines
 * in the headline gradient and the specialty; one card of kit form rows (rating, experience, clinic,
 * languages); the next clinic days and that day's times as capsules (selected in ink); a line about
 * them. At the bottom the black "Request appointment", live once a time is picked, opens the review
 * card (a request the care team confirms), with a quiet "Message care team" under it.
 */
export default function DoctorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const doctor = doctorById(id);
  if (!doctor) return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16 }}>
    <BackButton />
    <Card><Text style={{ ...type.body, color: palette.muted }}>We couldn't find that doctor. Go back to the list and pick again.</Text></Card>
  </ScrollView>;
  return <Details key={doctor.id} doctor={doctor} />;
}

function Details({ doctor: d }: { doctor: Doctor }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [now] = useState(clockNow);
  const days = slots(d, now);
  const [dayAt, setDayAt] = useState(0);
  const [time, setTime] = useState<number>();
  const [booking, setBooking] = useState(false);
  const [first, rest] = nameLines(d.name);
  const day = days[dayAt];
  const slot = time === undefined ? undefined : day?.times[time];
  const next = days[0] && dayParts(days[0].day);
  const enter = (i: number) => still ? undefined : rise(i);

  return <View style={{ flex: 1 }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: BAR + Math.max(insets.bottom, 12) + 28, gap: 20 }}>
      <BackButton />

      <Animated.View entering={enter(0)} accessible accessibilityRole="header"
        accessibilityLabel={[d.name, d.specialty, d.careTeam && "In your care team", next && `Next clinic ${next.spoken}`].filter(Boolean).join(". ")}
        style={{ gap: 14 }}>
        <DoctorAvatar doctor={d} size={88} />
        <View style={{ gap: 6 }}>
          <AccentText style={{ fontSize: 34, lineHeight: 40, letterSpacing: -2, fontWeight: "600", color: palette.ink }}>{`${first}\n${rest}`}</AccentText>
          <Text style={{ ...type.body, color: palette.muted }}>
            {d.specialty}{d.careTeam && <Text style={{ fontWeight: "600", color: palette.blue }}> · Your care team</Text>}
          </Text>
        </View>
      </Animated.View>

      <Animated.View entering={enter(1)} style={[surfaceStyle, { paddingHorizontal: 18, paddingVertical: 4 }]}>
        <Fact first icon={STAR} label="Rating" value={`${d.rating} · ${d.reviews} reviews`} spoken={`Rated ${d.rating} of 5 from ${d.reviews} reviews`} />
        <Fact icon={AWARD} label="Experience" value={`${d.years} years`} spoken={`${d.years} years of practice`} />
        <Fact icon={ICON.pin} label="Clinic" value={d.room} spoken={`Clinic: ${d.room}`} />
        <Fact icon={ICON.chat} label="Speaks" value={d.languages.join(", ")} spoken={`Speaks ${d.languages.join(", ").replace(/, ([^,]*)$/, " and $1")}`} />
      </Animated.View>

      <Animated.View entering={enter(2)} style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Clinic days</Text>
        {days.length ? <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
            {days.map((x, i) => {
              const p = dayParts(x.day), on = i === dayAt;
              return <Capsule key={x.day.toISOString()} on={on} label={`${p.weekday} ${p.date}`} spoken={p.spoken} onPress={() => { setDayAt(i); setTime(undefined); }} />;
            })}
          </ScrollView>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {day?.times.map((t, i) => <Capsule key={t.label} on={i === time} label={t.label} spoken={`${t.label}, ${dayParts(t.date).spoken}`} onPress={() => setTime(i)} />)}
          </View>
          {!slot && <Text style={{ ...type.footnote, color: palette.muted }}>Pick a time, then send a request.</Text>}
        </> : <Text style={{ ...type.body, color: palette.muted }}>No clinic in the next two weeks. Ask your care team.</Text>}
      </Animated.View>

      <Animated.View entering={enter(3)} style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>About</Text>
        <Text style={{ ...type.body, color: palette.muted }}>{d.about}</Text>
      </Animated.View>
      <Text style={{ ...type.footnote, color: palette.faint, textAlign: "center" }}>Sample doctor · Demo General Hospital (synthetic)</Text>
    </ScrollView>

    <View style={{ position: "absolute", left: 20, right: 20, bottom: Math.max(insets.bottom, 12), gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Request appointment" accessibilityHint={slot ? "Review and send a request to your care team" : "Pick a time first"} accessibilityState={{ disabled: !slot }}
        disabled={!slot} onPress={() => setBooking(true)}
        style={({ pressed }) => ({ minHeight: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, backgroundColor: palette.dark, opacity: slot ? 1 : 0.45, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>Request appointment</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Message care team" onPress={() => router.push("/messages")}
        style={({ pressed }) => ({ minHeight: 48, alignSelf: "center", justifyContent: "center", paddingHorizontal: 16, opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ ...type.body, fontWeight: "600", color: palette.muted }}>Message care team</Text>
      </Pressable>
    </View>

    {booking && slot && <BookingSheet doctor={d} slot={slot} onClose={() => setBooking(false)} />}
  </View>;
}

/** A kit form row without a chevron (it shows, it doesn't go anywhere): icon, label, value. */
function Fact({ icon, label, value, spoken, first }: { icon: string; label: string; value: string; spoken: string; first?: boolean }) {
  return <View accessible accessibilityLabel={spoken}
    style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: palette.line }}>
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={icon} /></Svg>
    <Text style={{ ...type.body, color: palette.ink }}>{label}</Text>
    <Text style={{ flex: 1, ...type.footnote, color: palette.muted, textAlign: "right" }}>{value}</Text>
  </View>;
}

/** A day or a time: a white capsule, the selected one in ink. */
function Capsule({ label, spoken, on, onPress }: { label: string; spoken: string; on: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityState={{ selected: on }} onPress={onPress}
    style={({ pressed }) => [pillStyle, { minHeight: 48, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.96 : 1 }] },
      on && { backgroundColor: palette.dark, borderColor: palette.dark }]}>
    <Text style={{ fontSize: 15, fontWeight: on ? "600" : "500", fontVariant: ["tabular-nums"], color: on ? palette.white : palette.ink }}>{label}</Text>
  </Pressable>;
}
