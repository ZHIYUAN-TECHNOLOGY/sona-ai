/** Longest side sent to the reader: keeps the base64 far under the API's 14,000,000 character limit. */
export const MAX_SIDE = 2000;

/** The size to draw at: never enlarged, longest side capped. */
export function fit(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Any picture (a chosen file's bitmap or a webcam frame) as a JPEG the upload accepts. */
export function toJpeg(source: CanvasImageSource, width: number, height: number) {
  const canvas = Object.assign(document.createElement("canvas"), fit(width, height));
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("This picture could not be read.")), "image/jpeg", 0.85));
}

/** The bytes as bare base64 (no `data:` prefix), which is what `scan.upload` takes. */
export function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("This picture could not be read."));
    reader.readAsDataURL(blob);
  });
}
