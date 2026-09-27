import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { useCheckIns } from "@/features/check-ins/today";
import { markTaken, rise, useNextDose, useNow } from "@/features/doses";
import { dosesToday, early, weekOf, type WeekDay } from "@/features/doses/model";
import { dayLabel, timeLabel, away } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { consistency, latestUpdate, nextCapsule, type Update } from "@/features/home";
import { useMessageNeeds } from "@/features/messages/row";
import { Text } from "@/lib/text";
import { palette } from "@/lib/theme";
import { HoldButton, ICON, pillStyle, surfaceStyle } from "@/lib/ui";

/**
 * Home's bento (the kit's "Child Home"): four #FAFAFA tiles in two columns, each one labelled button
 * (a `footer` control, the hold or Book, stays its own element). `still` skips the 40 ms rise (Reduce
 * Motion, or home was shown before); `grow` lets a tall tile fill its column so both columns end level.
 */
function Tile({ label, onPress, index, still, grow, footer, children }: { label: string; onPress: () => void; index: number; still: boolean; grow?: boolean; footer?: ReactNode; children: ReactNode }) {
  return <Animated.View entering={rise(still, index)} style={grow && { flexGrow: 1 }}>
    <Pressable accessible={false} onPress={onPress}
      style={({ pressed }) => [surfaceStyle, { flexGrow: 1, padding: 20, gap: 14, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
      <View accessible accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onPress} style={{ flexGrow: 1, gap: 14 }}>{children}</View>
      {footer}
    </Pressable>
  </Animated.View>;
}

const Kicker = ({ children }: { children: string }) => <Text style={{ fontSize: 14, lineHeight: 19, color: palette.faint }}>{children}</Text>;
const Capsule = ({ children }: { children: string }) => <View style={[pillStyle, { alignSelf: "flex-start", minHeight: 32, paddingHorizontal: 12, justifyContent: "center" }]}>
  <Text numberOfLines={1} style={{ fontSize: 14, lineHeight: 19, fontWeight: "500", color: palette.ink, fontVariant: ["tabular-nums"] }}>{children}</Text>
</View>;
const Icon = ({ d, size = 20, color = palette.ink }: { d: string; size?: number; color?: string }) =>
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={d} fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></Svg>;

/**
 * Today's medicines (tall): a green check per dose taken today, grey for the rest, "2 of 3 doses taken",
 * and a white capsule for when the next is. Within 2 h of a dose (or late) the capsule is a hold to take
 * it right here. Tap opens the medicine screen.
 */
export function MedicinesTile({ index, still }: { index: number; still: boolean }) {
  const now = useNow();
  const { plan, dose, taken, meds } = useNextDose(now);
  const out = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const today = dosesToday(meds, out, taken, now), done = today.filter(d => d.taken).length;
  const hold = dose && !early(dose.dueAt, now);
  const when = dose && !hold ? nextCapsule(dose.dueAt, now) : undefined;
  const summary = today.length ? `${done} of ${today.length} doses taken` : out ? "Nothing due today" : "Shows once you're home";
  return <Tile index={index} still={still} grow label={`Today's medicines. ${summary}.${hold ? ` ${dose.name} is due.` : when ? ` ${when}.` : ""} Open medicines`}
    onPress={() => router.push(out ? "/dose" : "/discharge")}
    footer={hold && <HoldButton key={dose.key} compact label={`Hold · ${dose.name}`} doneLabel={`${dose.name} taken`} onDone={() => markTaken(dose.key)} />}>
    <Kicker>Today&apos;s medicines</Kicker>
    {today.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {today.map(d => <View key={d.key} style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: d.taken ? palette.success : "#F0F0F0" }}>
        {d.taken && <Icon d="M6 12.5l4 4L18 8" size={18} color={palette.white} />}
      </View>)}
    </View>}
    <Text style={{ flexGrow: 1, fontSize: 20, lineHeight: 26, fontWeight: "500", letterSpacing: -0.6, color: palette.faint }}>
      {today.length ? <><Text style={{ color: palette.ink }}>{done} of {today.length}</Text> doses taken</> : summary}
    </Text>
    {when && <Capsule>{when}</Capsule>}
  </Tile>;
}

// A day's bar: blue when every dose was taken, grey otherwise; its height says how much was taken.
const BAR: Record<WeekDay["state"], number> = { all: 1, some: 0.6, none: 0.3, ahead: 0.45, free: 0.15 };

