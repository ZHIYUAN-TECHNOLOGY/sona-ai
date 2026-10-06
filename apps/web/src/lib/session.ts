import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/lib/orpc";

/** Sign out, forget everything read as that person, and land on that app's sign-in. */
export async function signOut(app: "pro" | "care") {
  await authClient.signOut();
  queryClient.clear();
  // A full page load, so nothing of the last session survives in memory.
  window.location.assign(`/${app}/sign-in`);
}
