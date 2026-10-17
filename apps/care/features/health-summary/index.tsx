import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, Share, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { rise } from "@/features/doses";
import { errorText } from "@/features/errors";
import { formatDate, tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { DOCK_SPACE } from "@/lib/dock";
import { Button, Card, LoadError, Section, surfaceStyle, Title, useBelowStatusBar } from "@/lib/ui";
import { client, orpc } from "@/utils/orpc";
import "./strings";

/** One line of a card: the label above in grey (or its meaning colour, semibold), the words in ink (or their meaning colour). */
function Fact({ label, children, color = palette.ink, labelColor, first }: { label: string; children: ReactNode; color?: string; labelColor?: string; first?: boolean }) {
  return <View style={{ gap: 2, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: palette.line }}>
    <Text style={{ ...type.footnote, color: labelColor ?? palette.faint, fontWeight: labelColor ? "600" : undefined }}>{label}</Text>
    <Text selectable style={{ ...type.body, color }}>{children}</Text>
  </View>;
}

/**
 * My health summary (a dock tab, beside Home; Home's tile and Settings open it too): her record as the hospital's PDF holds it (care.healthSummaryData, the
 * object the PDF renders), read before she shares it. Insight first: the key problems, her allergy in red, her medicines
 * and her next visit in one feature card, with Share right under it; then the record, a section with nothing in it left
 * out. Colours come from each field's type, as in her answers (assistant/marked.tsx): a medicine's name blue, its dose and
 * times violet, warning signs and flagged results red; a stopped medicine stays grey. Clinical words stay as the care team wrote them; Sona Care's own words follow her language. Sections rise 40 ms
 * apart; still under Reduce Motion.
 */
export function HealthSummaryScreen() {
  const query = useQuery(orpc.care.healthSummaryData.queryOptions()), { data: s } = query;
  const reduced = useReducedMotion();
  const lang = useLang(), t = tFor(lang);
  const below = useBelowStatusBar();
  const [share, setShare] = useState<"idle" | "busy" | { error: string }>("idle");
  const day = (at: Date | string) => formatDate(lang, at, "day");
  const send = async () => {
    setShare("busy");
    try {
      const { filename, pdf } = await client.care.healthSummary();
      const file = new File(Paths.cache, filename);
      file.write(pdf, { encoding: "base64" });
      await Share.share({ url: file.uri, title: filename });
      setShare("idle");
    } catch (e) {
      setShare({ error: errorText(e, lang) });
    }
  };
  const current = s?.medicines.filter(m => m.change !== "stopped") ?? [], stopped = (s?.medicines.length ?? 0) - current.length, next = s?.followUps[0];
  let i = 1;
  const section = (light: string, bold: string, body: ReactNode) => <Animated.View entering={rise(reduced, ++i)} style={{ gap: 12 }}><Section light={light} bold={bold} />{body}</Animated.View>;

  return <ScrollView style={below} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: DOCK_SPACE, gap: 16 }}>
    <Animated.View entering={rise(reduced, 0)} style={{ gap: 16 }}>
      <Title greeting={t("hs.titleLight")} accent={t("hs.titleBold")} line={s ? `${s.patient.name} · ${s.hospital}` : undefined} />
    </Animated.View>
    {query.isLoading && <ActivityIndicator color={palette.muted} />}
    {!s && query.error && <LoadError query={query} />}
    {s && <>
      <Animated.View entering={rise(reduced, 1)} style={{ gap: 12 }}>
        <Card feature style={{ gap: 0, paddingVertical: 12 }}>
          <Fact first label={t("hs.problems")}>{s.problems}</Fact>
          <Fact label={t("hs.allergy")} color={s.allergies ? palette.red : palette.ink}>{s.allergies ?? t("hs.none")}</Fact>
          <Fact label={t("hs.meds")}>{current.length ? stopped ? t("hs.currentStopped", { n: current.length, stopped }) : t("hs.current", { n: current.length }) : t("hs.none")}</Fact>
          {s.discharge && <Fact label={t("hs.discharged")}>{day(s.discharge.at)}</Fact>}
          <Fact label={t("hs.next")} color={next ? palette.blue : palette.ink}>{next ? `${next.title} · ${day(next.date)}` : t("hs.noneBooked")}</Fact>
        </Card>
        <Text style={{ ...type.footnote, color: palette.faint }}>{t("hs.line")}</Text>
        <Button icon="share" label={share === "busy" ? t("hs.making") : t("hs.share")} busy={share === "busy"} onPress={() => { void send(); }} />
        {typeof share === "object" && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber }}>{t("hs.failed", { why: share.error })}</Text>}
      </Animated.View>
      {section(t("hs.historyLight"), t("hs.historyBold"), <Card style={{ gap: 0, paddingVertical: 12 }}>
        <Fact first label={t("hs.cameIn")}>{s.complaint || t("hs.none")}</Fact>
        <Fact label={t("hs.medical")}>{s.history.join(", ") || t("hs.none")}</Fact>
        {s.family ? <Fact label={t("hs.family")}>{s.family}</Fact> : null}
        {s.social ? <Fact label={t("hs.social")}>{s.social}</Fact> : null}
      </Card>)}
      {s.medicines.length > 0 && section(t("hs.medsLight"), t("hs.medsBold"), <View style={[surfaceStyle, { paddingHorizontal: 18, paddingVertical: 4 }]}>
        {s.medicines.map((m, n) => <Fact key={`${n}${m.name}`} first={n === 0} label={m.change === "unchanged" ? m.name : `${m.name} · ${m.change}`}
          labelColor={m.change === "stopped" ? undefined : palette.blue} color={m.change === "stopped" ? palette.muted : palette.violet}>{m.detail || "—"}</Fact>)}
      </View>)}
      {s.results.length > 0 && section(t("hs.resultsLight"), t("hs.resultsBold"), <View style={[surfaceStyle, { paddingHorizontal: 18, paddingVertical: 4 }]}>
        {s.results.map((r, n) => <Fact key={`${n}${r.test}`} first={n === 0} label={`${r.test} · ${day(r.at)}`} color={r.flag && r.flag !== "normal" ? palette.red : palette.ink}>
          {[r.value, r.unit].filter(Boolean).join(" ")}{r.flag && r.flag !== "normal" ? `, ${r.flag}` : ""}</Fact>)}
      </View>)}
      {s.observations.length > 0 && section(t("hs.obsLight"), t("hs.obsBold"), <View style={[surfaceStyle, { paddingHorizontal: 18, paddingVertical: 4 }]}>
        {s.observations.map((o, n) => <Fact key={`${n}${o.label}`} first={n === 0} label={o.at ? day(o.at) : ""}>{o.label}</Fact>)}
      </View>)}
      {s.visitSummary && section(t("hs.visitLight"), t("hs.visitBold"), <Card>
        <Text style={{ ...type.footnote, color: palette.faint }}>{day(s.visitSummary.at)}</Text>
        <Text selectable style={{ ...type.body, color: palette.ink }}>{s.visitSummary.text}</Text>
        {s.visitSummary.whatChanged.map((w, n) => <Text key={n} style={{ ...type.body, color: palette.ink }}>•  {w}</Text>)}
      </Card>)}
      {(s.discharge || s.followUps.length > 0) && section(t("hs.nextLight"), t("hs.nextBold"), <Card>
        {s.followUps.map((f, n) => <Text key={`v${n}`} style={{ ...type.body, color: palette.blue }}>{f.title} · {day(f.date)}</Text>)}
        {s.discharge?.warningSigns.length ? <>
          <Text accessibilityRole="header" style={{ ...type.headline, color: palette.red }}>{t("hs.comeBack")}</Text>
          {s.discharge.warningSigns.map(w => <Text key={w} style={{ ...type.body, color: palette.red }}>•  {w}</Text>)}
        </> : null}
      </Card>)}
      {s.visits.length > 0 && section(t("hs.recordLight"), t("hs.recordBold"), <View style={[surfaceStyle, { paddingHorizontal: 18, paddingVertical: 4 }]}>
        {s.visits.map((v, n) => <Fact key={n} first={n === 0} label={day(v.at)}>{v.detail ? `${v.title} · ${v.detail}` : v.title}</Fact>)}
      </View>)}
      {s.careTeam.length > 0 && section(t("hs.teamLight"), t("hs.teamBold"), <View style={[surfaceStyle, { paddingHorizontal: 18, paddingVertical: 4 }]}>
        {s.careTeam.map((d, n) => <Fact key={d.name} first={n === 0} label={`${d.specialty} · ${d.room}`}>{d.name}</Fact>)}
      </View>)}
      <Text style={{ ...type.footnote, color: palette.faint }}>{t("hs.footer", { hospital: s.hospital, day: day(s.generatedAt) })}</Text>
    </>}
  </ScrollView>;
}
