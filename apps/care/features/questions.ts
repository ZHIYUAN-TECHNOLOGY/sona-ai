import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import "@/features/follow-ups/strings";
import { currentLang, translate } from "@/lib/i18n";
import { client, orpc, queryClient } from "@/utils/orpc";

/**
 * Questions the patient saves for their next visit (from Ask Sona Care or the visit card). Each is kept
 * on this phone and also sent to the care team as a message (care.messages.send), so the clinic sees it
 * before the visit. One not delivered yet (offline) is sent again by `sendQuestions`, on the next save,
 * when the app returns to the foreground or the live socket reconnects. Read through
 * useSyncExternalStore so React Compiler never caches a stale module read.
 */
const KEY = "sona-care.questions", SENT_KEY = "sona-care.questions.sent";
let saved: string[] = [], sent: string[] = [];
const sending = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const notify = () => listeners.forEach(l => l());
const keep = () => {
  notify();
  SecureStore.setItemAsync(KEY, JSON.stringify(saved)).catch(() => {});
  SecureStore.setItemAsync(SENT_KEY, JSON.stringify(sent)).catch(() => {});
};
const load = (key: string) => SecureStore.getItemAsync(key).then(v => (v ? JSON.parse(v) as string[] : [])).catch(() => [] as string[]);
const ready = Promise.all([load(KEY), load(SENT_KEY)]).then(([s, d]) => {
  saved = [...new Set([...s, ...saved])];
  sent = [...new Set([...d, ...sent])];
  notify();
});

/** The same question always carries the same request ID, so a retry never reaches the care team twice. */
const requestIdOf = (q: string) => {
  let h = 5381;
  for (let i = 0; i < q.length; i++) h = (h * 33) ^ q.charCodeAt(i);
  return `question-${(h >>> 0).toString(36)}-${q.length}`;
};

async function deliver(q: string) {
  if (sending.has(q) || sent.includes(q)) return;
  sending.add(q);
  try {
    await client.care.messages.send({ text: translate(currentLang(), "fu.qMessage", { q }), requestId: requestIdOf(q) });
    sent = [...sent, q].slice(-24);
    keep();
    void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() });
  } catch { /* stays on the phone; sent again on the next try */ } finally { sending.delete(q); }
}

/** Sends every saved question the care team does not have yet. */
export async function sendQuestions() {
  await ready;
  await Promise.all(saved.filter(q => !sent.includes(q)).map(deliver));
}

export function saveQuestion(text: string) {
  const q = text.trim();
  if (!q || saved.includes(q)) return;
  saved = [...saved, q].slice(-12);
  keep();
  void sendQuestions();
}

export function removeQuestion(text: string) {
  saved = saved.filter(q => q !== text);
  keep();
}

export const useQuestions = () => useSyncExternalStore(subscribe, () => saved);
/** The saved questions already delivered to the care team. */
export const useSentQuestions = () => useSyncExternalStore(subscribe, () => sent);
