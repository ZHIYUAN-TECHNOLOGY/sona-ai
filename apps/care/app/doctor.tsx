import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { Easing, FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DoctorAvatar } from "@/features/doctors/avatar";
import { BookingSheet } from "@/features/doctors/booking";
import { dayParts, doctorById, nameLines, slots, type Doctor } from "@/features/doctors/data";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { BackButton, Card, CircleButton, ICON } from "@/lib/ui";

const HEART = "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";
const rise = (i: number) => FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
const BAR = 56;

/**
 * Doctor details (Life OS): back, centred title and a favourite heart; the name huge on two lines with
 * the initials avatar; one white card with rating, years, room and languages, then the schedule (the
 * next clinic days, then that day's times) and a line about them. The bottom bar: chat with the care
 * team and the blue "Book appointment", live once a time is picked, which opens the review card.
 * ponytail: the favourite is local to this visit of the screen; persist it when favourites mean something.
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
  const [now] = useState(() => new Date());
  const days = slots(d, now);
  const [dayAt, setDayAt] = useState(0);
  const [time, setTime] = useState<number>();
  const [favourite, setFavourite] = useState(false);
  const [booking, setBooking] = useState(false);
  const [first, rest] = nameLines(d.name);
  const day = days[dayAt];
  const slot = time === undefined ? undefined : day?.times[time];
  const next = days[0] && dayParts(days[0].day);
  const enter = (i: number) => still ? undefined : rise(i);

  return <View style={{ flex: 1 }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: BAR + Math.max(insets.bottom, 12) + 32, gap: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <BackButton />
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "500", color: palette.ink }}>Doctor details</Text>
        <CircleButton d={HEART} tint={favourite ? palette.blue : palette.ink} label={favourite ? "Remove from favourites" : "Add to favourites"} onPress={() => setFavourite(f => !f)} />
      </View>

      <Animated.View entering={enter(0)} accessible accessibilityRole="header"
        accessibilityLabel={[d.name, d.specialty, d.careTeam && "In your care team", next && `Next clinic ${next.spoken}`].filter(Boolean).join(". ")}
        style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ fontSize: 40, lineHeight: 44, letterSpacing: -1.4, fontWeight: "300", color: palette.ink }}>{first}{"\n"}{rest}</Text>
          <Text style={{ ...type.body, color: palette.muted }}>
            {d.specialty}{d.careTeam && <Text style={{ fontWeight: "600", color: palette.blue }}> · Your care team</Text>}
          </Text>
        </View>
        <DoctorAvatar doctor={d} size={112} />
      </Animated.View>

      <Animated.View entering={enter(1)}>
        <Card style={{ gap: 16 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Stat value={`★ ${d.rating}`} label={`${d.reviews} reviews`} spoken={`Rated ${d.rating} of 5 from ${d.reviews} reviews`} />
            <Stat value={`${d.years}`} label="Years" spoken={`${d.years} years of practice`} />
          </View>
          <View style={{ gap: 4 }}>
            <Text style={{ ...type.body, color: palette.ink }}>{d.room}</Text>
            <Text style={{ ...type.footnote, color: palette.muted }}>Speaks {d.languages.join(", ").replace(/, ([^,]*)$/, " and $1")}</Text>
          </View>

          <View style={{ gap: 10 }}>
            <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Schedule</Text>
            {days.length ? <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
                {days.map((x, i) => {
                  const p = dayParts(x.day), on = i === dayAt;
                  return <Pressable key={x.day.toISOString()} accessibilityRole="button" accessibilityLabel={p.spoken} accessibilityState={{ selected: on }}
                    onPress={() => { setDayAt(i); setTime(undefined); }}
                    style={({ pressed }) => ({ minWidth: 56, minHeight: 72, paddingHorizontal: 6, borderRadius: 28, alignItems: "center", justifyContent: "center", gap: 2,
                      backgroundColor: on ? palette.blue : palette.mutedWash, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
                    <Text style={{ fontSize: 12, fontWeight: "500", color: on ? "rgba(255,255,255,0.8)" : palette.muted }}>{p.weekday}</Text>
                    <Text style={{ fontSize: 18, fontWeight: "600", fontVariant: ["tabular-nums"], color: on ? palette.white : palette.ink }}>{p.date}</Text>
                  </Pressable>;
                })}
              </ScrollView>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {day?.times.map((t, i) => {
                  const on = i === time;
                  return <Pressable key={t.label} accessibilityRole="button" accessibilityLabel={`${t.label}, ${dayParts(t.date).spoken}`} accessibilityState={{ selected: on }} onPress={() => setTime(i)}
                    style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, alignItems: "center", justifyContent: "center",
                      backgroundColor: on ? palette.blue : palette.white, borderWidth: 1, borderColor: on ? palette.blue : palette.line, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
                    <Text style={{ fontSize: 14, fontWeight: on ? "600" : "400", fontVariant: ["tabular-nums"], color: on ? palette.white : palette.ink }}>{t.label}</Text>
                  </Pressable>;
                })}
              </View>
              {!slot && <Text style={{ ...type.footnote, color: palette.muted }}>Pick a time, then book.</Text>}
            </> : <Text style={{ ...type.body, color: palette.muted }}>No clinic in the next two weeks. Ask your care team.</Text>}
          </View>

          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>About</Text>
            <Text style={{ ...type.body, color: palette.muted }}>{d.about}</Text>
          </View>
        </Card>
      </Animated.View>
      <Text style={{ ...type.footnote, color: palette.faint, textAlign: "center" }}>Sample doctor · Demo General Hospital (synthetic)</Text>
    </ScrollView>

    <View style={{ position: "absolute", left: 16, right: 16, bottom: Math.max(insets.bottom, 12), flexDirection: "row", alignItems: "center", gap: 10 }}>
      <CircleButton d={ICON.chat} size={BAR} label="Message your care team" onPress={() => router.push("/messages")} />
      <Pressable accessibilityRole="button" accessibilityLabel="Book appointment" accessibilityHint={slot ? "Review and send a request" : "Pick a time first"} accessibilityState={{ disabled: !slot }}
        disabled={!slot} onPress={() => setBooking(true)}
        style={({ pressed }) => ({ flex: 1, minHeight: BAR, borderRadius: BAR / 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, backgroundColor: palette.blue, opacity: slot ? 1 : 0.45,
          boxShadow: slot ? "0 16px 30px -14px rgba(51,92,255,0.8), inset 0 1px 0 rgba(255,255,255,0.25)" : undefined, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>Book appointment</Text>
      </Pressable>
    </View>

    {booking && slot && <BookingSheet doctor={d} slot={slot} onClose={() => setBooking(false)} />}
  </View>;
}

function Stat({ value, label, spoken }: { value: string; label: string; spoken: string }) {
  return <View accessible accessibilityLabel={spoken} style={{ flex: 1, gap: 2, padding: 12, borderRadius: 16, borderCurve: "continuous", backgroundColor: palette.mutedWash }}>
    <Text style={{ fontSize: 20, lineHeight: 25, fontWeight: "600", color: palette.ink }}>{value}</Text>
    <Text style={{ ...type.footnote, color: palette.muted }}>{label}</Text>
  </View>;
}
