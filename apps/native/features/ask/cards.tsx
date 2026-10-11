import type { AnswerCard } from "@sona-ai/domain/answer-parts";
import { createContext, use, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { List, ListRow } from "@/components/sona/list";
import { ErrorLine } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Icon, Notice, Surface } from "@/components/sona/ui";
import { errorText } from "@/features/live";
import { LockedAction, useRole } from "@/features/live/roles";
import { cardBlocks, rowOf, taskOp, type CardBlock } from "./parts";

/** What an answer's ops run with (useRunOp); a promise (a task saved on the server) is waited for before its receipt. */
type Ops = { run: (op: string) => void | Promise<unknown> };
export const OpsContext = createContext<Ops>({ run: () => {} });

/** A consequential action: what will happen, then Confirm; afterwards the receipt in its place, announced. A refusal keeps the draft and says why under Confirm, which tries again. */
export function Review({ title, items, what, confirm, done, op, locked }: { title: string; items: string[]; what?: string; confirm: string; done: string; op: string; /** A role that may not do it: the locked action, saying who can, in place of Confirm. */ locked?: { label: string; path: string } }) {
  const { run } = use(OpsContext);
  const reduced = useReduceMotionPreference();
  const [state, setState] = useState<"draft" | "saving" | "done">("draft");
  const [error, setError] = useState<string>();
  const finish = () => { setState("done"); AccessibilityInfo.announceForAccessibility(done); };
  const go = () => {
    setError(undefined);
    const saving = run(op);
    if (!saving) return finish();
    setState("saving");
    saving.then(finish, e => { setState("draft"); setError(errorText(e)); });
  };
  if (state === "done") return <Animated.View entering={reduced ? undefined : FadeIn.duration(200)} style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 14, borderRadius: radius.group, backgroundColor: "rgba(15,110,102,0.10)" }}>
    <Icon name="checkmark.circle.fill" size={18} color={palette.green} />
    <Text style={{ ...type.subhead, flex: 1, fontWeight: "600", color: palette.ink }}>{done}</Text>
  </Animated.View>;
  return <Surface feature style={{ padding: 16, gap: 10 }}>
    <Text style={{ ...type.overline, color: palette.blue }}>Review before confirming</Text>
    <Text style={{ ...type.headline, color: palette.ink }}>{title}</Text>
    {items.map(item => <Text key={item} style={{ ...type.subhead, color: palette.ink }}>· {item}</Text>)}
    {what ? <Text style={{ ...type.footnote, color: palette.muted }}>{what}</Text> : null}
    {locked ? <LockedAction {...locked} /> : <Action label={confirm} disabled={state === "saving"} onPress={go} />}
    {error && <ErrorLine text={error} />}
  </Surface>;
}

/** The urgent tone's wash, from the colour table (docs/answer-parts.md, tone.urgent). */
const URGENT_WASH = "#F6E4E4";

/**
 * A warning from the record: urgent is red with its level said ("Urgent"), soon is the amber notice, info the blue one.
 * ponytail: urgent is drawn here, not with AlertRow, which is amber; red is kept for what must not wait.
 */
function Warning({ level, title, items }: Extract<AnswerCard, { type: "warning" }>) {
  const label = [level === "urgent" ? "Urgent" : level === "soon" ? "Soon" : "", title, ...items].filter(Boolean).join(". ");
  if (level !== "urgent") return <View accessible accessibilityLabel={label}><Notice warning={level === "soon"}>
    <Text style={{ fontWeight: "600" }}>{level === "soon" ? `Soon · ${title}` : title}</Text>{items.map(i => `\n· ${i}`).join("")}
  </Notice></View>;
  return <View accessible accessibilityLabel={label} style={{ flexDirection: "row", gap: 12, padding: 14, borderRadius: radius.group, borderCurve: "continuous", backgroundColor: URGENT_WASH }}>
    <View style={{ paddingTop: 2 }}><Icon name="exclamationmark.triangle.fill" size={17} color={palette.red} /></View>
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={{ ...type.caption, fontWeight: "700", letterSpacing: 0.2, color: palette.red }}>Urgent</Text>
      <Text selectable style={{ ...type.body, lineHeight: 22, fontWeight: "600", color: palette.ink }}>{title}</Text>
      {items.map(item => <Text key={item} selectable style={{ ...type.callout, color: palette.ink }}>· {item}</Text>)}
    </View>
  </View>;
}

/** Steps from the plan or a leaflet, numbered, in a quiet surface. */
function Steps({ title, items }: Extract<AnswerCard, { type: "steps" }>) {
  return <Surface style={{ padding: 16, gap: 10 }}>
    <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>{title}</Text>
    {items.map((item, i) => <View key={i} accessible accessibilityLabel={`Step ${i + 1}. ${item}`} style={{ flexDirection: "row", gap: 10 }}>
      <Text style={{ ...type.subhead, width: 18, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{i + 1}.</Text>
      <Text selectable style={{ ...type.subhead, flex: 1, color: palette.ink }}>{item}</Text>
    </View>)}
  </Surface>;
}

/** A drafted task (the Clef lane's create_task, or Gemma's), reviewed, then saved as the follow-up tasks screen saves one. */
function TaskReview(card: Extract<CardBlock, { type: "action" }>) {
  const { can } = useRole();
  return <Review title={card.title} items={card.items ?? []} what={card.what} confirm={card.confirm} done={card.done} op={taskOp(card.payload)}
    locked={can("tasks.create") ? undefined : { label: "Needs a doctor or a nurse to add a task", path: "tasks.create" }} />;
}

function Block({ block }: { block: CardBlock }) {
  if ("rows" in block) return <List>{block.rows.map((card, i) => { const { label, ...row } = rowOf(card); return <ListRow key={i} {...row} accessibilityLabel={label} detailLines={0} divider={i > 0} />; })}</List>;
  if (block.type === "warning") return <Warning {...block} />;
  if (block.type === "steps") return <Steps {...block} />;
  return <TaskReview {...block} />;
}

/**
 * An answer's cards under its words (docs/answer-parts.md): built by the server from the record, never by the model, at
 * most one of them an action. They arrive with the answer's own entrance, so they add no motion of their own.
 */
export function AnswerCards({ cards }: { cards: AnswerCard[] }) {
  const blocks = cardBlocks(cards);
  if (!blocks.length) return null;
  return <View style={{ gap: 14 }}>{blocks.map((block, i) => <Block key={i} block={block} />)}</View>;
}
