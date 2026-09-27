import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

/**
 * Questions the patient saves for their next visit (from Ask Sona Care or the visit card), kept on
 * this phone and read through useSyncExternalStore so React Compiler never caches a stale module read.
 * ponytail: phone-only; a server copy lets the clinic see them before the visit later.
 */
const KEY = "sona-care.questions";
let saved: string[] = [];
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const emit = () => { listeners.forEach(l => l()); SecureStore.setItemAsync(KEY, JSON.stringify(saved)).catch(() => {}); };
SecureStore.getItemAsync(KEY).then(v => { if (v) { saved = [...new Set([...JSON.parse(v) as string[], ...saved])]; listeners.forEach(l => l()); } }).catch(() => {});

export function saveQuestion(text: string) {
  const q = text.trim();
  if (!q || saved.includes(q)) return;
  saved = [...saved, q].slice(-12);
  emit();
}

export function removeQuestion(text: string) {
  saved = saved.filter(q => q !== text);
  emit();
}

export const useQuestions = () => useSyncExternalStore(subscribe, () => saved);
