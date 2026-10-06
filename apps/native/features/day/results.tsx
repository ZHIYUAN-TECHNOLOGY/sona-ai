import { View } from "react-native";
import { List, ListRow } from "@/components/sona/list";
import { Caption } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Insight, Screen, Tone } from "@/components/sona/ui";
import { openSession } from "@/features/encounter/navigation";
import { useEncounterSelect } from "@/features/encounter/store";
import { useLive } from "@/features/live";
import { useDemoOffset } from "@/features/live/demo-clock";
import { useServerData } from "@/features/live/server-day";
import { flagTone, receiptLine, todaysResults, type ResultEntry } from "./counts";
import { testInSentence } from "./model";

const clock = (at: Date) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Today's lab results across the doctor's patients: the ones waiting to be reviewed lead (red critical, amber low or
 * high), then today's acknowledged ones with who and when. A row opens the patient's briefing, where Acknowledge is.
 */
export function ResultsScreen() {
  const server = useServerData();
  const { on } = useLive();
  const acks = useEncounterSelect(s => s.resultAcks);
  const patients = useEncounterSelect(s => s.patients);
  const now = new Date(Date.now() + useDemoOffset());
  // Live mode before the server's results arrive: say so, never the demo's fixture.
  if (on && !server) return <Screen><Caption icon={null}>Reading today's results…</Caption></Screen>;

  const rows = todaysResults(server, acks, now);
  const waiting = rows.filter(r => !r.ack), done = rows.filter(r => r.ack);
  const critical = waiting.filter(r => flagTone(r.flag) === "urgent").length;
  const row = (r: ResultEntry, i: number) => {
    const patient = patients.find(p => p.id === r.patientId);
    const name = r.name ?? patient?.name ?? r.patientId;
    // "Low potassium 3.1 mmol/L", as Today and Patients say it.
    const what = r.flag ? `${sentence(r.flag)} ${testInSentence(r.test)} ${r.value}` : `${r.test} ${r.value}`;
    return <ListRow key={r.key} divider={i > 0} title={name} trailing={clock(r.at)}
      detail={r.ack ? `${what} · ${receiptLine(r.ack, now)}` : what} tone={r.ack ? "good" : flagTone(r.flag) ?? "calm"}
      // Opening a result only shows it: the briefing's Acknowledge (with its receipt) is the one way to clear it for the team.
      onPress={patient ? () => openSession(patient.id, { next: "briefing" }) : undefined} accessibilityHint={patient ? r.ack ? "Opens the briefing" : "Opens the briefing to review and acknowledge" : undefined} />;
  };

  return <Screen>
    <Insight eyebrow={`Today · ${rows.length} ${rows.length === 1 ? "result" : "results"}`}>
      {waiting.length ? <><Tone of={critical ? "urgent" : "soon"}>{waiting.length} to review</Tone>{critical ? ` · ${critical} critical` : ""}</> : rows.length ? "All results acknowledged" : "No results yet today"}
    </Insight>
    {/* The insight line already says these are to review, so they need no heading of their own. */}
    {waiting.length > 0 && <List>{waiting.map(row)}</List>}
    {done.length > 0 && <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted, paddingHorizontal: 4 }}>Acknowledged today</Text>
      <List>{done.map(row)}</List>
    </View>}
  </Screen>;
}
