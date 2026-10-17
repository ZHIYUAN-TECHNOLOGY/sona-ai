import * as SecureStore from "expo-secure-store";
import { client } from "@/utils/orpc";

/**
 * Doses taken (the dose key: medicine and due time), kept on this phone so hold to take is instant
 * offline, and sent to the server (care.doses) so the care team sees adherence; the server's list is
 * merged back on join and after each live change. Read through useSyncExternalStore so React
 * Compiler never caches a stale module read.
 */
// The server is the record; the phone adds only doses taken here that the server has not confirmed yet
// (`pending`, e.g. offline). A dose the server has forgotten (a demo reset) is never sent back.
const KEY = "sona-care.doses.taken", PENDING = "sona-care.doses.pending";
let taken: string[] = [], pending: string[] = [];
export const listeners = new Set<() => void>();
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const load = (k: string) => SecureStore.getItemAsync(k).then(v => (v ? JSON.parse(v) as string[] : [])).catch(() => [] as string[]);
void Promise.all([load(KEY), load(PENDING)]).then(([t, p]) => { taken = [...new Set([...t, ...taken])]; pending = [...new Set([...p, ...pending])]; listeners.forEach(l => l()); });

function keep(next: string[], nextPending = pending) {
  taken = next.slice(-80); pending = nextPending.slice(-80);
  listeners.forEach(l => l());
  SecureStore.setItemAsync(KEY, JSON.stringify(taken)).catch(() => {});
  SecureStore.setItemAsync(PENDING, JSON.stringify(pending)).catch(() => {});
}
const confirmed = (key: string) => { if (pending.includes(key)) keep(taken, pending.filter(k => k !== key)); };

export function markTaken(key: string) {
  if (taken.includes(key)) return;
  keep([...taken, key], [...pending, key]);
  // Offline, it stays pending on the phone; syncTaken sends it when the app returns to the foreground or the live socket opens (features/live).
  void client.care.doses.take({ key }).then(() => confirmed(key), () => {});
}

/** Forgets this phone's taken doses (the account is not linked to a record, e.g. after the demo reset). */
export function clearTaken() { if (taken.length || pending.length) keep([], []); }

/** Sends what is still pending, then takes the server's record plus anything still unconfirmed. */
export async function syncTaken() {
  for (const key of pending) await client.care.doses.take({ key }).then(() => confirmed(key), () => {});
  const server = await client.care.doses.list();
  keep([...new Set([...server, ...pending])]);
}

/** This phone's taken doses (read through useSyncExternalStore). */
export const takenNow = () => taken;
