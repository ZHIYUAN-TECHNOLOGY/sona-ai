/**
 * Live mode's X-ray uploads, held once for every place an image is attached (the X-ray page, the visit's dock, a scan)
 * and every place that shows its reading (the visit's card and its lead). The server reads a visit's LATEST upload, so a
 * card may only show a reading whose key is its own image's upload: `readingOf` is that rule. No React or Expo here
 * (use-upload.ts wires those in), so the rules run under `bun test`.
 */
export type XrayUpload = { uri: string; state: "uploading" | "uploaded" | "failed"; key?: string; error?: string };
export type XrayAsset = { uri: string; base64?: string | null; mimeType?: string | null };
export type UploadDeps = {
  /** The file's bytes as base64, for an image attached by URI alone (the dock's photos, camera and files; a scan). */
  read: (uri: string) => Promise<string>;
  upload: (input: { encounterId: string; contentType: string; dataBase64: string }) => Promise<{ key: string }>;
  errorText: (e: unknown) => string;
  /** Once per image actually stored: its findings are detected from it. */
  stored?: (encounterId: string, key: string) => void;
};

const id = (encounterId: string, uri: string) => `${encounterId}\n${uri}`;
const uploads = new Map<string, XrayUpload>();
// Per visit: the image last sent (the server's latest once the queue drains), and the sends in order.
const latest = new Map<string, string>();
const queue = new Map<string, Promise<XrayUpload>>();
const listeners = new Set<() => void>();
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const set = (encounterId: string, upload: XrayUpload) => { uploads.set(id(encounterId, upload.uri), upload); listeners.forEach(l => l()); return upload; };

export const uploadOf = (encounterId: string | undefined, uri: string | undefined) => (encounterId && uri ? uploads.get(id(encounterId, uri)) : undefined);
/** Tests only. */
export function resetUploads() { uploads.clear(); latest.clear(); queue.clear(); }

const TYPES: Record<string, string> = { png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp" };
/** The picker says an image's type; a file attached by URI alone goes by its extension (the camera and the cropper save JPEG). */
export const contentTypeOf = (asset: XrayAsset) => asset.mimeType ?? TYPES[asset.uri.split(/[?#]/)[0]!.split(".").pop()!.toLowerCase()] ?? "image/jpeg";

/**
 * Uploads a visit's image and remembers the outcome by its URI. Attaching the image that is already the visit's latest
 * (in flight or stored) sends nothing more; a failed one, or one another image has since replaced, is sent again, so it
 * is the server's latest once more. A visit's sends run one after another: the last attached is the last stored.
 */
export function sendXray(encounterId: string, asset: XrayAsset, deps: UploadDeps): Promise<XrayUpload> {
  const current = uploadOf(encounterId, asset.uri);
  if (current && current.state !== "failed" && latest.get(encounterId) === asset.uri) return queue.get(encounterId)!;
  latest.set(encounterId, asset.uri);
  set(encounterId, { uri: asset.uri, state: "uploading" });
  const send = async (): Promise<XrayUpload> => {
    try {
      const dataBase64 = asset.base64 || await deps.read(asset.uri).catch(() => "");
      if (!dataBase64) return set(encounterId, { uri: asset.uri, state: "failed", error: "The image could not be read for upload" });
      const { key } = await deps.upload({ encounterId, contentType: contentTypeOf(asset), dataBase64 });
      deps.stored?.(encounterId, key);
      return set(encounterId, { uri: asset.uri, state: "uploaded", key });
    } catch (e) { return set(encounterId, { uri: asset.uri, state: "failed", error: deps.errorText(e) }); }
  };
  const sent = (queue.get(encounterId) ?? Promise.resolve()).then(send);
  queue.set(encounterId, sent);
  return sent;
}

/** `retry` asks the server's read again (the live-answer hook's); only a reading of this card's own stored image carries it. */
type Reading<T> = { live: boolean; loading: boolean; data?: T; error?: string; retry?: () => void };
/**
 * A card's reading of its own image, from that image's upload and the server's read of the visit's latest: it waits
 * while the image is still being saved, says so when the upload failed, and drops a reading of any other image (a newer
 * one took its place on the server). Undefined when the image was never sent: nothing was read from it.
 */
export function readingOf<T extends { key: string }>(upload: XrayUpload | undefined, reading: Reading<T>): (Reading<T> & { saving?: boolean; failed?: boolean }) | undefined {
  if (!upload || !reading.live) return undefined;
  if (upload.state === "uploading") return { live: true, loading: true, saving: true };
  if (upload.state === "failed") return { live: true, loading: false, failed: true, error: `the upload failed (${upload.error})` };
  if (reading.data && reading.data.key !== upload.key) return { live: true, loading: false, error: "a newer image was added to this visit" };
  return reading;
}
