// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { renderPdf } from "@/lib/pdf/render";

import { GuaranteeLetterDocument, type GuaranteeLetterDocumentProps } from "./letter-pdf";

const props = {
  patient: { id: "P-0001", name: "Aisyah binti Rahman" },
  status: { status: "denied", checks: [{ id: "organism", label: "Organism named", detail: "The note names the organism.", status: "passed" }], denial: { code: "D-12", reason: "Oral first", at: "2026-10-01T00:00:00Z" } },
  codes: [
    { code: "J18.9", label: "Pneumonia, unspecified organism", kind: "diagnosis", evidence: "s1", inTable: true },
    { code: "Z99.9", label: "Made up", kind: "procedure", evidence: "s2", inTable: false },
  ],
  sentences: [{ id: "s1", text: "Chest X-ray shows right lower lobe consolidation." }, { id: "s2", text: "IV antibiotics started on admission." }],
  appeal: { opening: "We ask you to look again.", points: [{ claim: "Oral was not possible.", evidenceSentenceId: "s2" }], closing: "Thank you." },
} as unknown as GuaranteeLetterDocumentProps;

test("the guarantee letter renders its codes and the appeal", () => {
  const html = renderToStaticMarkup(createElement(GuaranteeLetterDocument, props));
  for (const s of ["J18.9", "Z99.9", "not in the ICD-10 table", "Appeal", "Oral was not possible.", "Met: Organism named"]) expect(html).toContain(s);
});

test("the guarantee letter renders to PDF bytes", async () => {
  const { bytes } = await renderPdf(createElement(GuaranteeLetterDocument, props), { title: "Guarantee letter" });
  const text = new TextDecoder("latin1").decode(bytes);
  expect(text.startsWith("%PDF-")).toBe(true);
  expect(text).toContain("/Type/Page");
}, 60_000);
