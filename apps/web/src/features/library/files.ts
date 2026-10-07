/** A file's bytes as bare base64 (no `data:` prefix), which `library.addPdf` and `xray.upload` take. */
export const toBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });

/**
 * A finding's box `[y0, x0, y1, x1]` as CSS percentages over the image. The model answers in thousandths and
 * stored findings are fractions of one, so anything above 1 is read as thousandths.
 */
export function boxStyle(box: readonly number[]) {
  const unit = box.some(v => v > 1) ? 10 : 0.01;
  const [y0 = 0, x0 = 0, y1 = 0, x1 = 0] = box.map(v => Math.min(100, Math.max(0, v / unit)));
  return { top: `${y0}%`, left: `${x0}%`, height: `${Math.max(0, y1 - y0)}%`, width: `${Math.max(0, x1 - x0)}%` };
}

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Try again.");

/** A source this many years old is worth checking: guidance may have moved on since. */
export const STALE_YEARS = 5;
export const isStale = (year: number, thisYear = new Date().getFullYear()) => thisYear - year >= STALE_YEARS;

/** At most this many photos go up together: each is one page that MedGemma reads in turn. */
export const MAX_PAGES = 10;
type Picked = { name: string; type?: string | null };
export type PageType = "image/jpeg" | "image/png";
// The picker's type can be empty (some browsers, Files on iOS), so the extension decides then.
const typeOf = ({ name, type }: Picked) =>
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

/** A title from a file's name, for when none is typed. */
export const titleOf = (name: string) => name.replace(/\.(pdf|jpe?g|png)$/i, "").trim();

/** One page as `library.readScan` read it: the text to check, words the reader was unsure of, and the page it read (bare base64). */
export type ScanPage = { text: string; unsure: string[]; image: string; contentType: PageType };
export type ScanRead = { pages: ScanPage[]; model: string; source: "pdf" | "photo" };

/** The checked text of each page for `library.addScan`: pages left empty are dropped, and nothing goes up when every page is empty. */
export function scanPages(texts: readonly string[]): { pages: string[] } | { error: string } {
  const pages = texts.map(t => t.trim()).filter(Boolean);
  return pages.length ? { pages } : { error: "Every page is empty. Type the text of at least one page, or cancel." };
}
