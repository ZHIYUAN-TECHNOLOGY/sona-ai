/**
 * Laya in json-render's own composer. The composer does not ask "which card?": it asks a root question
 * (column or unavailable), one use/omit question per candidate, then a position per chosen element.
 * So the training data is made by running the real `experimental_composeSpec` with an answer key and
 * recording every question it asks, and the score is whether the composed screen is the right one.
 *
 * bun compose.ts data                        kept.jsonl -> train-compose.jsonl (Laya typed-decisions rows)
 * bun compose.ts baseline                    baseline.jsonl -> baseline-compose.jsonl (answer-key questions, for the Kaggle notebook)
 * bun compose.ts score http://127.0.0.1:8000 composes the 50 baseline requests with Laya (serve.py) and checks each screen
 */
import { experimental_composeSpec, type Experimental_CompositionEvaluator as Evaluator } from "@json-render/core";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

import { CARDS as TRAINED_CARDS, layaEvaluator } from "../../packages/api/src/laya";

const CARDS: Record<string, string> = TRAINED_CARDS;

const here = (file: string) => new URL(`./${file}`, import.meta.url);
const lines = (file: string) => readFileSync(here(file), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));

const COLUMN = "Vertical clinical response";
const NOTICE = "Notice listing what the patient's record does not document yet";
const SOURCE = "Open the source record behind the answer";

