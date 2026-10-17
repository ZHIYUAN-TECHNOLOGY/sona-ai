// The image loader's pure parts (components/image-loader.tsx): its phases, its copy, and when the copy changes.

/** What the caller knows: still coming, shown while a model reads it, shown, or not coming. */
export type LoaderState = "loading" | "reading" | "ready" | "failed";
/** What the frame shows: the halftone field, the field dissolving into the image, the image, a scan over it, or a still field. */
export type Phase = "pending" | "reveal" | "visible" | "reading" | "failed";

export const REVEAL_MS = 600;
export const MESSAGE_MS = 2200;

/** Where the reveal lands: the image, with a scan over it while a model still reads it. */
export const settled = (state: LoaderState): Phase => (state === "reading" ? "reading" : "visible");

/**
 * The next phase for the caller's state and whether the image has decoded (true when there is no image to wait for).
 * The field dissolves once, from pending (or failed) to the image; a reveal under way runs to its end, then `settled`.
 */
export function nextPhase(phase: Phase, state: LoaderState, loaded: boolean): Phase {
  if (state === "failed") return "failed";
  if (state === "loading" || !loaded) return "pending";
  if (phase === "pending" || phase === "failed" || phase === "reveal") return "reveal";
  return settled(state);
}

/** The phase a loader mounts in: an image already in hand shows at once; anything else waits. */
export const firstPhase = (state: LoaderState, loaded: boolean) => nextPhase("visible", state, loaded);

/** The copy for each kind of wait, in the order it plays. */
export const LOADER_COPY = {
  film: ["Fetching the film", "Developing the image", "Almost there"],
  upload: ["Sending the film", "Storing it safely", "Getting it ready to read"],
  read: ["Sona Vision is reading the film", "Looking at the lungs", "Checking the heart size", "Marking findings"],
  scan: ["Reading the page", "Finding the words", "Checking unsure words"],
  films: ["Finding films to compare"],
};

/** The copy a state shows unless the caller gives its own: films load and are read; pages are read. */
export function copyFor(state: LoaderState, tone: "film" | "paper"): string[] {
  if (state === "failed") return [tone === "film" ? "Film not available" : "Page not available"];
  if (tone === "paper") return LOADER_COPY.scan;
  return state === "reading" ? LOADER_COPY.read : LOADER_COPY.film;
}

/** Which message shows `ms` into the wait: the next every MESSAGE_MS, holding on the last rather than starting over. */
export const messageAt = (ms: number, count: number) => Math.max(0, Math.min(Math.floor(ms / MESSAGE_MS), count - 1));

/** The reveal's ease out, 0 to 1. */
export const easeOut = (x: number) => 1 - (1 - Math.min(Math.max(x, 0), 1)) ** 3;
