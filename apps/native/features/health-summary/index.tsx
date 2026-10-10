import { File, Paths } from "expo-file-system";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Share, View } from "react-native";
import { List, ListRow } from "@/components/sona/list";
import { Caption } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Body, Card, Insight, Screen, Tone } from "@/components/sona/ui";
import { api, errorText } from "@/features/live";

/** The server's health summary (packages/api routers/health-summary): the object its PDF renders, so screen and file agree. */
type Summary = Awaited<ReturnType<typeof api.patients.summaryData>>;

/** "10 Oct 2026": the day in Malaysia, as the PDF writes it. */
const day = (at: Date | string) => new Date(new Date(at).getTime() + 8 * 3600_000).toUTCString().slice(5, 16);
const flagged = (flag: string | null) => Boolean(flag && flag !== "normal");

/** A titled white list, the way Results groups its rows. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted, paddingHorizontal: 4 }}>{title}</Text>
    <List>{children}</List>
  </View>;
}

/**
 * A patient's health summary, read before it is sent to another hospital (pushed from the patient card). Insight first:
 * who, then the key problems as the page's line; the allergy, medicines and next visit at a glance; then the record in
 * the PDF's order, a section with nothing in it left out. Share sits in the glass bar, in place: the server's PDF of
 * this same summary, written to the cache and opened in the share sheet.
 */
export function HealthSummaryScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const [summary, setSummary] = useState<Summary | { error: string }>();
  const [share, setShare] = useState<"idle" | "busy" | { error: string }>("idle");
  useEffect(() => {
    if (patientId) void api.patients.summaryData({ patientId }).then(setSummary, e => setSummary({ error: errorText(e) }));
  }, [patientId]);

  if (!summary) return <Screen><Caption icon={null}>Reading the health summary…</Caption></Screen>;
  if ("error" in summary) return <Screen><Caption icon="exclamationmark.circle" color={palette.amber}>The health summary could not be read. {summary.error}</Caption></Screen>;
  const s = summary, current = s.medicines.filter(m => m.change !== "stopped"), next = s.followUps[0];

  const send = async () => {
    setShare("busy");
    try {
      const { filename, pdf } = await api.patients.summary({ patientId: s.patient.id });
      const file = new File(Paths.cache, filename);
      file.write(pdf, { encoding: "base64" });
      await Share.share({ url: file.uri, title: filename });
      setShare("idle");
    } catch (e) {
      setShare({ error: errorText(e) });
    }
  };

  return <Screen bottom={<>
    {typeof share === "object" && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber, paddingHorizontal: 4 }}>The PDF could not be made. {share.error}</Text>}
    <Action label={share === "busy" ? "Preparing the PDF…" : "Share health summary"} icon="square.and.arrow.up" disabled={share === "busy"} onPress={() => { void send(); }}
      accessibilityLabel={`Share ${s.patient.name}'s health summary`} />
  </>}>
    <Insight eyebrow={`${s.patient.name} · ${s.patient.age} · ${s.patient.sex} · ${s.patient.id}`}>{s.problems}</Insight>
    <List>
      <ListRow title="Allergy" detail={s.allergies ?? "None recorded"} tone={s.allergies ? "urgent" : "calm"} />
      <ListRow divider title="Medicines" detail={current.length ? `${current.length} current${s.medicines.length > current.length ? `, ${s.medicines.length - current.length} stopped` : ""}` : "None recorded"} />
      {s.discharge && <ListRow divider title="Discharged" detail={day(s.discharge.at)} tone="good" />}
      <ListRow divider title="Next visit" detail={next ? `${next.title}, ${day(next.date)}` : "None booked"} tone={next ? "next" : "calm"} />
    </List>
    {/* Read in full, never cut to a row's two lines. */}
    <Card label="Problems and history">
      {([["Came in with", s.complaint || "Not recorded"], ["Medical history", s.history.join(", ") || "None recorded"], ["Family history", s.family], ["Social history", s.social]] as const)
        .filter(([, text]) => text).map(([label, text]) => <View key={label} style={{ gap: 2 }}>
          <Text style={{ ...type.footnote, color: palette.muted }}>{label}</Text>
          <Body>{text}</Body>
        </View>)}
    </Card>
    {s.medicines.length > 0 && <Group title="Medicines">
      {s.medicines.map((m, i) => <ListRow key={`${i}${m.name}`} divider={i > 0} title={m.name} detail={m.detail || undefined} detailLines={0}
        trailing={m.change === "unchanged" ? undefined : m.change} tone={m.change === "stopped" ? "soon" : m.change === "unchanged" ? "calm" : "next"} />)}
    </Group>}
    {s.results.length > 0 && <Group title="Recent results">
      {s.results.map((r, i) => <ListRow key={`${i}${r.test}`} divider={i > 0} title={r.test} trailing={day(r.at)}
        detail={`${[r.value, r.unit].filter(Boolean).join(" ")}${flagged(r.flag) ? `, ${r.flag}` : ""}`} tone={flagged(r.flag) ? r.flag === "pending" ? "soon" : "urgent" : "calm"} />)}
    </Group>}
    {s.observations.length > 0 && <Group title="Latest observations">
      {s.observations.map((o, i) => <ListRow key={`${i}${o.label}`} divider={i > 0} title={o.label} trailing={o.at ? day(o.at) : undefined} />)}
    </Group>}
    {s.visitSummary && <Card label={`Latest visit summary · ${day(s.visitSummary.at)}`}>
      <Body>{s.visitSummary.text}</Body>
      {s.visitSummary.whatChanged.map((w, i) => <Body key={i} muted>•  {w}</Body>)}
    </Card>}
    {(s.discharge || s.followUps.length > 0) && <Group title={s.discharge ? "Discharge and follow-up" : "Follow-up"}>
      {s.followUps.map((f, i) => <ListRow key={`v${i}`} divider={i > 0} title={f.title} detail={day(f.date)} tone="next" />)}
      {s.discharge?.warningSigns.map((w, i) => <ListRow key={`w${i}`} divider={i > 0 || s.followUps.length > 0} title={w} detail={i ? undefined : "Come back straight away if"} tone="urgent" />)}
    </Group>}
    {s.visits.length > 0 && <Group title="Recent record">
      {s.visits.map((v, i) => <ListRow key={i} divider={i > 0} title={v.title} detail={v.detail} detailLines={0} trailing={day(v.at)} />)}
    </Group>}
    {s.careTeam.length > 0 && <Group title="Care team">
      {s.careTeam.map((d, i) => <ListRow key={d.name} divider={i > 0} title={d.name} detail={`${d.specialty} · ${d.room}`} />)}
    </Group>}
    <Caption icon={null}>Generated {day(s.generatedAt)} by {s.hospital}. <Tone of="next">The PDF holds this same summary.</Tone></Caption>
  </Screen>;
}