// Same regex approach as check.py: the demo patients' visit label and whether their history is incomplete.
const demo = readFileSync(new URL("../../packages/domain/src/demo-patients.ts", import.meta.url), "utf8");
const PATIENTS = Object.fromEntries([...demo.matchAll(/id: "(SYN-\d+)".*?subtitle: "([^"]+)".*?incomplete: (true|false)/g)].map(m => [m[1], { label: m[2]!, incomplete: m[3] === "true" }]));

const component = (card: string) => `Clinical${card[0]!.toUpperCase()}${card.slice(1)}`;
const TYPE_TO_ID: Record<string, string> = { ResponseColumn: "column", ContextNotice: "notice", SourceAction: "source", ...Object.fromEntries(Object.keys(CARDS).map(card => [component(card), card])) };

const ref = z.object({ resultId: z.string() }).strict();
const catalog = {
  data: { components: {
    ResponseColumn: { props: z.object({}).strict(), slots: ["default"] },
    ...Object.fromEntries(Object.keys(CARDS).map(card => [component(card), { props: ref }])),
    ContextNotice: { props: z.object({ noticeId: z.string() }).strict() },
    SourceAction: { props: z.object({ sourceId: z.string() }).strict() },
  } },
  // The app's own validateClinicalSpec checks identity and sources; here only the composer's structural checks run.
  validate: () => ({ success: true }),
};

type Case = { request: string; patient: string; capability: string };

function candidates(offered: string[]) {
  const leaf = (id: string, type: string, description: string, props: Record<string, unknown>) => ({ id, description, root: false, element: { type, props } });
  return [
    { id: "column", description: COLUMN, element: { type: "ResponseColumn", props: {} } },
    ...offered.map(card => leaf(card, component(card), CARDS[card]!, { resultId: card })),
    leaf("notice", "ContextNotice", NOTICE, { noticeId: "missing-context" }),
    leaf("source", "SourceAction", SOURCE, { sourceId: "record" }),
  ];
}

/** The right screen, as ordered candidate IDs; null means "unavailable". Insight first, but missing context leads when the history is incomplete. */
function expected(c: Case, offered: string[]): string[] | null {
  if (c.capability === "not-covered" || !offered.includes(c.capability)) return null;
  return PATIENTS[c.patient]!.incomplete ? ["notice", c.capability, "source"] : [c.capability, "source"];
}

type Recorded = { state: Record<string, unknown>; questions: Record<string, { criteria: Record<string, string> }>; answers: Record<string, { choice: string }> };

function answerKey(want: string[] | null, record: Recorded[]): Evaluator {
  return async ({ state, questions }) => {
    const nodes = Object.fromEntries(((state.selected_elements ?? []) as { id: string; type: string }[]).map(e => [e.id, TYPE_TO_ID[e.type]!]));
    const answers: Recorded["answers"] = {};
    for (const [id, question] of Object.entries(questions)) {
      const keys = Object.keys(question.criteria);
      const choice = id === "root" ? (want ? "column" : "unavailable")
        : id.startsWith("select_") ? keys.find(k => k.startsWith("use:") && want?.includes(k.slice(4))) ?? "omit"
        : id.startsWith("order_") ? String(want!.indexOf(nodes[id.slice(6)]!) + 1)
        : undefined;
      if (!choice || !keys.includes(choice)) throw new Error(`answer key has no offered choice for ${id}`);
      answers[id] = { choice };
    }
    record.push({ state, questions, answers });
    return { answers };
  };
}

async function compose(c: Case, offered: string[], evaluate: Evaluator): Promise<string[] | null> {
  let screen: string[] | null = null;
  for await (const event of experimental_composeSpec({
    catalog: catalog as never, candidates: candidates(offered), prompt: c.request, evaluate,
    context: { patient: PATIENTS[c.patient]!.label }, maxSteps: 4, maxElements: 5,
  })) {
    if (event.type !== "complete") continue;
    const spec = event.spec;
    screen = event.stopReason === "unavailable" || !spec ? null : (spec.elements[spec.root]?.children ?? []).map(id => TYPE_TO_ID[spec.elements[id]!.type]!);
  }
  return screen;
}

// Seeded, so the same kept.jsonl always gives the same offers and samples.
let seed = 20260929;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const shuffle = <T>(xs: T[]) => xs.map(x => [random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

/** The server offers only relevant cards: drop up to three others, and 15% of the time the right one (the screen becomes "unavailable"). */
function offerFor(c: Case) {
  let offered = shuffle(Object.keys(CARDS));
  const others = offered.filter(card => card !== c.capability);
  const dropped = new Set(others.slice(0, Math.floor(random() * 4)));
  if (c.capability !== "not-covered" && random() < 0.15) dropped.add(c.capability);
  return offered.filter(card => !dropped.has(card));
}

const oneHot = (choice: string, keys: string[]) => ({ type: "choice", label: choice, probabilities: Object.fromEntries(keys.map(k => [k, Number(k === choice)])) });

const [mode, url] = process.argv.slice(2);

if (mode === "data") {
  const out: string[] = [];
  let items = 0;
  for (const [i, c] of (lines("kept.jsonl") as Case[]).entries()) {
    const offered = offerFor(c), want = expected(c, offered), record: Recorded[] = [];
    const screen = await compose(c, offered, answerKey(want, record));
    if (JSON.stringify(screen) !== JSON.stringify(want)) throw new Error(`answer key composed ${JSON.stringify(screen)}, wanted ${JSON.stringify(want)}`);
    for (const [j, r] of record.entries()) {
      // Every question is kept, "omit" answers included: v3 kept only a third of them and learned to add extra cards.
      const ids = Object.keys(r.questions);
      const questions = Object.fromEntries(ids.map(id => [id, r.questions[id]]));
      const gold = Object.fromEntries(ids.map(id => [id, oneHot(r.answers[id]!.choice, Object.keys(r.questions[id]!.criteria))]));
      items += ids.length;
      out.push(JSON.stringify({ id: `sona_compose_${i}_${j}`, workflow: "sona_compose", split: "train", state: JSON.stringify(r.state), questions: JSON.stringify(questions), gold: JSON.stringify(gold) }));
    }
  }
  writeFileSync(here("train-compose.jsonl"), out.join("\n") + "\n");
  console.log(`train-compose.jsonl: ${out.length} rows, ${items} questions`);
} else if (mode === "baseline") {
  const out: string[] = [];
  for (const c of lines("baseline.jsonl") as (Case & { id: string })[]) {
    const all = Object.keys(CARDS), record: Recorded[] = [];
    await compose(c, all, answerKey(expected(c, all), record));
    record.forEach((r, j) => out.push(JSON.stringify({ id: `${c.id}_${j}`, state: r.state, questions: r.questions, gold: Object.fromEntries(Object.entries(r.answers).map(([id, a]) => [id, a.choice])) })));
  }
  writeFileSync(here("baseline_requests.jsonl"), out.join("\n") + "\n");
  console.log(`baseline_requests.jsonl: ${out.length} composer evaluations`);
} else if (mode === "score" && url) {
  const evaluate = layaEvaluator({ url });
  let right = 0, rightCard = 0;
  const times: number[] = [], misses: string[] = [];
  const cases = lines("baseline.jsonl") as (Case & { id: string })[];
  for (const c of cases) {
    const all = Object.keys(CARDS), want = expected(c, all);
    const start = performance.now();
    const screen = await compose(c, all, evaluate);
    times.push(performance.now() - start);
    const card = (s: string[] | null) => s?.filter(id => id !== "notice" && id !== "source").join("+") ?? "unavailable";
    if (JSON.stringify(screen) === JSON.stringify(want)) right++;
    else misses.push(`${c.id}: got ${JSON.stringify(screen)}, want ${JSON.stringify(want)} | ${c.request}`);
    if (card(screen) === card(want)) rightCard++;
  }
  times.sort((a, b) => a - b);
  console.log(`right screen: ${right}/${cases.length} = ${Math.round(100 * right / cases.length)}%`);
  console.log(`right card (ignoring notice/source/order): ${rightCard}/${cases.length} = ${Math.round(100 * rightCard / cases.length)}%`);
  console.log(`time per screen: median ${Math.round(times[times.length >> 1]!)} ms, max ${Math.round(times.at(-1)!)} ms`);
  console.log(misses.length ? ["misses:", ...misses].join("\n") : "no misses");
} else {
  console.error("usage: bun compose.ts data | baseline | score <laya-url>");
  process.exit(1);
}
