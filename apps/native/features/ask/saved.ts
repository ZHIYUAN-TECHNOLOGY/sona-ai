import { useSyncExternalStore } from "react";

/**
 * Saved views: Sona answers kept in the sidebar (at most 3), rebuilt from current data each time they
 * open, so they stay live. Only the day-wide answers can be saved; one page's answer (a discharge,
 * an X-ray) means something only on that page. Session-only, like Continue.
 */
export const SAVED_LIMIT = 3;
export const SAVABLE = new Set(["needs", "overdue", "soonest"]);
export type Saved = { id: string; question: string };

let saved: Saved[] = [];
const listeners = new Set<() => void>();
const set = (next: Saved[]) => { saved = next; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useSaved = () => useSyncExternalStore(subscribe, () => saved);
export const isSaved = (list: Saved[], id: string) => list.some(s => s.id === id);
/** Newest first, one per answer; saving a fourth drops the oldest. */
export const withSaved = (list: Saved[], view: Saved) => [view, ...list.filter(s => s.id !== view.id)].slice(0, SAVED_LIMIT);
export const saveView = (view: Saved) => set(withSaved(saved, view));
export const removeView = (id: string) => set(saved.filter(s => s.id !== id));
