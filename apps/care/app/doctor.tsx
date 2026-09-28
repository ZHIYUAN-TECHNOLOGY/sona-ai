import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { DoctorAvatar } from "@/features/doctors/avatar";
import { BookingSheet } from "@/features/doctors/booking";
import { dayParts, nameLines, slotOf, type ListedDoctor, type Slot } from "@/features/doctors/data";
import { errorText } from "@/features/errors";
import { listOf } from "@/features/discharge/lines";
import { tFor, useLang } from "@/lib/i18n";
import { useMe } from "@/features/me";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText, BackButton, Card, ICON, pillStyle, surfaceStyle } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

const STAR = "M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21L12 17.77L5.82 21L7 14.14l-5-4.87l6.91-1.01z";
const AWARD = "M12 15a7 7 0 1 0 0-14a7 7 0 0 0 0 14M8.21 13.89L7 23l5-3l5 3l-1.21-9.12";
/** First appearance: a 40 ms ease-out stagger (60fps Vakitler); still under Reduce Motion. */
const rise = (i: number) => FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
const BAR = 56 + 8 + 48;

/**
 * Doctor details (the AI Health Companion kit): back; the initials avatar, the name large on two lines
 * in the headline gradient and the specialty; one card of kit form rows (rating, experience, clinic,
 * languages); the next clinic days and that day's free times (from the hospital's directory, so a
 * time already requested or booked is gone) as capsules (selected in ink); a line about
 * them. At the bottom the black "Request appointment", live once a time is picked, opens the review
 * card (a request the care team confirms), with a quiet "Message care team" under it.
 */
export default function DoctorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useMe();
  const lang = useLang(), t = tFor(lang);
  // The doctor and their free slots from the hospital's directory; a live change (a slot taken) re-reads it.
  const { data: doctor, error, isLoading } = useQuery({ ...orpc.care.doctors.get.queryOptions({ input: { id: id ?? "" } }), enabled: state === "joined" && Boolean(id) });
  if (!doctor) return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16 }}>
    <BackButton />
    {isLoading ? <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />
      : <Card><Text selectable style={{ ...type.body, color: palette.muted }}>{error ? errorText(error, lang) : t("doc.notFound")} {t("doc.pickAgain")}</Text></Card>}
  </ScrollView>;
  return <Details key={doctor.id} doctor={doctor} />;
}

function Details({ doctor: d }: { doctor: ListedDoctor }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const lang = useLang(), t = tFor(lang);
  const days = d.nextSlots.map(x => ({ day: x.day, times: x.times.map(at => slotOf(at, lang)) }));
  const [dayAt, setDayAt] = useState(0);
  const [time, setTime] = useState<number>();
  // The slot under review, held so a re-read of the free slots (live) cannot pull it from under the sheet.
  const [booking, setBooking] = useState<Slot>();
  const [first, rest] = nameLines(d.name);
  const day = days[dayAt];
  // The picked time by its moment, so a re-read that drops another slot never shifts the pick.
  const slot = day?.times.find(t => t.date.getTime() === time);
  const next = days[0] && dayParts(days[0].day, lang);
  const enter = (i: number) => still ? undefined : rise(i);

  return <View style={{ flex: 1 }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: BAR + Math.max(insets.bottom, 12) + 28, gap: 20 }}>
      <BackButton />

      <Animated.View entering={enter(0)} accessible accessibilityRole="header"
        accessibilityLabel={[d.name, d.specialty, d.careTeam && t("doc.inTeamCap"), next && t("doc.nextClinicCap", { day: next.spoken })].filter(Boolean).join(". ")}
        style={{ gap: 14 }}>
        <DoctorAvatar doctor={d} size={88} />
        <View style={{ gap: 6 }}>
          <AccentText style={{ fontSize: 34, lineHeight: 40, letterSpacing: -2, fontWeight: "600", color: palette.ink }}>{`${first}\n${rest}`}</AccentText>
          <Text style={{ ...type.body, color: palette.muted }}>
            {d.specialty}{d.careTeam && <Text style={{ fontWeight: "600", color: palette.blue }}>{t("doc.yourTeam")}</Text>}
          </Text>
        </View>
      </Animated.View>

      <Animated.View entering={enter(1)} style={[surfaceStyle, { paddingHorizontal: 18, paddingVertical: 4 }]}>
        <Fact first icon={STAR} label={t("doc.rating")} value={t("doc.ratingValue", { rating: d.rating, n: d.reviews })} spoken={t("doc.ratingA11y", { rating: d.rating, n: d.reviews })} />
        <Fact icon={AWARD} label={t("doc.experience")} value={t("doc.years", { n: d.years })} spoken={t("doc.yearsA11y", { n: d.years })} />
        <Fact icon={ICON.pin} label={t("doc.clinic")} value={d.room} spoken={t("doc.clinicA11y", { room: d.room })} />
        <Fact icon={ICON.chat} label={t("doc.speaks")} value={d.languages.join(", ")} spoken={t("doc.speaksA11y", { langs: listOf(d.languages, lang) })} />
      </Animated.View>

      <Animated.View entering={enter(2)} style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>{t("doc.clinicDays")}</Text>
        {days.length ? <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
            {days.map((x, i) => {
              const p = dayParts(x.day, lang), on = i === dayAt;
              return <Capsule key={new Date(x.day).toISOString()} on={on} label={`${p.weekday} ${p.date}`} spoken={p.spoken} onPress={() => { setDayAt(i); setTime(undefined); }} />;
            })}
          </ScrollView>
          {/* Times crossfade when the day changes (60fps Canopi Date Picker: the content morphs in place). */}
          <Animated.View key={dayAt} entering={still ? undefined : FadeIn.duration(220)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {day?.times.map(s => <Capsule key={s.label} on={s.date.getTime() === time} label={s.label} spoken={t("doc.timeA11y", { time: s.label, day: dayParts(s.date, lang).spoken })} onPress={() => setTime(s.date.getTime())} />)}
          </Animated.View>
          {!slot && <Text style={{ ...type.footnote, color: palette.muted }}>{t("doc.pickTime")}</Text>}
        </> : <Text style={{ ...type.body, color: palette.muted }}>{t("doc.noTime")}</Text>}
      </Animated.View>

      <Animated.View entering={enter(3)} style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>{t("doc.about")}</Text>
        <Text style={{ ...type.body, color: palette.muted }}>{d.about}</Text>
      </Animated.View>
      <Text style={{ ...type.footnote, color: palette.faint, textAlign: "center" }}>{t("doc.sampleFooter")}</Text>
    </ScrollView>

    <View style={{ position: "absolute", left: 20, right: 20, bottom: Math.max(insets.bottom, 12), gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("doc.request")} accessibilityHint={slot ? t("doc.requestHint") : t("doc.pickFirst")} accessibilityState={{ disabled: !slot }}
        disabled={!slot} onPress={() => setBooking(slot)}
        style={({ pressed }) => ({ minHeight: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, backgroundColor: palette.dark, opacity: slot ? 1 : 0.45, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>{t("doc.request")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("doc.messageTeam")} onPress={() => router.push("/messages")}
        style={({ pressed }) => ({ minHeight: 48, alignSelf: "center", justifyContent: "center", paddingHorizontal: 16, opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ ...type.body, fontWeight: "600", color: palette.muted }}>{t("doc.messageTeam")}</Text>
      </Pressable>
    </View>

    {booking && <BookingSheet doctor={d} slot={booking} onClose={() => setBooking(undefined)} />}
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
