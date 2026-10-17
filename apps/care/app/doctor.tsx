import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/lib/icons";
import { DoctorAvatar } from "@/features/doctors/avatar";
import { BookingSheet } from "@/features/doctors/booking";
import { dayParts, nameLines, slotOf, type ListedDoctor, type Slot } from "@/features/doctors/data";
import { listOf } from "@/features/discharge/lines";
import { tFor, useLang } from "@/lib/i18n";
import { useMe } from "@/features/me";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText, BACK_SPACE, BackButton, Card, EdgeFade, pillStyle, PinnedBack, surfaceStyle, LoadError, inkPill } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

const BAR = 56 + 8 + 48;

/**
 * Doctor details (the AI Health Companion kit): back, pinned; the initials avatar, the name large on two lines
 * in the headline gradient and the specialty; one card of kit form rows (rating, experience, clinic,
 * languages); the next clinic days and that day's free times (from the hospital's directory, so a
 * time already requested or booked is gone) as capsules (selected in ink); a line about
 * them. At the bottom, on a soft fade, the black "Request appointment", live once a time is picked, opens the
 * review card (a request the care team confirms), with a quiet "Message care team" under it.
 */
export default function DoctorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useMe();
  const lang = useLang(), t = tFor(lang);
  // The doctor and their free slots from the hospital's directory; a live change (a slot taken) re-reads it.
  const query = useQuery({ ...orpc.care.doctors.get.queryOptions({ input: { id: id ?? "" } }), enabled: state === "joined" && Boolean(id) });
  const { data: doctor, error, isLoading } = query;
  if (!doctor) return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16 }}>
    <BackButton />
    {isLoading ? <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />
      : error ? <LoadError query={query} />
      : <Card><Text selectable style={{ ...type.body, color: palette.muted }}>{t("doc.notFound")} {t("doc.pickAgain")}</Text></Card>}
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
  const bottom = Math.max(insets.bottom, 12);

  return <View style={{ flex: 1 }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: BACK_SPACE, paddingBottom: BAR + bottom + 28, gap: 20 }}>
      <Animated.View accessible accessibilityRole="header"
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

      <Animated.View style={[surfaceStyle, { paddingHorizontal: 18, paddingVertical: 4 }]}>
        <Fact first icon="star" label={t("doc.rating")} value={t("doc.ratingValue", { rating: d.rating, n: d.reviews })} spoken={t("doc.ratingA11y", { rating: d.rating, n: d.reviews })} />
        <Fact icon="medal" label={t("doc.experience")} value={t("doc.years", { n: d.years })} spoken={t("doc.yearsA11y", { n: d.years })} />
        <Fact icon="pin" label={t("doc.clinic")} value={d.room} spoken={t("doc.clinicA11y", { room: d.room })} />
        <Fact icon="chat" label={t("doc.speaks")} value={d.languages.join(", ")} spoken={t("doc.speaksA11y", { langs: listOf(d.languages, lang) })} />
      </Animated.View>

      <Animated.View style={{ gap: 12 }}>
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

      <Animated.View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>{t("doc.about")}</Text>
        <Text style={{ ...type.body, color: palette.muted }}>{d.about}</Text>
      </Animated.View>
    </ScrollView>

    {/* Back stays reachable on this long page; the fades keep scrolled text off the clock and out from under the buttons. */}
    <PinnedBack />
    <EdgeFade edge="bottom" solid={BAR + bottom} />
    <View style={{ position: "absolute", left: 20, right: 20, bottom, gap: 8 }}>
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
function Fact({ icon, label, value, spoken, first }: { icon: IconName; label: string; value: string; spoken: string; first?: boolean }) {
  return <View accessible accessibilityLabel={spoken}
    style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: palette.line }}>
    <Icon name={icon} size={20} />
    <Text style={{ ...type.body, color: palette.ink }}>{label}</Text>
    <Text style={{ flex: 1, ...type.footnote, color: palette.muted, textAlign: "right" }}>{value}</Text>
  </View>;
}

/** A day or a time: a white capsule, the selected one in ink. */
function Capsule({ label, spoken, on, onPress }: { label: string; spoken: string; on: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityState={{ selected: on }} onPress={onPress}
    style={({ pressed }) => [pillStyle, { minHeight: 48, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.96 : 1 }] },
      on && inkPill]}>
    <Text style={{ fontSize: 15, fontWeight: on ? "600" : "500", fontVariant: ["tabular-nums"], color: on ? palette.white : palette.ink }}>{label}</Text>
  </Pressable>;
}
