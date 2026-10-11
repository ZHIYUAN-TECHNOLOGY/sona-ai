import { type ActionCard, type AnswerCard, type Tone, toneOf } from "@sona-ai/domain/answer-parts";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/icon";
import { Anchor, Avatar, Button, Chip, type ChipTone } from "@/components/primitives";
import { browserLang, whenWords } from "@/features/care-follow-ups/dates";
import { whenOf } from "@/features/today/time";
import "@/styles/ai.css";

type App = "pro" | "care";
type Fact = Extract<AnswerCard, { type: "medicine" | "result" | "reading" | "appointment" | "doctor" }>;
/**
 * Makes a drafted action's call with its payload (the server checks it again). `requestId` is the same for every try of
 * one card, so trying again after a lost reply never does it twice.
 */
export type ConfirmCard = (card: ActionCard, requestId: string) => Promise<unknown>;

const FLAG = { high: "High", low: "Low", normal: "Normal", critical: "Critical" } as const;
const STATUS = { upcoming: "Upcoming", "due-soon": "Due soon", requested: "Requested", confirmed: "Confirmed", declined: "Declined", attended: "Attended", missed: "Missed" } as const;
const CHIP: Record<Tone, ChipTone> = { urgent: "urgent", soon: "soon", good: "done", calm: "neutral" };
const TILE: Record<Exclude<Fact["type"], "doctor">, IconName> = { medicine: "pill", result: "flask", reading: "activity", appointment: "calendar" };
/** Whose app does each drafted action: a patient's in Sona Care, a clinician's in Sona Pro. */
const OWNER: Record<ActionCard["do"], App> = { book: "care", logDose: "care", logReading: "care", tellCareTeam: "care", createTask: "pro" };
const ELSEWHERE: Record<App, string> = { care: "Only the patient can do this, in Sona Care.", pro: "Only the care team can do this, in Sona Pro." };

/** A moment as each app writes it, in Malaysia time: Sona Pro "Mon 26 Oct, 09:00", Sona Care in the reader's language. */
const when = (iso: string, app: App) => (app === "pro" ? whenOf(new Date(iso)) : whenWords(new Date(iso), browserLang()));
const join = (parts: (string | false | undefined)[], by = " · ") => parts.filter(Boolean).join(by);
const amount = (value: string, unit?: string) => (unit ? `${value} ${unit}` : value);
const word = (card: Fact) => (card.type === "result" || card.type === "reading" ? card.flag && FLAG[card.flag] : card.type === "appointment" ? STATUS[card.status] : undefined);

/** A fact card as one sentence for a screen reader, e.g. "Potassium 3.1 mmol/L, Low, usual range 3.5 to 5.1 mmol/L. Lab result." */
function sentenceOf(card: Fact, app: App): string {
  const said = (parts: (string | false | undefined)[], source?: string) => `${join(parts, ", ")}.${source ? ` ${source}.` : ""}`;
  switch (card.type) {
    case "medicine": return said([card.name, card.dose, card.times?.length ? `at ${card.times.join(" and ")}` : undefined, card.how, card.note], card.source);
    case "result": return said([amount(`${card.test} ${card.value}`, card.unit), word(card), card.range && `usual range ${card.range}`, card.at && when(card.at, app)], card.source);
    case "reading": return said([amount(`${card.label} ${card.value}`, card.unit), word(card), card.at && when(card.at, app)]);
    case "appointment": return said([card.title, when(card.when, app), card.where, word(card)]);
    case "doctor": return said([card.name, card.specialty, card.careTeam && "your care team", `rated ${card.rating} of 5`, card.room]);
  }
}

/** A fact from the record in a small glass card: its tile, words and value, the flag or status as a word in its tone. Read aloud as `sentenceOf`. */
function FactCard({ card, app }: { card: Fact; app: App }) {
  const tone = toneOf(card);
  const flag = word(card);
  const lines: [title: string, detail?: string, meta?: string] =
    card.type === "medicine" ? [card.name, join([card.dose, card.times?.join(", ")]), join([card.how, card.note, card.source])]
      : card.type === "result" ? [card.test, card.range && `Usual ${card.range}`, join([card.at && when(card.at, app), card.source])]
      : card.type === "reading" ? [card.label, undefined, card.at && when(card.at, app)]
      : card.type === "appointment" ? [card.title, when(card.when, app), card.where]
      : [card.name, join([card.specialty, `★ ${card.rating}`, card.room])];
  const body = (
    <>
      {card.type === "doctor" ? <Avatar name={card.name} size="md" /> : <span className="ai-card-tile"><Icon name={TILE[card.type]} size={18} /></span>}
      <span className="ai-card-text">
        <span className="ai-card-title">{lines[0]}</span>
        {lines[1] ? <span className="ai-card-detail">{lines[1]}</span> : null}
        {lines[2] ? <span className="ai-card-meta">{lines[2]}</span> : null}
        {card.type === "doctor" && card.careTeam ? <span className="ai-card-team">Your care team</span> : null}
      </span>
      {card.type === "result" || card.type === "reading" || flag ? (
        <span className="ai-card-end">
          {card.type === "result" || card.type === "reading" ? <span className="ai-card-value">{card.value}{card.unit ? <small> {card.unit}</small> : null}</span> : null}
          {flag ? <Chip tone={CHIP[tone]}>{flag}</Chip> : null}
        </span>
      ) : null}
    </>
  );
  // A doctor opens Follow-ups, where she books them; the rest are facts to read.
  if (card.type === "doctor" && app === "care") return (
    <Anchor to="/care/follow-ups" className="ai-card ai-fact" data-type="doctor" aria-label={sentenceOf(card, app)}>
      <span className="ai-fact-shown">{body}<Icon name="chevron-right" size={18} className="ai-card-go" /></span>
    </Anchor>
  );
  return (
    <div className="ai-card ai-fact" data-type={card.type} data-tone={tone === "calm" ? undefined : CHIP[tone]}>
      <span className="visually-hidden">{sentenceOf(card, app)}</span>
      <span className="ai-fact-shown" aria-hidden="true">{body}</span>
    </div>
  );
}

