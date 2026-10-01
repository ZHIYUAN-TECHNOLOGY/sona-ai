import { useEffect } from "react";
import { AccessibilityInfo, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { Drafting, MODEL_SLOW, SampleLabel } from "@/components/sona/model-answer";
import { Caption, Press } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon } from "@/components/sona/ui";
import { StreamedLead } from "@/features/encounter/conversation";
import { Bubble, useLiveClose } from "@/features/encounter/sona-live";
import { useLive } from "@/features/live";
import { AnswerView, KeepRow, answerFree, answerNow, openTab, useRunOp } from ".";
import { leadOf, withoutLead, type Answer } from "./answers";
import { askThread, replyTo, useThread, type Entry } from "./thread";

/**
 * Asking on Today: each question joins Today's thread (thread.ts), which the page shows and Sona Live asks into. A rule
 * answer, or demo mode's notice, lands with the question; live, the entry thinks until the model (ask.free on Today's own
 * data) answers or says why not. `ask` resolves with the settled entry, for Live to show.
 */
export function useTodayThread(answers: Answer[]) {
  const { on } = useLive();
  const settle = async (id: number, question: string) => { const reply = await answerFree("today", question, answers); replyTo(id, reply); return { id, question, reply }; };
  return {
    entries: useThread(),
    /** `rule`: the answer when the question is a known one (the ✦ suggestion), so it never rests on matching its words. */
    ask: async (question: string, rule?: Answer): Promise<Required<Entry>> => {
      const now = rule ? { answer: rule } : answerNow(question, answers, on);
      const id = askThread(question, now);
      return now ? { id, question, reply: now } : settle(id, question);
    },
    /** A notice worth asking again (the model was starting or out of reach): the entry thinks again in place. */
    again: (entry: Entry) => { replyTo(entry.id); void settle(entry.id, entry.question); },
  };
}

/**
 * One question on Today and what Sona said, as a visit shows a request: the question (muted), the answer's lead inked in
 * like a visit's lead, then its view with its label, ops and, for a day-wide answer, Open as page / Save to sidebar; or
 * Sona thinking, or a notice (Ask again when that may work). `fresh` (the page's newest, while Live is closed) inks the
 * lead in and has VoiceOver read the answer as it lands. Sona Live shows it with `lead={false}`: Live shows the question
 * and says the lead itself, and the answer's ops end Live first (useLiveClose does nothing outside Live).
 */
export function ThreadEntry({ entry, lead = true, fresh = false, onAgain }: { entry: Entry; lead?: boolean; fresh?: boolean; onAgain?: () => void }) {
  const leave = useLiveClose();
  const run = useRunOp(leave, openTab);
  const reduced = useReduceMotionPreference();
  const { reply } = entry;
  // iOS has no live regions, so a new answer is announced.
  useEffect(() => { if (fresh && reply) AccessibilityInfo.announceForAccessibility("notice" in reply ? reply.notice : leadOf(reply.answer) ?? reply.answer.question); }, [reply]); // eslint-disable-line react-hooks/exhaustive-deps
  // The lead is said above the view, so the view goes on without it; a lead-only answer keeps just its label.
  const said = reply && "answer" in reply ? reply : undefined;
  const text = said && leadOf(said.answer), rest = said && (text ? withoutLead(said.answer) : said.answer);
  return <View style={{ gap: 16 }}>
    {lead && <Bubble text={entry.question} />}
    {!reply ? <Drafting label="Thinking…" lines={2} slow={MODEL_SLOW} />
      : "notice" in reply ? <View style={{ gap: 2 }}>
        <Caption>{reply.notice}</Caption>
        {reply.again && onAgain && <View style={{ alignSelf: "flex-start" }}>
          <Press onPress={onAgain} accessibilityLabel="Ask again" scale={0.96} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="arrow.clockwise" size={12} color={palette.blue} />
            <Text style={{ ...type.callout, fontWeight: "500", color: palette.blue }}>Ask again</Text>
          </Press>
        </View>}
      </View>
      : <>
        {lead && text && <StreamedLead text={text} animate={fresh} />}
        <Animated.View entering={fresh && !reduced ? FadeInDown.duration(220) : undefined} style={{ gap: 14 }}>
          {rest ? <AnswerView answer={rest} run={run} question={false} model={reply.model} /> : <SampleLabel source={reply.model ? "model" : "fixture"} model={reply.model} rule={!reply.model} />}
          {lead && <KeepRow answer={reply.answer} leave={leave} />}
        </Animated.View>
      </>}
  </View>;
}

/** Today's thread inside Sona Live, laid out as the page lays it out (the page adds its own scrolling): the newest inked in. */
export function TodayConversation({ entries, onAgain }: { entries: Entry[]; onAgain: (entry: Entry) => void }) {
  const newest = entries.at(-1);
  return <View style={{ gap: 44 }}>{entries.map(entry => <ThreadEntry key={entry.id} entry={entry} fresh={entry.id === newest?.id} onAgain={() => onAgain(entry)} />)}</View>;
}
