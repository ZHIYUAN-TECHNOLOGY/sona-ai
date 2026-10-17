import { useSyncExternalStore } from "react";
import type { Owner } from "./model";

/**
 * Blocker owners and their receipts, held for the session so leaving the Ward and coming back keeps
 * them. Demo and live keep separate books, so switching modes never mixes the server's owners into the demo.
 */
type Book = { owners: Record<string, Owner | undefined>; told: Record<string, string | undefined> };
const books: Record<"demo" | "live", Book> = { demo: { owners: {}, told: {} }, live: { owners: {}, told: {} } };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useWardOwners(live: boolean) {
  const mode = live ? "live" : "demo";
  const book = useSyncExternalStore(subscribe, () => books[mode]);
  const set = (change: (book: Book) => Partial<Book>) => { books[mode] = { ...books[mode], ...change(books[mode]) }; listeners.forEach(l => l()); };
  return {
    ...book,
    setOwners: (update: (owners: Book["owners"]) => Book["owners"]) => set(b => ({ owners: update(b.owners) })),
    setTold: (id: string, line: string | undefined) => set(b => ({ told: { ...b.told, [id]: line } })),
  };
}
