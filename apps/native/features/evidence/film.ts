import type { ImageMarker } from "@/features/imaging/viewer";
import type { Reference } from "./model";

/*
 * An answer about a patient's X-ray cites the film itself (Reference kind "image"). The pure part of showing it: which
 * reference leads the answer, the stored bytes as a URI the image view can open, and the findings read from that film as
 * markers on it.
 */

/** The film leads the answer only when it is the first source: an answer mostly from studies keeps its text lead. */
export const leadImage = (references: Reference[]) => references[0]?.kind === "image" ? references[0] : undefined;

/** The stored film as a data URI, so the image view opens the bytes the server sent without a second fetch. */
export const dataUri = (image: { contentType: string; dataBase64: string }) => `data:${image.contentType};base64,${image.dataBase64}`;

type FindingRow = { id: string; imageKey: string | null; label: string; status: string; location: { x: number; y: number; box?: [number, number, number, number] | null } };
/** The findings read from this film (same stored key), numbered in order and without the dismissed ones. */
export const filmMarkers = (findings: FindingRow[], key: string): ImageMarker[] =>
  findings.filter(f => f.imageKey === key && f.status !== "dismissed").map((f, i) => ({ id: f.id, n: i + 1, x: f.location.x, y: f.location.y, label: f.label, box: f.location.box ?? undefined }));
