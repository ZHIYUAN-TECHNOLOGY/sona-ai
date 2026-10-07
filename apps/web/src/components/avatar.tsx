import type { CSSProperties } from "react";

// The first character as the reader sees it (an emoji or an accented letter stays whole, never half a surrogate pair).
const segmenter = new Intl.Segmenter();
const firstOf = (word?: string) => (word ? segmenter.segment(word)[Symbol.iterator]().next().value?.segment : undefined);
const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
export const initials = (name: string) => {
  // Titles in front and suffixes behind ("… Montgomery III") are not part of the name's initials.
  const words = name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && SUFFIX.test(words[words.length - 1]!)) words.pop();
  return ((firstOf(words[0]) ?? "?") + (words.length > 1 ? firstOf(words[words.length - 1]) ?? "" : "")).toUpperCase();
};
/** A hue that stays the same for the same name. */
export const hueOf = (name: string) => [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);

/** Letter avatar: initials on a soft tint derived from the name. Never a photo. Styles: `.avatar` in components.css. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return <span className="avatar" data-size={size} style={{ "--avatar-hue": hueOf(name) } as CSSProperties} aria-hidden="true" dir="auto">{initials(name)}</span>;
}
