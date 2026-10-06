import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { QueryClient } from "@tanstack/react-query";

// Fresh for 30 s, like the phone apps; a live change re-reads what it touches at once.
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });

// Same origin as the Worker, so the better-auth session cookie rides along.
const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
