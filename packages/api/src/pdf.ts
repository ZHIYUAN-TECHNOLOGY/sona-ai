/**
 * A PDF's text for the library, read in the Worker and never stored: the file itself is dropped once
 * its text is indexed. Each page opens with a "# Page n" heading, so a PDF with no headings still
 * splits into sections a passage can cite; a numbered heading inside a page splits it further.
 * Scanned PDFs have no text layer and come back empty.
 * ponytail: no OCR; scans need OpenMed document extraction on box ② once it is hosted.
 */
export async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  // Loaded on first use: pdf.js is ~1.7 MB, and parsing it at every Worker start would slow each cold request.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const { totalPages, text } = await extractText(await getDocumentProxy(bytes), { mergePages: false });
  const pages = text.map(t => t.trim());
  return { pages: totalPages, text: pages.some(Boolean) ? pages.map((t, i) => `# Page ${i + 1}\n${t}`).join("\n\n") : "" };
}
