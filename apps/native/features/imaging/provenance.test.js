import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const assets = new URL("./assets/", import.meta.url);
const provenance = readFileSync(new URL("PROVENANCE.md", assets), "utf8");

test("every bundled film is credited in PROVENANCE.md, with its licence and the checksum of the bytes shipped", () => {
  const films = readdirSync(assets).filter(name => /\.(jpe?g|png)$/i.test(name));
  expect(films).toContain("lobar-pneumonia-pa.jpg");
  for (const name of films) {
    const section = provenance.split(/^# /m).find(s => s.includes(`File: \`${name}\``));
    expect(section, name).toBeDefined();
    expect(section).toMatch(/License: \[CC/);
    expect(section).toContain(createHash("sha1").update(readFileSync(new URL(name, assets))).digest("hex"));
  }
});
