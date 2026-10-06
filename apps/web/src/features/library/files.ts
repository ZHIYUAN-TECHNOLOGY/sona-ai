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
