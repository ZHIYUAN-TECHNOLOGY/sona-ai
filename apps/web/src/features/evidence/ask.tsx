import { type ReactNode, useMemo } from "react";

import { FilmCard } from "@/features/evidence/film-card";
import { type StreamEvent, type Turn, answerFilm, apply, newTurn } from "@/features/evidence/thread";
import { client } from "@/lib/orpc";
import { useSonaAsk } from "@/lib/sona";

type Thread = { question: string; answer: string }[];

/** One `evidence.stream` call, each event applied as it lands. The evidence page passes no visit but its thread; a patient's page the reverse. */
export async function askVisit(encounterId: string | undefined, question: string, onEvent: (event: StreamEvent) => void, thread: Thread = []) {
  for await (const raw of await client.evidence.stream({ encounterId, question, thread })) onEvent(raw as StreamEvent);
}

/** The answer as the page's Sona thread shows it: the bottom line, the claims, and the film when one leads the sources. */
export function answerNode(turn: Turn): ReactNode {
  const film = answerFilm(turn.references);
  const none = !turn.bottomLine && turn.claims.length === 0;
  return (
    <>
      {turn.bottomLine && <p>{turn.bottomLine}</p>}
      {turn.claims.length > 0 && <ul>{turn.claims.map((claim, i) => <li key={i}>{claim.text}</li>)}</ul>}
      {none && <p className="sona-turn-note">{turn.answer?.general ? `General knowledge, not from the sources: ${turn.answer.general}` : "The sources did not answer this question."}</p>}
      {film && <FilmCard reference={film} encounterId={film.encounterId!} />}
    </>
  );
}

/**
 * On a patient's page: the Sona bar's questions are answered for this visit, in place, the film under the question
 * when the answer is an X-ray. Without a visit, or a role that may not ask, the app's default answers.
 */
export function useVisitAsk(encounterId: string | undefined, allowed: boolean) {
  useSonaAsk(useMemo(() => {
    if (!encounterId || !allowed) return undefined;
    return async (question: string) => {
      let turn = newTurn(crypto.randomUUID(), question);
      try {
        await askVisit(encounterId, question, event => { turn = apply(turn, event); });
      } catch {
        throw new Error("Sona could not answer just now. Nothing was saved from this question.");
      }
      return answerNode(turn);
    };
  }, [encounterId, allowed]));
}
