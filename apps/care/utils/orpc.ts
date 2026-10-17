import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { focusManager, QueryCache, QueryClient } from "@tanstack/react-query";
import { fetch as nativeFetch } from "expo/fetch";
import { AppState, Platform } from "react-native";

import { authClient } from "@/lib/auth-client";

import { ENV } from "../src/env";

// React Query knows the browser's tab focus, not the app's: tell it when the app is in front, so polling
// (refetchInterval) and refetches pause in the background and resume when the app comes back.
focusManager.setEventListener(setFocused => {
  const sub = AppState.addEventListener("change", s => setFocused(s === "active"));
  return () => sub.remove();
});

export const queryClient = new QueryClient({
  // Fresh for 30 s, so coming back to the app or opening a screen re-reads only what is older; a live change
  // re-reads what it touches at once (features/live).
  defaultOptions: { queries: { staleTime: 30_000 } },
  queryCache: new QueryCache({
    onError: (error) => {
      console.log(error);
    },
  }),
});

// A static import: a dynamic `import("expo/fetch")` never resolves in a minified production bundle.
async function expoFetch(request: Request, init?: RequestInit) {
  return nativeFetch(request.url, {
    body: await request.blob(),
    headers: request.headers,
    method: request.method,
    signal: request.signal,
    ...init,
  });
}

export const link = new RPCLink({
  url: `${ENV.EXPO_PUBLIC_SERVER_URL}/rpc`,
  fetch(request, init) {
    return expoFetch(request, {
      ...init,
      // Better Auth Expo forwards the session cookie manually on native.
      credentials: Platform.OS === "web" ? "include" : "omit",
    });
  },
  async headers() {
    if (Platform.OS === "web") {
      return {};
    }
    const headers = new Map<string, string>();
    const cookies = await authClient.getCookie();
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    return Object.fromEntries(headers);
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
