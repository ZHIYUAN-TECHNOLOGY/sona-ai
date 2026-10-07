import type { CSSProperties } from "react";

import { Icon } from "./icon";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// The first whole character of a word when it is a letter: "🦊" or "(" give nothing, "Ó" stays one character.
const lead = (word: string) => {
  const first = graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? "";
  return /^\p{L}/u.test(first) ? first.toLocaleUpperCase() : "";
};

/** First and last name's first letters ("Dr", "Jr", "III" skipped); "" when the name has no letters (show an icon). */
export const initials = (name: string) => {
  const words = name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").replace(/[\s,]+(jr|sr|ii|iii|iv)\.?$/i, "").trim().split(/\s+/).map(lead).filter(Boolean);
  return (words[0] ?? "") + (words.length > 1 ? words.at(-1)! : "");
};
/** A hue that stays the same for the same name. */
export const hueOf = (name: string) => [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);

/** Letter avatar: initials on a soft tint derived from the name, a person icon when there are none. Never a photo. Styles: `.avatar` in components.css. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const letters = initials(name);
  return (
    <span className="avatar" data-size={size} style={{ "--avatar-hue": hueOf(name) } as CSSProperties} aria-hidden="true">
      {letters || <Icon name="user" size={size === "lg" ? 22 : size === "sm" ? 14 : 18} />}
    </span>
  );
}
