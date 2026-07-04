import { SignedNote } from "./types";
import { SECTION_HEADERS, assertReidentified } from "./noteText";

// Escape user/content text for safe embedding in HTML.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Render a paragraph, preserving line breaks within a section body.
function paragraph(body: string): string {
  return esc(body).replace(/\n/g, "<br />");
}

function section(header: string, body: string): string {
  return `<section class="soap">
      <h2>${esc(header)}</h2>
      <p>${paragraph(body)}</p>
    </section>`;
}

// A clean, printable HTML rendering of the note: white background, simple
// clinical layout. Suitable to hand to expo-print printToFileAsync. Self-
// contained (inline CSS) so it renders identically offline.
export function toNoteHtml(note: SignedNote): string {
  assertReidentified(note);
  const orders =
    note.orders.length > 0
      ? note.orders.map((o) => `<li>${esc(o.text)}</li>`).join("")
      : "<li>None.</li>";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Consult Note</title>
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
        color: #111827;
        background: #ffffff;
        margin: 0;
        padding: 32px 40px;
        line-height: 1.5;
        font-size: 14px;
      }
      header {
        border-bottom: 2px solid #16a34a;
        padding-bottom: 16px;
        margin-bottom: 24px;
      }
      h1 {
        font-size: 20px;
        margin: 0 0 12px;
        color: #111827;
      }
      .meta { color: #374151; font-size: 13px; }
      .meta div { margin: 2px 0; }
      .meta .label { color: #6b7280; display: inline-block; min-width: 96px; }
      h2 {
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #16a34a;
        margin: 20px 0 6px;
      }
      .soap p { margin: 0; }
      ul { margin: 6px 0 0; padding-left: 20px; }
      li { margin: 2px 0; }
      footer {
        margin-top: 32px;
        padding-top: 16px;
        border-top: 1px solid #e5e7eb;
        color: #6b7280;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Consult Note</h1>
      <div class="meta">
        <div><span class="label">Patient</span>${esc(note.patientDisplayName)}</div>
        <div><span class="label">Clinician</span>${esc(note.clinicianName)} (MMC ${esc(note.mmcNo)})</div>
        <div><span class="label">Signed</span>${esc(note.signedAtISO)}</div>
        <div><span class="label">Consult ID</span>${esc(note.consultId)}</div>
      </div>
    </header>

    ${section(SECTION_HEADERS.subjective, note.soap.subjective)}
    ${section(SECTION_HEADERS.objective, note.soap.objective)}
    ${section(SECTION_HEADERS.assessment, note.soap.assessment)}
    ${section(SECTION_HEADERS.plan, note.soap.plan)}

    <section class="soap">
      <h2>${esc(SECTION_HEADERS.orders)}</h2>
      <ul>${orders}</ul>
    </section>

    <footer>
      Signed by ${esc(note.clinicianName)} on ${esc(note.signedAtISO)}. Generated on-device by Sona.
    </footer>
  </body>
</html>`;
}
