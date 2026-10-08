// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";
import { createORPCClient } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { QueryClient, type QueryKey } from "@tanstack/react-query";

import { startLive } from "./live";

// The sockets the page opened; the test plays the server's side.
class FakeSocket {
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  constructor() { sockets.push(this); }
  send() {}
  addEventListener() {}
  close() {}
}
const sockets: FakeSocket[] = [];
Object.assign(globalThis, { WebSocket: FakeSocket });
const orpc = createTanstackQueryUtils(createORPCClient<AppRouterClient>({ call: async () => null }));

test("an insurer's decision (a claim change) re-reads the open guarantee letter, not its model drafts or other pages", () => {
  const queryClient = new QueryClient();
  // Plain keys: the test stores stand-in data, not each procedure's output.
  const letter: QueryKey = orpc.claim.status.queryKey({ input: { encounterId: "e-1" } });
  const inbox: QueryKey = orpc.messages.inbox.queryKey();
  const codes: QueryKey = orpc.claim.suggestCodes.queryKey({ input: { encounterId: "e-1" } });
  queryClient.setQueryData(letter, { status: "sent" });
  queryClient.setQueryData(inbox, { threads: [] });
  queryClient.getQueryCache().build(queryClient, { queryKey: codes, staleTime: Infinity } as { queryKey: QueryKey });
  const stop = startLive(queryClient, "ws://localhost/live");
  sockets.at(-1)!.onopen!();
  sockets.at(-1)!.onmessage!({ data: "pong" });
  expect(queryClient.getQueryState(letter)?.isInvalidated).toBe(false);
  sockets.at(-1)!.onmessage!({ data: JSON.stringify({ topic: "claim", encounterId: "e-1" }) });
  expect(queryClient.getQueryState(letter)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(inbox)?.isInvalidated).toBe(false);
  expect(queryClient.getQueryState(codes)?.isInvalidated).toBe(false);
  stop();
});
