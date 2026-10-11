import type { ActionCard, AnswerCard, Tone } from "@sona-ai/domain/answer-parts";
import { toneOf } from "@sona-ai/domain/answer-parts";
import { useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, View, type ViewStyle } from "react-native";
import { errorText } from "@/features/errors";
import { markTaken } from "@/features/doses/log";
import { DoctorAvatar } from "@/features/doctors/avatar";
import type { Doctor } from "@/features/doctors/data";
import { tFor, useLang, useT } from "@/lib/i18n";
import { Icon, type IconName } from "@/lib/icons";
import { Text } from "@/lib/text";
import { palette, tones, type } from "@/lib/theme";
import { Call999, inkPill, pillStyle, surfaceStyle } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import { amountOf, cardLabel, careCards, flagWord, momentOf, statusWord, timesOf } from "./cards";
import "./strings";

/**
 * The cards under one of Sona's answers (answer-parts AnswerCard: built by the server from her record, never by the
 * model), in Sona Care's glass, stacked under the words with the answer's own entrance (none under Reduce Motion): her
 * medicine (tap for how to take it), a result or home reading with its value large and its flag as a word, a visit
 * (tap for the schedule), warning signs (the 999 card first when urgent), steps, a doctor, and at most one drafted
 * action. Nothing is done before she confirms (UX rule 4): the action's button makes the app's own call with the
 * server's drafted payload, then its done line takes the button's place and is announced. `run` stands in for those
 * calls on the preview screen.
 */
export type Run = (a: ActionCard, requestId: string) => Promise<unknown>;

export function AnswerCards({ cards, run = confirmAction }: { cards?: AnswerCard[]; run?: Run }) {
  const shown = careCards(cards);
  if (!shown.length) return null;
  return <View style={{ gap: 10 }}>{shown.map((c, i) => <CardView key={i} c={c} run={run} />)}</View>;
}

