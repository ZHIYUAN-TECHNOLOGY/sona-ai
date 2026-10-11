import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { basetenModels } from "@sona-ai/api/baseten-models";
import { chatTurn, sonaMed } from "@sona-ai/api/chat-agent/turn";
import { clockOffsetOf, shifted } from "@sona-ai/api/clock";
import { clefOf } from "@sona-ai/api/decide";
import { stubModels } from "@sona-ai/api/models";
import { hosted } from "@sona-ai/api/sagemaker";
import { getAgentByName } from "agents";
import type { Context as HonoContext } from "hono";

import { announcer, followUpAgents, libraryOf } from "../context";
import { getDb } from "../services";
import { nameOf, patientLink, patientOf } from "./patient";

/**
 * Ask Sona Care with conversation memory (docs/chat-agent.md), on the Agents SDK's AIChatAgent: one Durable Object per
 * patient, named by the Worker from the signed-in session (chatRoute), never by the app. The SDK keeps every message in
 * the object's own SQLite and streams each answer to every open app of hers; each turn sends the recent conversation to
 * Sona Med with tools over the app's own server code (packages/api/src/chat-agent/turn.ts). Apps reach it only behind
 * their flag (EXPO_PUBLIC_CARE_CHAT_AGENT, VITE_CARE_CHAT_AGENT); off, they ask care.ask as before.
 * Founder decision, 9 Oct: the conversation may be stored outside Malaysia at this stage (Durable Object storage);
 * before real patients it moves to Malaysia (docs/chat-agent.md, Phase 2).
 * Typed on Cloudflare.Env, not Env, as WatchAgent is: Env (alchemy.run.ts) names this class, a type cycle otherwise.
 */
export class SonaChatAgent extends AIChatAgent<Cloudflare.Env> {
  readonly #baseten = hosted(this.env);
  readonly #med = this.#baseten && sonaMed(this.#baseten);

  // The apps speak the chat protocol only: no state-sync or identity frames (which would name the instance).
  shouldSendProtocolMessages() {
    return false;
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const { hospitalId, patientId } = patientOf(this.name);
    const db = getDb(), env = this.env as Env;
    // As a route's context, for her alone: the hospital's demo clock, live updates, and the visit's check-in agent.
    const context = {
      db, session: null, models: this.#baseten ? basetenModels(this.#baseten) : stubModels, now: shifted(undefined, await clockOffsetOf(db, hospitalId)),
      announce: announcer(env), followUps: followUpAgents(env), hospitalId, patientId, clef: clefOf(env),
    };
    return chatTurn({ context, messages: this.messages, med: this.#med, library: libraryOf(db, env), signal: options?.abortSignal });
  }
}

/**
 * GET /agents/sona-chat-agent/:id, the SDK's own route shape (a WebSocket, or …/get-messages for the stored conversation),
 * where `:id` is the signed-in account's user id: it reaches that account's patient's chat agent and no other (patientLink).
 */
export async function chatRoute(c: HonoContext) {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket" && !c.req.path.endsWith("/get-messages")) return c.text("Expected a WebSocket", 426);
  const link = await patientLink(c);
  if (link instanceof Response) return link;
  return (await getAgentByName((c.env as Env).CHAT, nameOf(link))).fetch(c.req.raw);
}
