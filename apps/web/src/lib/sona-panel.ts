import type { NavGroup } from "@/nav";

/** The Sona panel as the reader left it: docked open (the default), closed to the orb, or full screen. */
export type PanelState = "open" | "closed" | "expanded";
export const PANEL_KEY = "sona.panel";

/** A stored panel state, or "open" for anything else (nothing stored, an old or garbled value). */
export const parsePanel = (raw: string | null | undefined): PanelState => (raw === "closed" || raw === "expanded" ? raw : "open");

/** Pages that are a chat themselves: there the page's own composer asks, and the panel and orb stay away. */
export const OWN_CHAT = new Set(["/pro/evidence", "/care/ask"]);

/**
 * What the panel's header says the page is about: the label a page registered (`useSonaContext`, e.g. "X-ray · Amelia Tan"),
 * else the sidebar item the path sits under (the longest match), else `fallback`.
 */
export function contextLabel(registered: string | undefined, groups: NavGroup[], path: string, fallback: string): string {
  if (registered?.trim()) return registered.trim();
  let best: { to: string; label: string } | undefined;
  for (const item of groups.flatMap(group => group.items))
    if ((path === item.to || path.startsWith(`${item.to}/`)) && item.to.length > (best?.to.length ?? -1)) best = item;
  return best?.label ?? fallback;
}
