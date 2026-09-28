import { translate, type Lang } from "@/lib/i18n";
import "@/lib/strings";

/** The server's message for a refusal (shown as the server wrote it), or a plain fallback in the patient's language. */
export function errorText(e: unknown, lang: Lang = "en") {
  const message = (e as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message ? message : translate(lang, "common.error");
}
