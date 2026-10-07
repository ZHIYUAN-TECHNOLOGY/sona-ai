/** At most this many photos go up together: each is one page that MedGemma reads in turn. Same rule as the web library (apps/web/src/features/library/files.ts). */
export const MAX_PAGES = 10;
type Picked = { name: string; mimeType?: string | null };
export type PageType = "image/jpeg" | "image/png";
// Files on iOS does not always give a type, so the extension decides then.
const typeOf = ({ name, mimeType: type }: Picked) =>
  type === "application/pdf" || /\.pdf$/i.test(name) ? "application/pdf"
  : type === "image/png" || /\.png$/i.test(name) ? "image/png"
  : type === "image/jpeg" || /\.jpe?g$/i.test(name) ? "image/jpeg" : undefined;

/**
 * What was picked, as one PDF or a list of page photos in the order picked. A PDF goes up alone and a mix is refused,
 * since the server takes either one document or the pages of one document, never both at once.
 */
export function splitPicked<T extends Picked>(files: readonly T[]): { pdf: T } | { images: { file: T; contentType: PageType }[] } | { error: string } {
  const typed = files.map(file => ({ file, contentType: typeOf(file) }));
  if (!typed.length) return { error: "Choose a PDF or photos of the pages." };
  if (typed.some(t => !t.contentType)) return { error: "Only a PDF, or JPEG and PNG photos of the pages, can be added." };
  if (typed.some(t => t.contentType === "application/pdf")) return typed.length === 1 ? { pdf: typed[0]!.file } : { error: "Add a PDF on its own, one at a time, not with other files." };
  if (typed.length > MAX_PAGES) return { error: `Up to ${MAX_PAGES} photos at a time; ${typed.length} were chosen.` };
  return { images: typed as { file: T; contentType: PageType }[] };
}

/** A title from a file's name, for when none is given. */
export const titleOf = (name: string) => name.replace(/\.(pdf|jpe?g|png)$/i, "").trim();

/** One page as `library.readScan` read it: the text to check, words the reader was unsure of, and the page it read (bare base64). */
export type ScanPage = { text: string; unsure: string[]; image: string; contentType: PageType };
export type ScanRead = { pages: ScanPage[]; model: string; source: "pdf" | "photo" };

/** The checked text of each page for `library.addScan`: pages left empty are dropped, and nothing goes up when every page is empty. */
export function scanPages(texts: readonly string[]): { pages: string[] } | { error: string } {
  const pages = texts.map(t => t.trim()).filter(Boolean);
  return pages.length ? { pages } : { error: "Every page is empty. Type the text of at least one page, or cancel." };
}
