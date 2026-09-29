/** The last library scan's pages (file URIs), for "What did you scan?" and the OCR review. */
export let lastScan: string[] = [];
export function keepScan(pages: string[]) { lastScan = pages; }

/** A scanned chest X-ray on its way to a patient's visit: the X-ray page attaches it once the doctor picks the patient. */
let pendingXray: string | undefined;
export function handOffXray(uri: string) { pendingXray = uri; }
export function takeXray() { const uri = pendingXray; pendingXray = undefined; return uri; }
