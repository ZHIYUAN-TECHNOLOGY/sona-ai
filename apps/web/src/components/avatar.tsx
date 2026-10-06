import type { CSSProperties } from "react";

export const initials = (name: string) => {
  const words = name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1]![0] : "")).toUpperCase();
};
/** A hue that stays the same for the same name. */
export const hueOf = (name: string) => [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);

/** Letter avatar: initials on a soft tint derived from the name. Never a photo. Styles: `.avatar` in components.css. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return <span className="avatar" data-size={size} style={{ "--avatar-hue": hueOf(name) } as CSSProperties} aria-hidden="true">{initials(name)}</span>;
}
