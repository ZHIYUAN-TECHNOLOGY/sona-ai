/** The server's message for a refusal, or a plain fallback. */
export function errorText(e: unknown) {
  const message = (e as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message ? message : "Something went wrong. Try again.";
}
