import { partsOf } from "@sona-ai/domain/answer-parts";

import { AnswerCards, type ConfirmCard } from "@/components/ai/answer-cards";
import { CareMarked } from "@/components/marked";
import { Chip } from "@/components/primitives";
import { UrgentCard } from "@/features/care-messages/urgent-card";
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

/**
 * A Sona Care answer, on the Ask page and in the Sona panel. The 999 card leads when the turn is urgent (the 999 rules
 * or the model flagged it), with the plan's warning signs when the server sent them; the model's words always follow,
 * never replaced. Then the care team's line, the cards from her record (a drafted action confirmed with `confirm`) and
 * where it is from.
 */
export function CareAnswer({ reply, confirm }: { reply: CareReply; confirm?: ConfirmCard }) {
  const { marks, cards = [] } = partsOf(reply);
  const sos = cards.find(c => c.type === "warning" && c.level === "urgent");
  return (
    <>
      {reply.source === "fixture" ? <Chip tone="neutral">Sample answer</Chip> : null}
      {reply.urgent || sos ? <Call999 {...sos?.type === "warning" && { title: sos.title, items: sos.items }} /> : null}
      {/* Keeps the answer's own line breaks: a numbered list stays a list. */}
      <p className="ask-answer"><CareMarked text={reply.answer ?? ""} marks={marks} /></p>
      {reply.careTeam?.line ? <p><CareMarked text={reply.careTeam.line} /></p> : null}
      <AnswerCards cards={cards.filter(c => c !== sos)} app="care" confirm={confirm} />
      {sourceLines(reply).map(line => <p key={line} className="sona-turn-note">{line}</p>)}
    </>
  );
}
