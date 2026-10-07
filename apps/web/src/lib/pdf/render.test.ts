// @ts-ignore -- apps/web has no Bun types installed; drop this line once @types/bun is a devDependency.
import { expect, test } from "bun:test";
import { createElement } from "react";

import { Heading } from "@/components/pdf/heading/heading";
import { Text } from "@/components/pdf/text/text";
import { Document, Page } from "@/lib/pdf/pdf-primitives";

import { renderPdf } from "./render";

const Tiny = () => createElement(Document, null, createElement(Page, null, createElement(Heading, { level: 1 }, "Hello"), createElement(Text, null, "A tiny document.")));

test("renderPdf gives PDF bytes with at least one page", async () => {
  const { bytes, blob } = await renderPdf(createElement(Tiny), { title: "Tiny" });
  const text = new TextDecoder("latin1").decode(bytes);
  expect(text.startsWith("%PDF-")).toBe(true);
  expect(text).toContain("/Type/Page");
  expect(blob.type).toBe("application/pdf");
}, 60_000);