/** The plan's warning signs or a must-not-miss line: the title in its tone (red, amber, or ink for info), then the list. */
function Warning({ card }: { card: Extract<AnswerCard, { type: "warning" }> }) {
  const id = useId(), tone = toneOf(card);
  return (
    <section className="ai-card ai-card-warning" data-tone={tone === "calm" ? undefined : CHIP[tone]} aria-labelledby={id}>
      <h4 id={id} className="ai-card-head"><Icon name={tone === "calm" ? "info" : "alert"} size={18} />{card.title}</h4>
      {card.items.length ? <ul className="ai-card-list">{card.items.map((item, i) => <li key={i}>{item}</li>)}</ul> : null}
    </section>
  );
}

function Steps({ card }: { card: Extract<AnswerCard, { type: "steps" }> }) {
  const id = useId();
  return (
    <section className="ai-card" aria-labelledby={id}>
      <h4 id={id} className="ai-card-head">{card.title}</h4>
      {/* role="list": Safari drops a list's meaning once its markers are styled away. */}
      <ol className="ai-card-steps" role="list">{card.items.map((item, i) => <li key={i}>{item}</li>)}</ol>
    </section>
  );
}

/**
 * Something Sona drafted, shown before anything is done (UX rule 4): what it is, what will happen, then one button.
 * Once done, the receipt (`done`) takes its place and focus, so it is read out. What `onConfirm` throws shows under the
 * button to try again. Without `onConfirm` the draft stays with its button off, and `off` says where it can be done.
 */
export function Review({ title, items, what, confirm, done, onConfirm, off }: { title: string; items?: string[]; what?: string; confirm: string; done: string; onConfirm?: () => Promise<unknown>; off?: string }) {
  const id = useId();
  const receipt = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<"draft" | "busy" | "done">("draft");
  const [error, setError] = useState<string>();
  useEffect(() => { if (state === "done") receipt.current?.focus(); }, [state]);
  if (state === "done") return <p ref={receipt} className="ai-review-done" role="status" tabIndex={-1}><Icon name="check" size={18} /><span>{done}</span></p>;
  const go = () => {
    setState("busy");
    setError(undefined);
    onConfirm!().then(() => setState("done"), (e: unknown) => {
      setError(e instanceof Error && e.message ? e.message : "That didn't go through. Try again.");
      setState("draft");
    });
  };
  return (
    <section className="ai-card ai-review" aria-labelledby={id}>
      <p className="ai-review-over">Review before confirming</p>
      <h4 id={id} className="ai-card-head">{title}</h4>
      {items?.length ? <ul className="ai-card-list">{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : null}
      {what ? <p className="ai-review-what">{what}</p> : null}
      {error ? <p className="ai-review-error" role="alert">{error}</p> : null}
      <div className="ai-review-act">
        <Button variant="primary" size="sm" pending={state === "busy"} disabled={!onConfirm} onClick={go}>{confirm}</Button>
        {onConfirm ? null : <p className="ai-review-off">{off ?? "This can't be done here."}</p>}
      </div>
    </section>
  );
}

/** An action card as a Review whose button makes its call, once per card (`requestId`); off in the app that cannot do it. */
function Action({ card, app, confirm }: { card: ActionCard; app: App; confirm?: ConfirmCard }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const mine = OWNER[card.do] === app;
  return <Review {...card} onConfirm={mine && confirm ? () => confirm(card, requestId) : undefined} off={mine ? undefined : ELSEWHERE[OWNER[card.do]]} />;
}

function cardOf(card: AnswerCard, app: App, confirm?: ConfirmCard): ReactNode {
  if (card.type === "warning") return <Warning card={card} />;
  if (card.type === "steps") return <Steps card={card} />;
  if (card.type === "action") return <Action card={card} app={app} confirm={confirm} />;
  return <FactCard card={card} app={app} />;
}

/**
 * An answer's cards (answer-parts `cardsOf`), in the server's order under the answer's words: facts from the record as
 * small glass cards, two abreast when the answer is wide enough (a container query, so the ~400 px Sona panel stacks
 * them); warnings, steps and the one drafted action across the full width. Colour comes only from a card's own tone.
 * Props only: `confirm` makes an action's call. Sona Care's urgent warning is its 999 card (features/care-ask/answer.tsx).
 */
export function AnswerCards({ cards, app, confirm }: { cards: AnswerCard[]; app: App; confirm?: ConfirmCard }) {
  if (!cards.length) return null;
  return (
    <div className="ai-cards">
      <ul className="ai-cards-list" role="list">
        {cards.map((card, i) => <li key={i} className="ai-cards-item" data-wide={card.type === "warning" || card.type === "steps" || card.type === "action" || undefined}>{cardOf(card, app, confirm)}</li>)}
      </ul>
    </div>
  );
}