/** An id for a message sent from this phone, so a retry is never a second message (care.messages.send). */
export const newRequestId = () => `care-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Confirming a drafted action: the app's own call for it, with the server's payload (which the server checks again). */
export function confirmAction(a: ActionCard, requestId: string): Promise<unknown> {
  const fresh = (...keys: readonly unknown[][]) => { for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey }); };
  switch (a.do) {
    case "book": return client.care.bookings.request(a.payload).then(() => fresh(orpc.care.bookings.key(), orpc.care.doctors.key()));
    // Kept on the phone at once and sent to the server, as a hold on the dose screen does (it waits offline).
    case "logDose": markTaken(a.payload.key); return Promise.resolve();
    case "logReading": return client.care.readings.add({ ...a.payload, kind: a.payload.kind as Parameters<typeof client.care.readings.add>[0]["kind"] }).then(() => fresh(orpc.care.readings.key()));
    case "tellCareTeam": return client.care.messages.send({ text: a.payload.text, requestId }).then(() => fresh(orpc.care.messages.key()));
    case "createTask": return Promise.reject(new Error("A clinician's task is drafted in Sona Pro."));
  }
}

function CardView({ c, run }: { c: AnswerCard; run: Run }) {
  const lang = useLang(), t = tFor(lang);
  const label = cardLabel(c, lang);
  switch (c.type) {
    case "medicine": return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t("dose.openHint")}
      onPress={() => router.push({ pathname: "/medicine", params: { name: c.name } })} style={({ pressed }) => [ROW, pressed && PRESSED]}>
      <Disc icon="pill" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, color: palette.ink }}>{c.name}</Text>
        {!!(c.dose || c.times?.length) && <Text style={{ ...type.footnote, color: palette.muted }}>{[c.dose, c.times?.length && timesOf(c.times, lang)].filter(Boolean).join(" · ")}</Text>}
        {!!(c.how || c.note) && <Text style={{ ...type.footnote, color: palette.muted }}>{[c.how, c.note].filter(Boolean).join(" · ")}</Text>}
        <Source text={c.source} />
      </View>
      <Icon name="next" color={palette.pale} size={18} />
    </Pressable>;
    case "result": case "reading": return <View accessible accessibilityLabel={label} style={[ROW, { alignItems: "flex-start" }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted, flexShrink: 1 }}>{c.type === "result" ? c.test : c.label}</Text>
          {c.flag && <Word tone={toneOf(c)} text={flagWord(c.flag, lang)} />}
        </View>
        <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: "600", letterSpacing: -0.8, color: palette.ink, fontVariant: ["tabular-nums"] }}>{amountOf(c)}</Text>
        {!!(c.type === "result" && c.range || c.at) && <Text style={{ ...type.footnote, color: palette.muted }}>
          {[c.type === "result" && c.range && t("ask.range", { range: c.range }), c.at && momentOf(c.at, lang)].filter(Boolean).join(" · ")}
        </Text>}
        {c.type === "result" && <Source text={c.source} />}
      </View>
    </View>;
    case "appointment": return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t("ask.openSchedule")}
      onPress={() => router.push("/follow-ups")} style={({ pressed }) => [ROW, pressed && PRESSED]}>
      <Disc icon="calendar" />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ gap: 1 }}>
          <Text style={{ ...type.headline, color: palette.ink }}>{c.title}</Text>
          <Text style={{ ...type.footnote, color: palette.muted }}>{[momentOf(c.when, lang), c.where].filter(Boolean).join(" · ")}</Text>
        </View>
        <Word tone={toneOf(c)} text={statusWord(c.status, lang)} />
      </View>
      <Icon name="next" color={palette.pale} size={18} />
    </Pressable>;
    case "warning": return <View style={{ gap: 10 }}>
      {c.level === "urgent" && <Call999 label={t("ask.call999")} line={t("ask.call999Line")} />}
      <List label={label} title={c.title} titleColor={c.level === "info" ? palette.ink : tones[toneOf(c)].fg} items={c.items} />
    </View>;
    case "steps": return <List label={label} title={c.title} items={c.items} numbered />;
    case "doctor": return <DoctorCard d={c} />;
    case "action": return <ActionDraft a={c} run={run} />;
  }
}

/** A drafted action as one glass card: what it is, what will happen, and the one ink button; then its done line. */
function ActionDraft({ a, run }: { a: ActionCard; run: Run }) {
  const lang = useLang();
  // One id per draft, so sending it again after an error is never a second message.
  const [requestId] = useState(newRequestId);
  const go = useMutation({
    mutationFn: () => run(a, requestId),
    onSuccess: () => {
      if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(a.done);
    },
  });
  return <View style={[surfaceStyle, { padding: 18, gap: 10 }]}>
    <View accessible accessibilityLabel={cardLabel(a, lang)} style={{ gap: 6 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{a.title}</Text>
      {a.items?.map(item => <Bullet key={item} text={item} />)}
      {a.what && <Text style={{ ...type.footnote, color: palette.muted }}>{a.what}</Text>}
    </View>
    {go.isSuccess ? <Done text={a.done} />
      : <View style={{ alignSelf: "flex-start", maxWidth: "100%" }}><Action icon={ACTION_ICON[a.do]} label={a.confirm} busy={go.isPending} ink onPress={() => go.mutate()} /></View>}
    {go.error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{errorText(go.error, lang)}</Text>}
  </View>;
}
const ACTION_ICON: Record<ActionCard["do"], IconName> = { book: "calendar", logDose: "pill", logReading: "pencil", tellCareTeam: "chat", createTask: "check" };

/** A doctor inline in an answer: their face, name, specialty and where; tap for their page. */
export function DoctorCard({ d }: { d: Pick<Doctor, "id" | "name" | "specialty" | "room" | "rating" | "careTeam"> }) {
  const t = useT();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("ask.doctorA11y", { name: d.name, specialty: d.specialty, team: d.careTeam ? t("ask.yourTeamA11y") : "", rating: d.rating, room: d.room })} accessibilityHint={t("ask.openPage")}
    onPress={() => router.push({ pathname: "/doctor", params: { id: d.id } })}
    style={({ pressed }) => [ROW, pressed && PRESSED]}>
    <DoctorAvatar doctor={d} size={48} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{d.name}</Text>
      <Text style={{ ...type.footnote, color: palette.muted }}>{d.specialty} · ★ {d.rating} · {d.room}</Text>
      {d.careTeam && <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{t("ask.yourTeam")}</Text>}
    </View>
    <Icon name="next" color={palette.pale} size={18} />
  </Pressable>;
}

/** A next step under an answer: a white capsule with an icon and a plain label. `ink` for the one that matters. */
export function Action({ icon, label, onPress, busy, ink }: { icon: IconName; label: string; onPress: () => void; busy?: boolean; ink?: boolean }) {
  const fg = ink ? palette.white : palette.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onPress}
    style={({ pressed }) => [pillStyle, { maxWidth: "100%", minHeight: 48, paddingHorizontal: 16, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 7, transform: [{ scale: pressed ? 0.96 : 1 }] },
      ink && inkPill]}>
    {busy ? <ActivityIndicator color={fg} /> : <Icon name={icon} color={fg} size={16} />}
    <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: "600", color: fg }}>{label}</Text>
  </Pressable>;
}

/** The done line that replaces a next-step button once it has happened. */
export function Done({ text }: { text: string }) {
  return <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.green, flexShrink: 1, paddingVertical: 12 }}>✓ {text}</Text>;
}

/** A glass row, as the doctor card: 24 pt corners, 76 pt tall at least, and it grows with large text. */
const ROW = [surfaceStyle, { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 24 }] as ViewStyle[];
const PRESSED: ViewStyle = { transform: [{ scale: 0.97 }] };

/** The small blue disc a row that opens something starts with (blue: the next step). */
function Disc({ icon }: { icon: IconName }) {
  return <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: palette.blueWash }}>
    <Icon name={icon} color={palette.blue} size={20} />
  </View>;
}

/** A flag or status as a word in its tone, on its wash. */
function Word({ tone, text }: { tone: Tone; text: string }) {
  return <View style={{ alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: tones[tone].bg }}>
    <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "600", color: tones[tone].fg }}>{text}</Text>
  </View>;
}

/** Where a card's facts are from ("Your discharge plan", "Lab result"), as an answer's own caption. */
function Source({ text }: { text: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
    <Icon name="doc" color={palette.faint} size={13} />
    <Text style={{ ...type.footnote, fontSize: 13, color: palette.faint, flexShrink: 1 }}>{text}</Text>
  </View>;
}

/** Warning signs or steps on the canvas, under a heading: bullets, or numbers for steps in order. */
function List({ label, title, titleColor = palette.ink, items, numbered }: { label: string; title: string; titleColor?: string; items: string[]; numbered?: boolean }) {
  return <View accessible accessibilityLabel={label} style={{ gap: 6 }}>
    <Text style={{ ...type.headline, color: titleColor }}>{title}</Text>
    {items.map((item, i) => <Bullet key={`${i}-${item}`} text={item} mark={numbered ? `${i + 1}.` : undefined} />)}
  </View>;
}

function Bullet({ text, mark = "•" }: { text: string; mark?: string }) {
  return <View style={{ flexDirection: "row", gap: 8 }}>
    <Text style={{ ...type.body, minWidth: 14, color: palette.faint, fontVariant: ["tabular-nums"] }}>{mark}</Text>
    <Text style={{ ...type.body, flex: 1, color: palette.ink }}>{text}</Text>
  </View>;
}
