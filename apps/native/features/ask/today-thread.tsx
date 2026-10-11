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
import { routePrompt } from "@/features/encounter/state";
import { EvidenceAnswer } from "@/features/evidence";
import { Bubble } from "@/features/encounter/sona-live";
import { useLive } from "@/features/live";
import { WatchProposal } from "@/features/watches";
import { isWatch, parseWatch } from "@sona-ai/domain/watch";
import { AnswerView, KeepRow, answerFree, answerNow, useRunOp } from ".";
import { leadOf, withoutLead, type Answer } from "./answers";
import { EVIDENCE, askThread, replyTo, useThread, type Entry } from "./thread";

// Nothing to close before an answer's op runs: the page is the shell, and Live is its voice.
const stay = () => {};

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
    /**
     * `rule`: the answer when the question is a known one (the ✦ suggestion), so it never rests on matching its words.
     * A clinical question (or `evidence`, a follow-up from an evidence answer) is answered from the evidence, with citations.
     */
    ask: async (question: string, rule?: Answer, evidence = false): Promise<Required<Entry>> => {
      // A sentence that asks Sona to keep asking is shown back as a watch to confirm, before anything is kept.
      if (!rule && !evidence && isWatch(question)) { const reply = { watch: parseWatch(question) }; return { id: askThread(question, reply), question, reply }; }
      if (!rule && (evidence || routePrompt(question) === "evidence")) return { id: askThread(question, EVIDENCE), question, reply: EVIDENCE };
      const now = rule ? { answer: rule } : answerNow(question, answers, on);
      const id = askThread(question, now);
      return now ? { id, question, reply: now } : settle(id, question);
    },
    /** A notice worth asking again (the model was starting or out of reach): the entry thinks again in place. */
    again: (entry: Entry) => { replyTo(entry.id); void settle(entry.id, entry.question); },
    /** A proposed watch declined for now: its question is answered once, in the same entry. */
    once: (entry: Entry, question: string) => { const now = answerNow(question, answers, on); replyTo(entry.id, now); if (!now) void settle(entry.id, question); },
  };
}

/**
 * One question on Today and what Sona said, as a visit shows a request: the question in the glass bubble, the answer's lead
 * inked in like a visit's lead, then its view with its label, ops and, for a day-wide answer, Open as page / Save to
 * sidebar; or Sona thinking, or a notice (Ask again when that may work). `fresh` (the page's newest) inks the lead in and
 * has VoiceOver read the answer as it lands, spoken or typed alike.
 */
export function ThreadEntry({ entry, fresh = false, onAgain, onEvidence, onOnce, onTab, leave = stay }: { entry: Entry; fresh?: boolean; onAgain?: () => void; /** A proposed watch's question, answered once instead. */ onOnce?: (question: string) => void; /** An evidence answer's follow-up, asked as evidence in the same conversation. */ onEvidence?: (question: string) => void; /** A page's own tabs (Ward's filters); Today opens Patients or the ward. */ onTab?: (tab: string) => void; /** What steps aside before an op runs (a page's conversation, to show the page). */ leave?: () => void }) {
  const run = useRunOp(leave, onTab);
  const reduced = useReduceMotionPreference();
  const { reply } = entry;
  // iOS has no live regions, so a new answer is announced.
  useEffect(() => { if (fresh && reply) AccessibilityInfo.announceForAccessibility("notice" in reply ? reply.notice : "evidence" in reply ? "Searching the evidence" : "watch" in reply ? `Review before confirming: ${reply.watch.question}` : leadOf(reply.answer) ?? reply.answer.question); }, [reply]); // eslint-disable-line react-hooks/exhaustive-deps
  // The lead is said above the view, so the view goes on without it; a lead-only answer keeps just its label.
  const said = reply && "answer" in reply ? reply : undefined;
  const text = said && leadOf(said.answer), rest = said && (text ? withoutLead(said.answer) : said.answer);
  return <View style={{ gap: 16 }}>
    <Bubble text={entry.question} />
    {!reply ? <Drafting label="Thinking…" lines={2} slow={MODEL_SLOW} />
      : "evidence" in reply ? <EvidenceAnswer question={entry.question} answerKey={`evidence:${entry.id}:${entry.question}`} thread={[]} lead onAsk={q => onEvidence?.(q)} />
      : "watch" in reply ? <WatchProposal {...reply.watch} onOnce={onOnce && (() => onOnce(reply.watch.question))} />
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
        {text && <StreamedLead text={text} terms={said?.answer.marks} animate={fresh} />}
        <Animated.View entering={fresh && !reduced ? FadeInDown.duration(220) : undefined} style={{ gap: 14 }}>
          {/* An answer from general knowledge says so: it is not from this hospital's records. */}
          {said?.general && <Caption>General answer · not from this hospital's records</Caption>}
          {rest ? <AnswerView answer={rest} run={run} question={false} model={reply.model} /> : <SampleLabel source={reply.model ? "model" : "fixture"} model={reply.model} rule={!reply.model} />}
          <KeepRow answer={reply.answer} leave={leave} />
        </Animated.View>
      </>}
  </View>;
}

