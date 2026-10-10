import { Icon } from "@/components/icon";
import { Marked } from "@/components/marked";

import { type RuleTone, ruleHeading } from "./summary";
import "@/styles/ai.css";

/** One AskRows row from the hospital's data. `op` marks a row that can be opened. */
export type RuleRow = { id?: string; title: string; detail?: string; tone: RuleTone; op?: string };
const TONE_WORD: Record<RuleTone, string> = { urgent: "Urgent", soon: "Soon", good: "Done", calm: "" };

/**
 * A rule answer from the hospital's data (the Sona bar's AskLead and AskRows): the lead sentence, a count line
 * ("2 patients need you", or `heading`), then one row per item with its tone dot, title and detail. A row with an `op`
 * opens with `onOpen(row)` and shows a chevron.
 */
export function RuleAnswer({ lead, rows, noun, heading, onOpen }: { lead: string; rows: RuleRow[]; noun?: [string, string]; heading?: string; onOpen?: (row: RuleRow) => void }) {
  return (
    <div className="ai-rule">
      <p className="ai-bottom-line"><Marked text={lead} /></p>
      {rows.length ? (
        <div className="ai-rule-group">
          <p className="ai-rule-heading">{heading ?? ruleHeading(rows, noun)}</p>
          <ul className="ai-rule-rows">
            {rows.map((row, i) => {
              const body = (
                <>
                  <span className="ai-dot" data-tone={row.tone} />
                  <span className="ai-rule-text">
                    <span className="ai-rule-title">{TONE_WORD[row.tone] ? <span className="visually-hidden">{TONE_WORD[row.tone]}: </span> : null}{row.title}</span>
                    {row.detail ? <span className="ai-rule-detail">{row.detail}</span> : null}
                  </span>
                </>
              );
              return (
                <li key={row.id ?? i}>
                  {onOpen && row.op ? (
                    <button type="button" className="ai-rule-row" onClick={() => onOpen(row)}>{body}<span className="ai-rule-go"><Icon name="chevron-right" size={16} /></span></button>
                  ) : <div className="ai-rule-row">{body}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
