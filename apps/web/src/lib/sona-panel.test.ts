// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { describe, expect, test } from "bun:test";

import { contextLabel, parsePanel } from "./sona-panel";

describe("parsePanel", () => {
  test("keeps a known state", () => {
    expect(parsePanel("closed")).toBe("closed");
    expect(parsePanel("expanded")).toBe("expanded");
    expect(parsePanel("open")).toBe("open");
  });
  test("opens on anything else", () => {
    for (const raw of [null, undefined, "", "CLOSED", "{\"x\":1}"]) expect(parsePanel(raw)).toBe("open");
  });
});

describe("contextLabel", () => {
  const groups = [
    { label: "Patients", items: [{ to: "/pro/patients", label: "Patients", icon: "users" as const }, { to: "/pro/xray", label: "X-ray", icon: "scan" as const }] },
    { label: "Ward", items: [{ to: "/pro/patients/beds", label: "Beds", icon: "bed" as const }] },
  ];
  test("a page's own label wins, trimmed", () => expect(contextLabel("  X-ray · Amelia Tan ", groups, "/pro/xray", "Sona Pro")).toBe("X-ray · Amelia Tan"));
  test("else the sidebar item the path is under, the longest match", () => {
    expect(contextLabel(undefined, groups, "/pro/xray", "Sona Pro")).toBe("X-ray");
    expect(contextLabel("", groups, "/pro/patients/p1", "Sona Pro")).toBe("Patients");
    expect(contextLabel(undefined, groups, "/pro/patients/beds/3", "Sona Pro")).toBe("Beds");
  });
  test("a prefix that is not a path segment does not match", () => expect(contextLabel(undefined, groups, "/pro/xrays", "Sona Pro")).toBe("Sona Pro"));
});
