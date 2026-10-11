import { type AnswerCard, partsOf } from "@sona-ai/domain/answer-parts";

import { AnswerCards, type ConfirmCard } from "@/components/ai/answer-cards";
import { CareMarked } from "@/components/marked";
import { Chip } from "@/components/primitives";
import { UrgentCard } from "@/features/care-messages/urgent-card";
import type { Live } from "@/lib/sona-answer";
import "@/styles/pages/care-ask.css";

/** What care.ask (or her chat agent) sends back, read loosely: an older server sends less, a newer one more (`marks`, `cards`). */
export type CareReply = {
  answer?: string; source?: string; waking?: number; grounded?: boolean; urgent?: boolean; from?: string;
  careTeam?: { line?: string }; sources?: { title: string }[]; marks?: unknown; cards?: unknown;
};

// The parts of her record the model names (care.ask's prompt lists them in English), where the words differ, as the phone says them.
const PART: Record<string, string> = { "warning-signs": "warning signs", note: "doctor's note", doses: "doses taken" };

/**
 * Where an answer is from, as the Sona Care app says it: her record and which part of it, the hospital's leaflets by
 * title, both, or general knowledge when neither.
 */
export function sourceLines(r: CareReply): string[] {
  const from = r.from?.trim(), part = from && (PART[from.toLowerCase().replace(/[\s_]+/g, "-")] ?? from);
  const lines = [r.grounded && (part ? `From your record · ${part}` : "From your record"), r.sources?.length && `From the hospital's leaflet · ${r.sources.map(s => s.title).join(", ")}`];
  const said = lines.filter((line): line is string => Boolean(line));
  return said.length ? said : ["General answer · not from your records"];
}

/** The words she got back, for the next question's history and for Listen: the answer, then the care team's line. */
export const spokenOf = (r: CareReply) => (r.careTeam?.line ? `${r.answer} ${r.careTeam.line}` : r.answer ?? "");

/** The 999 card on an urgent turn, with the warning signs that brought it up when the server sent them. */
export function Call999({ title = "If this is happening now, call 999", items = [] }: { title?: string; items?: string[] }) {
  return (
    <UrgentCard title={title}>
      <p>This can't wait for a reply from your care team.</p>
      {items.length ? <ul className="ai-card-list">{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : null}
    </UrgentCard>
  );
}

/** The 999 card a streamed answer already showed (care.askStream), kept when no answer follows: once shown, it stays. */
export const shown999 = (live?: Live) => live?.sos?.type === "warning" ? <Call999 title={live.sos.title} items={live.sos.items} /> : null;

const same = (a: AnswerCard) => (b: AnswerCard) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A Sona Care answer, on the Ask page and in the Sona panel. The 999 card leads when the turn is urgent (the 999 rules
 * or the model flagged it), with the plan's warning signs when the server sent them; the model's words always follow,
 * never replaced. Then the care team's line, the cards from her record (a drafted action confirmed with `confirm`) and
 * where it is from. Streamed (`live`, care.askStream), it shows what has come so far: the 999 card, the lane's drafted
 * card with Sona's line over it, then the words, plain; once whole (`reply`), the marks and the rest of the cards join
 * them, and the lane's card stays over the words while the answer still has it, so nothing above them moves.
 */
export function CareAnswer({ reply, live, confirm }: { reply?: CareReply; live?: Live; confirm?: ConfirmCard }) {
  const { marks, cards = [] } = partsOf(reply ?? {});
  const sos = (reply ? cards.find(c => c.type === "warning" && c.level === "urgent") : undefined) ?? live?.sos;
  const lane = live?.lane && (!reply || cards.some(same(live.lane.card))) ? live.lane : undefined;
  const words = reply ? reply.answer ?? "" : live?.words;
  return (
    <>
      {reply?.source === "fixture" ? <Chip tone="neutral">Sample answer</Chip> : null}
      {reply?.urgent || sos ? <Call999 {...sos?.type === "warning" && { title: sos.title, items: sos.items }} /> : null}
      {lane ? <>{lane.lead ? <p>{lane.lead}</p> : null}<AnswerCards cards={[lane.card]} app="care" confirm={confirm} /></> : null}
      {/* Keeps the answer's own line breaks: a numbered list stays a list. */}
      {reply || words ? <p className="ask-answer"><CareMarked text={words ?? ""} marks={reply ? marks : []} /></p> : <p className="sona-turn-note">Sona is thinking…</p>}
      {reply?.careTeam?.line ? <p><CareMarked text={reply.careTeam.line} /></p> : null}
      {reply ? <AnswerCards cards={cards.filter(c => c !== sos && !(lane && same(lane.card)(c)))} app="care" confirm={confirm} /> : null}
      {reply ? sourceLines(reply).map(line => <p key={line} className="sona-turn-note">{line}</p>) : null}
    </>
  );
}
