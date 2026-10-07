/**
 * A PDF's text for the library, read in the Worker and never stored: the file itself is dropped once
 * its text is indexed. Each page opens with a "# Page n" heading, so a PDF with no headings still
 * splits into sections a passage can cite; a numbered heading inside a page splits it further.
 * Scanned PDFs have no text layer and come back empty: their pages go to the vision model as images (pdfPageImages).
 */
export async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  // Loaded on first use: pdf.js is ~1.7 MB, and parsing it at every Worker start would slow each cold request.
  const { extractText, getDocumentProxy } = await import("unpdf");
  // A copy, since pdf.js may take the buffer it is given and the scan reader needs the bytes again.
  const { totalPages, text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: false });
  const pages = text.map(t => t.trim());
  return { pages: totalPages, text: pages.some(Boolean) ? pages.map((t, i) => `# Page ${i + 1}\n${t}`).join("\n\n") : "" };
}

/**
 * Each scanned page as a PNG the vision model can read. The Worker has no canvas to render a page, so this takes the
 * scanner's own picture of it, which on a scan is the page.
 * ponytail: a page made of many image tiles keeps only its largest tile, and text drawn as vector shapes (neither an
 * image nor a text layer) is not read; render pages on a box with a canvas if such PDFs turn up.
 */
export async function pdfPageImages(bytes: Uint8Array, maxPages = 10): Promise<{ pages: number; images: Uint8Array[] }> {
  const { extractImages, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes.slice());
  const images: Uint8Array[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const largest = (await extractImages(pdf, n)).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (largest) images.push(await png(shrink(largest, 1600)));
  }
  return { pages: pdf.numPages, images };
}

type Pixels = { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: 1 | 3 | 4 };

/** Scales down by a whole factor so the long side is at most `max`, each pixel the average of its box. */
export function shrink(img: Pixels, max: number): Pixels {
  const k = Math.ceil(Math.max(img.width, img.height) / max);
  if (k <= 1) return img;
  const { width: w, height: h, channels: c } = img, width = Math.ceil(w / k), height = Math.ceil(h / k);
  const data = new Uint8Array(width * height * c);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let ch = 0; ch < c; ch++) {
    let sum = 0, count = 0;
    for (let yy = y * k; yy < Math.min(y * k + k, h); yy++) for (let xx = x * k; xx < Math.min(x * k + k, w); xx++, count++) sum += img.data[(yy * w + xx) * c + ch]!;
    data[(y * width + x) * c + ch] = Math.round(sum / count);
  }
  return { data, width, height, channels: c };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export const crc32 = (bytes: Uint8Array) => (bytes.reduce((c, b) => CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

/** PNG, unfiltered scanlines; IDAT wants zlib-wrapped deflate, which is what CompressionStream("deflate") writes. */
export async function png({ data, width, height, channels }: Pixels): Promise<Uint8Array> {
  const row = width * channels, raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * row, y * row + row), y * (row + 1) + 1);
  const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  ihdr.set([8, { 1: 0, 3: 2, 4: 6 }[channels], 0, 0, 0], 8);
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(body.length + 12), v = new DataView(out.buffer);
    v.setUint32(0, body.length); out.set(new TextEncoder().encode(type), 4); out.set(body, 8);
    v.setUint32(body.length + 8, crc32(out.subarray(4, body.length + 8)));
    return out;
  };
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
}
