# Ask Sona Care with conversation memory (chat agent)

Built 9 Oct 2026, Phase 1. **Off by default**: without the app flags below, Sona Care and the web portal ask `care.ask` exactly as before, and nothing calls the agent.

## What is built

Today `care.ask` answers each typed question on its own and forgets it. The chat agent keeps the conversation, so "and the second one?" works, and it survives closing the app.

- **Agent**: `SonaChatAgent` (`apps/server/src/agents/chat.ts`), Cloudflare's `AIChatAgent` (`@cloudflare/ai-chat` 0.12.0, the last release that runs on our `agents` 0.24.0; `agents/ai-chat-agent` now only throws "moved to @cloudflare/ai-chat"). One Durable Object per patient, named `<hospital>/<patient>` from the signed-in session, the same name as her voice agent (`apps/server/src/agents/patient.ts`). The SDK stores every message in the object's SQLite and streams each answer to every open app of hers.
- **Route and auth**: `GET /agents/sona-chat-agent/<user id>` (WebSocket) and `…/get-messages` (her stored conversation). `patientLink` (shared with the voice route) refuses: no session (401), a path naming another account (403), an account with no care link, so clinicians too (403). The agent is never named from the path.
- **Each turn** (`packages/api/src/chat-agent/turn.ts`): the last 20 questions with their answers (and at most 24,000 characters) go to Sona Med, Gemma 4 26B on the brain box, streamed, through the same adapter as every other model call (`boxes().send`, so `SAGEMAKER_ENDPOINTS` moves it to SageMaker in Malaysia). It is an AI SDK provider (`@ai-sdk/openai-compatible` 3.0.66) over that fetch. Earlier turns' tool calls are pruned (a record read is about 2,000 tokens). A question left unanswered joins the next one, because the chat template wants the roles to alternate.
- **Tools**: each one runs the app's own server code, scoped to her: `readMyRecord` (`recordText`), `searchLeaflets` (`leafletHits`), `findDoctors` (`doctorsFor`), `requestBooking` (`requestBooking`, the same request and care-team task as the app's booking), and `tellCareTeam` (`tellCareTeam`). `doctorsFor` and `requestBooking` were moved out of the `care.doctors.list` and `care.bookings.request` handlers, unchanged, so both paths share them.
- **Prompt**: answer anything, fully (founder, 9 Oct: no guardrails). It keeps three things. First, an emergency sign she has now gets 999 first and `tellCareTeam`. The keyword floor (`callNow`) also tells the care team even with no model, and both share one task. Second, honest labels. Third, the language of her latest message.
- **Labels** (the answer's metadata, `ChatMeta` in `packages/api/src/chat-agent/client.ts`): "From your record" when the record was read for that answer. A leaflet only when the answer cites its number, and only if that leaflet was offered that turn. Otherwise "General answer". The care team's task and line, and the doctors found, are labelled the same way. `asAnswer` turns an answer into `care.ask`'s shape, so each app keeps its UI: bubbles, captions, the 999 card, "Ask my care team" and doctor cards.
- **No model, or a cold box**: Sona says she cannot answer now, or "starting, about N min". The app then shows its usual fallback, which is the plan's own answer to a suggested question, or "Send it to your care team?".
- **Not carried over from `care.ask`**: the withholding of sentences that state a fact her record lacks (`domain/grounding`), and the Malay or English re-ask. This follows the founder's 9 Oct decision. The prompt still says facts about her come from her record.

## Turning it on

The server side deploys with the Worker. Alchemy adds the `CHAT` binding's migration as a new SQLite class. Nothing reaches the agent until an app is built with its flag.

- **Sona Care (iPhone)**: build or start Metro with `EXPO_PUBLIC_CARE_CHAT_AGENT=1`, for example `EXPO_PUBLIC_CARE_CHAT_AGENT=1 bun run dev:staging` in `apps/care`, or set it for an EAS build or update. Ask then opens with her stored conversation. Questions go to the agent, and "+" (New chat) clears its memory. Until the agent has connected, a question still goes to `care.ask`. The chat SDK's modules are required only when the flag is on (`app/assistant.tsx`).
- **Web `/care/ask`**: build with `VITE_CARE_CHAT_AGENT=1` (the deploy script runs `vite build`). Without the flag, the chat code is left out of the bundle.

### Try it on staging (not done yet)

1. Deploy `main` with this branch merged, as usual (`bun run deploy` from the root; the brain box must be up: `aws sagemaker list-endpoints`).
2. In `apps/care`: `EXPO_PUBLIC_CARE_CHAT_AGENT=1 bun run dev:staging`, on a fresh simulator (not the shared "Sona demo" ones), signed in as the demo patient.
3. Ask "What medicines do I take?", then "When do I take the second one?". The second answer should use the first. Close and reopen Ask: the conversation is still there.
4. Ask "Find me a lung doctor", then "Book the first time with Dr. Lim". You should see the request on her Schedule, and a booking task on the care team's My Day.
5. Type "I have chest pain now". You should see the 999 card, then "I've let your care team know.", and one flagged task.
6. Web: `VITE_CARE_CHAT_AGENT=1 bun run --cwd apps/web build`, deploy, open `/care/ask` and repeat step 3.

## Verified (9 Oct, in this branch)

- `packages/api/src/chat-agent/turn.test.ts` runs a real turn against a scripted brain box behind the adapter, on a seeded database. It checks that each model step gets the tools, the instructions in her language and the whole conversation. It checks that `readMyRecord` and `searchLeaflets` run the app's code, with labels and citations from what they returned. It checks that `findDoctors` then `requestBooking` creates one request, one care-team task and the "bookings" announcement. It checks that an emergency with no model still tells the care team, and that the model's own call shares that task. It also covers the cold-box line, trimming to 20 turns or 24,000 characters, and role alternation.
- `apps/server/src/agents/chat.test.ts` runs the real route through Hono, checking her own agent, the 401 and 403 refusals, and `get-messages` behind the same check.
- `packages/api/src/chat-agent/client.test.ts` and `apps/care/features/assistant/agent-replies.test.js` check that questions asked together each get their own answer, and that answers map to the existing replies.
- Typecheck passes for the API, server, Sona Care and web. The Worker builds and bundles at about 1.9 MB gzipped. Sona Care bundles for iOS with the flag on and off. The web build has no chat chunk with the flag off.
- **Not run against a live box or a device.** The SageMaker endpoints were off and the brief excluded touching them. Gemma's tool calling through vLLM's `gemma4` parser (both box configs enable it) and React Native's runtime for the SDK's client have still to be seen working. Expo's runtime gives streams; `crypto` comes from expo-crypto, filled in by `features/assistant/chat-agent.tsx`.

## Phase 2

- **Long-term memory (Session API)**: `@cloudflare/ai-chat` 0.12 already stores messages through `agents/sessions`. Upgrade `agents` (0.25 or later, with ai-chat 0.12.1 or later) for the Session API's context memory and compaction. `recentTurns` (`turn.ts`) is the hook: older turns are dropped there today, and would be summarised there instead.
- **One memory for chat and the live call**: both agents are named by the same patient (`patient.ts`). The voice agent (`agents/voice.ts`) keeps its own `withVoice` history. Phase 2 has it read and append to the chat agent's session over RPC (`getAgentByName(env.CHAT, nameOf(link))`), so a call can continue a chat and the other way round.
- **Storage in Malaysia before real patients**: Durable Object storage can be hinted to APAC but not pinned to Malaysia. Founder, 9 Oct: acceptable at this stage. Before real patients, the conversation moves to storage in Malaysia (`ap-southeast-5`, beside the PII box), with the Durable Object keeping only the socket and the stream. One way is a Session provider over that store.
- **Not yet**: streamed words on screen (the app shows the answer once it has finished; the server already streams), a delete-my-conversation control outside New chat, and history on the web panel.
