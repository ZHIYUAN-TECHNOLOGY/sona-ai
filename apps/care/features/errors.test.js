import { expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";
import { errorText } from "./errors";

test("server refusals read in the patient's language, by code or by the known sentence", () => {
  const voice = new ORPCError("PRECONDITION_FAILED", { message: "Speaking to Sona Care isn't switched on yet. Please type instead." });
  expect(errorText(voice, "ms")).toBe("Bercakap dengan Sona Care belum dihidupkan lagi. Sila taip.");
  expect(errorText(new ORPCError("PRECONDITION_FAILED", { message: "anything", data: { code: "VOICE_OFF" } }), "zh")).toContain("语音");
  expect(errorText(new ORPCError("NOT_FOUND", { message: "A new refusal" }), "zh")).toBe("A new refusal");
  expect(errorText(new TypeError("Network request failed"), "ms")).toBe("Ada masalah. Sila cuba lagi.");
  expect(errorText(new ORPCError("INTERNAL_SERVER_ERROR"), "en", "common.loadError")).toContain("couldn't load");
});
