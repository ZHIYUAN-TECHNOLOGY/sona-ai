import { useSyncExternalStore } from "react";
import type { Answer } from "./answers";

/**
 * Today's conversation: each question asked on Today (typed, dictated, the ✦ suggestion, or in Sona Live) and what Sona
 * said back, oldest first. One thread for the day, kept for the app session like a visit's requests, so Live and the page
 * are one conversation: closing Live leaves it on Today. New conversation clears it; a new day starts a new one.
 */
/** What Sona said: an answer (a rule's, or a model's with its name), or a notice; `again` when asking again may work (the model was starting or out of reach). */
export type Reply = { answer: Answer; model?: string } | { notice: string; again?: boolean };
/** No reply yet: Sona is thinking. */
export type Entry = { id: number; question: string; reply?: Reply };
export type Thread = { day: string; entries: Entry[]; next: number };
export type ThreadStep =
  | { type: "ask"; question: string; day: string; reply?: Reply } // a rule answer (or demo mode's notice) lands with its question
  | { type: "reply"; id: number; reply?: Reply } // the model's answer or a notice; none: asking again
  | { type: "clear" }; // New conversation

export const EMPTY: Thread = { day: "", entries: [], next: 0 };

export function threadStep(t: Thread, e: ThreadStep): Thread {
  switch (e.type) {
    // Ids are never reused, so a reply that lands after New conversation can't fill a newer question.
    case "ask": return { day: e.day, entries: [...(t.day === e.day ? t.entries : []), { id: t.next, question: e.question, ...(e.reply && { reply: e.reply }) }], next: t.next + 1 };
    case "reply": return { ...t, entries: t.entries.map(x => (x.id === e.id ? { id: x.id, question: x.question, ...(e.reply && { reply: e.reply }) } : x)) };
    case "clear": return { ...t, entries: [] };
  }
}

/** The answer an entry holds, once Sona answered it (not thinking, not a notice). */
export const answerOf = (entry?: Entry) => (entry?.reply && "answer" in entry.reply ? entry.reply.answer : undefined);

let thread = EMPTY;
const listeners = new Set<() => void>();
const dispatch = (e: ThreadStep) => { thread = threadStep(thread, e); listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const today = () => new Date().toDateString();
const NONE: Entry[] = [];
/** Today's entries; an earlier day's thread reads as none (the dashboard shows), and the next question starts today's. */
export const useThread = () => { const t = useSyncExternalStore(subscribe, () => thread); return t.day === today() ? t.entries : NONE; };
/** Adds a question, with its reply when it has one already; returns its id for the reply to come. */
export const askThread = (question: string, reply?: Reply) => { const id = thread.next; dispatch({ type: "ask", question, day: today(), reply }); return id; };
export const replyTo = (id: number, reply?: Reply) => dispatch({ type: "reply", id, reply });
export const clearThread = () => dispatch({ type: "clear" });
