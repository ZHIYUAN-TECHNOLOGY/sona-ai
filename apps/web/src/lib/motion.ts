import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP);
// A chart with no marks yet (still loading) is not a mistake.
gsap.config({ nullTargetWarn: false });

export { gsap, useGSAP };

/** Entrances ease out, as in the phone apps (components/sona/motion.ts). */
export const EASE_OUT = "power3.out";

/** False under Reduce Motion: skip the entrance and show the end state. */
export const moves = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Plays `targets` (a selector inside `scope`) in from `from`, once per `key`: a short stagger, ease out. */
export function useReveal(scope: RefObject<Element | null>, targets: string, from: gsap.TweenVars, key: unknown) {
  useGSAP(() => {
    if (moves()) gsap.from(targets, { duration: 0.6, ease: EASE_OUT, stagger: 0.04, ...from });
  }, { scope, dependencies: [key], revertOnUpdate: true });
}