/** Consistency (short): the share of the week's doses taken, big, over a bar per day since discharge (at most 7). */
export function ConsistencyTile({ index, still }: { index: number; still: boolean }) {
  const now = useNow();
  const { plan, taken, meds } = useNextDose(now);
  const out = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const pct = consistency(meds, out, taken, now), week = weekOf(meds, out, taken, now);
  return <Tile index={index} still={still} label={`Consistency. ${pct === undefined ? "Shows once a dose is due" : `${pct}% of this week's doses taken`}. Open medicines`}
    onPress={() => router.push(out ? "/dose" : "/discharge")}>
    <Kicker>Consistency</Kicker>
    {pct === undefined
      ? <Text style={{ fontSize: 17, lineHeight: 23, color: palette.muted }}>Shows once a dose is due</Text>
      : <>
        <Text style={{ fontSize: 28, lineHeight: 32, fontWeight: "500", letterSpacing: -1.2, color: palette.ink, fontVariant: ["tabular-nums"] }}>{pct}<Text style={{ fontSize: 14, fontWeight: "400", color: palette.faint }}> %</Text></Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 32 }}>
          {week.map((d, i) => <View key={i} style={{ width: 7, height: `${BAR[d.state] * 100}%`, borderRadius: 4, backgroundColor: d.state === "all" ? palette.info : "rgba(31,31,31,0.17)" } as ViewStyle} />)}
        </View>
      </>}
  </Tile>;
}

const FACE: Record<Update["face"], string> = { smile: "M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01", calm: "M8 15h8M9 9h.01M15 9h.01", chat: "" };
const TONE: Record<Update["tone"], { fill: string; text: string }> = {
  green: { fill: palette.success, text: palette.green }, amber: { fill: palette.warning, text: palette.amber },
  blue: { fill: palette.info, text: palette.blue }, muted: { fill: palette.faint, text: palette.muted },
};
const SPARKLE = "M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2Z";

/** Latest update (short): a face or chat icon in a white circle and one sparkle line; tap goes to it. */
export function LatestTile({ index, still, onCheckIn }: { index: number; still: boolean; onCheckIn: () => void }) {
  const u = latestUpdate(useCheckIns().data, useMessageNeeds() > 0, useNow());
  const go = () => u.to === "check-in" ? onCheckIn() : router.push(u.to === "messages" ? "/messages" : "/check-ins");
  return <Tile index={index} still={still} label={`Latest update. ${u.line}`} onPress={go}>
    <Kicker>Latest update</Kicker>
    <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.white }}>
      <Svg width={26} height={26} viewBox="0 0 24 24">
        {u.face === "chat" ? <Path d={ICON.chat} fill="none" stroke={palette.ink} strokeWidth={1.8} strokeLinejoin="round" />
          : <><Circle cx={12} cy={12} r={10} fill="none" stroke={palette.ink} strokeWidth={1.8} /><Path d={FACE[u.face]} fill="none" stroke={palette.ink} strokeWidth={2} strokeLinecap="round" /></>}
      </Svg>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Svg width={14} height={14} viewBox="0 0 24 24"><Path d={SPARKLE} fill={TONE[u.tone].fill} /></Svg>
      <Text style={{ flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: "500", color: TONE[u.tone].text }}>{u.line}</Text>
    </View>
  </Tile>;
}

const PENCIL = "M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4";

/**
 * Next visit (tall): its time (or day) in a white capsule, what it is big, the hospital, then the day
 * and how far off (amber once due soon or overdue) with an edit pencil. Tap opens My visits. None
 * booked: says so, with Book to find a doctor. The data has no doctor or room yet, so neither is shown.
 */
export function VisitTile({ index, still, hospital }: { index: number; still: boolean; hospital?: string }) {
  const { data } = useFollowUps();
  const next = data?.[0];
  if (!next) return <Tile index={index} still={still} grow label={data ? "No visit booked" : "Your visits show here"} onPress={() => router.push(data ? "/doctors" : "/follow-ups")}
    footer={data && <Pressable accessibilityRole="button" accessibilityLabel="Book a visit" onPress={() => router.push("/doctors")}
      style={({ pressed }) => ({ minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>Book</Text>
    </Pressable>}>
    <Kicker>Next visit</Kicker>
    <Text style={{ flexGrow: 1, fontSize: 24, lineHeight: 28, fontWeight: "600", letterSpacing: -1, color: palette.ink }}>{data ? "No visit booked" : "Your visits show here"}</Text>
  </Tile>;
  const soon = next.status !== "upcoming";
  // The capsule carries the time, or the day when there is no time; the line under it never repeats the day.
  const time = timeLabel(next), far = next.status === "overdue" ? "overdue" : away(next.inDays);
  const when = time ? `${dayLabel(next.date)} · ${far}` : far[0]!.toUpperCase() + far.slice(1);
  return <Tile index={index} still={still} grow label={`Next visit. ${next.title}, ${time ?? dayLabel(next.date)}, ${when}.${hospital ? ` ${hospital}.` : ""} Open my visits`} onPress={() => router.push("/follow-ups")}>
    <Capsule>{time ?? dayLabel(next.date)}</Capsule>
    <View style={{ flexGrow: 1, gap: 4 }}>
      <Text numberOfLines={3} style={{ fontSize: 24, lineHeight: 28, fontWeight: "600", letterSpacing: -1, color: palette.ink }}>{next.title}</Text>
      {hospital && <Text numberOfLines={2} style={{ fontSize: 14, lineHeight: 19, color: palette.muted }}>{hospital}</Text>}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, fontWeight: soon ? "600" : "400", color: soon ? palette.amber : palette.faint }}>{when}</Text>
      <Icon d={PENCIL} />
    </View>
  </Tile>;
}
