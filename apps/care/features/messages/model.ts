import type { AppRouterClient } from "@sona-ai/api/routers/index";

export type Message = Awaited<ReturnType<AppRouterClient["care"]["messages"]["list"]>>[number];

/** A reply waits when the care team spoke last and this phone has not shown that message yet. */
export function unreadReply(messages: Message[], lastReadId: string | undefined) {
  const last = messages.at(-1);
  return last?.from === "care-team" && last.id !== lastReadId;
}
