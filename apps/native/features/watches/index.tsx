import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, View } from "react-native";
import { Caption, DisclosureButton, TextLink } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, radius, type } from "@/components/sona/theme";
import { Action, Icon, Notice, Surface } from "@/components/sona/ui";
import { AnswerView, openTab, useRunOp } from "@/features/ask";
import type { Answer } from "@/features/ask/answers";
import { api, errorText, requestId, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { hospitalTime } from "@/features/live/day";
import { useRole } from "@/features/live/roles";
import { wakingOf } from "@/features/live/waking";

/**
 * Watches: a clinician's own standing questions ("Every morning at 7, tell me who has low potassium"), kept by
 * their watch agent on the server and asked once a day. Said or typed on Today, a watch is shown back for
 * confirmation (`WatchProposal`), and its latest answer then sits on Today (`TodayWatches`), built from the same
 * ask catalogue as any Sona answer. A watch only reads and reports. Live mode only: demo mode has no agent.
 */
export type Watch = Awaited<ReturnType<typeof api.watches.list>>[number];

// The clinician's watches, held once for Today and the confirmation card: one read in flight serves both.
let held: Watch[] | undefined, reading: Promise<Watch[]> | undefined;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const keep = (next: Watch[]) => { held = next; listeners.forEach(l => l()); return next; };
const read = () => reading ??= api.watches.list().then(keep).finally(() => { reading = undefined; });

/** The signed-in clinician's watches in live mode (undefined until read, off, or for a role without them); re-read when one is asked or changed. */
export function useWatches() {
  const { on } = useLive();
  const readable = useRole().can("watches.list");
  const watches = useSyncExternalStore(subscribe, () => held);
  const reread = () => { if (on && readable) void read().catch(() => {}); };
  useEffect(reread, [on, readable]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveChanges(["watches"], reread);
  return on && readable ? watches : undefined;
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const asAnswer = (watch: Watch, last: Extract<Watch["last"], { source: "model" }>): Answer => ({ id: `watch:${watch.id}`, question: watch.question, spec: last.spec as Answer["spec"], worth: true });

/** A watch's latest answer, as any Sona answer reads; or, plainly, why there is none yet. */
function Latest({ watch }: { watch: Watch }) {
  const run = useRunOp(() => {}, openTab);
  const { last } = watch;
  if (!last) return <Caption>First answer at {hourLabel(watch.hour)}.</Caption>;
  if (last.source !== "model") {
    const waking = wakingOf(last);
    return <Caption>{"unanswered" in last ? "Sona couldn't answer this from the results and tasks." : waking && !last.retried ? `Sona's model is starting. This is asked again in about 5 min.` : `Sona's model wasn't ready. This is asked again at ${hourLabel(watch.hour)}.`}</Caption>;
  }
  return <View style={{ gap: 10 }}>
    {"general" in last && <Caption>General answer · not from this hospital's records</Caption>}
    <AnswerView answer={asAnswer(watch, last)} run={run} question={false} model={last.model} />
  </View>;
}

/**
 * Today's watches: each standing question with its latest answer and when it was asked. Nothing shows until the
 * clinician has one. The most recently asked leads and the rest fold behind one row, so the ranked day stays in view.
 * Stop asks first, since a tap here would otherwise end a daily check for good.
 */
export function TodayWatches() {
  const watches = useWatches();
  const [error, setError] = useState<string>();
  const [all, setAll] = useState(false);
  if (!watches?.length) return null;
  const asked = (w: Watch) => w.last?.at ?? w.createdAt;
  const newestFirst = [...watches].sort((a, b) => asked(b).localeCompare(asked(a)));
  const more = newestFirst.length - 1;
  const stop = (watch: Watch) => Alert.alert("Stop watching?", watch.question, [
    { text: "Stop watching", style: "destructive", onPress: () => { setError(undefined); api.watches.remove({ watchId: watch.id }).then(read, e => setError(errorText(e))); } },
    { text: "Cancel", style: "cancel" },
  ]);
  return <View style={{ gap: 10 }}>
    <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted }}>Sona is watching</Text>
    {(all ? newestFirst : newestFirst.slice(0, 1)).map(watch => <Surface key={watch.id} style={{ padding: 16, gap: 12 }}>
      <Text style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>✦ {watch.question} · daily at {hourLabel(watch.hour)}{watch.last ? ` · asked ${hospitalTime(new Date(watch.last.at))}` : ""}</Text>
      <Latest watch={watch} />
      <TextLink label="Stop watching" onPress={() => stop(watch)} />
    </Surface>)}
    {more > 0 && <DisclosureButton label={all ? "Show the latest only" : `See all ${watches.length} watches`} open={all} onToggle={() => setAll(v => !v)} />}
    {error && <Notice warning>{error}</Notice>}
  </View>;
}

/**
 * A watch said or typed on Today, shown back before it is kept: what Sona will ask, when, and that it only reads.
 * Confirming keeps it and asks it once now, so the first answer lands under the receipt. "Just answer once" asks
 * the question the ordinary way instead.
 */
export function WatchProposal({ question, hour, onOnce }: { question: string; hour: number; onOnce?: () => void }) {
  const { on } = useLive();
  const role = useRole();
  const watches = useWatches();
  const [id] = useState(requestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const kept = watches?.find(w => w.question === question && w.hour === hour);
  if (kept) return <View style={{ gap: 14 }}>
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 14, borderRadius: radius.group, backgroundColor: "rgba(15,110,102,0.10)" }}>
      <Icon name="checkmark.circle.fill" size={18} color={palette.green} />
      <Text style={{ ...type.subhead, flex: 1, fontWeight: "600", color: palette.ink }}>Watching · every day at {hourLabel(hour)} · answers on Today</Text>
    </View>
    <Latest watch={kept} />
  </View>;
  const allowed = role.can("watches.create");
  const start = () => {
    setBusy(true); setError(undefined);
    api.watches.create({ requestId: id, question, hour }).then(read).catch(e => setError(errorText(e))).finally(() => setBusy(false));
  };
  return <Surface feature style={{ padding: 16, gap: 10 }}>
    <Text style={{ ...type.overline, color: palette.blue }}>Review before confirming</Text>
    <Text style={{ ...type.headline, color: palette.ink }}>{question}</Text>
    <Text style={{ ...type.subhead, color: palette.ink }}>· Every day at {hourLabel(hour)}</Text>
    <Text style={{ ...type.subhead, color: palette.ink }}>· From the hospital's lab results and open tasks</Text>
    <Text style={{ ...type.footnote, color: palette.muted }}>Sona asks this each day and shows the answer on Today. A watch only reads; it never changes a record.</Text>
    <Action label={busy ? "Starting…" : "Start watching"} disabled={busy || !on || !allowed} onPress={start} />
    {!on ? <Notice>Watches need the hospital record. Switch on the live backend in Settings.</Notice> : !allowed ? <Notice>{role.why("watches.create")}</Notice> : null}
    {error && <Notice warning>{error}</Notice>}
    {onOnce && <TextLink label="Just answer once" onPress={onOnce} />}
  </Surface>;
}
