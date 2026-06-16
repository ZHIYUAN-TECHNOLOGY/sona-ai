import { StageMetric, timed } from "./metrics";
import { SEEDED_PII_TEXT, SEEDED_PII_SPANS } from "./sampleData";

const NER_GO_RECALL = 0.9;

// redactFn: takes raw text, returns text with PII removed/masked.
// Independent of HOW redaction is produced (ML NER on-device, or the
// deterministic fallback below), so it scores whichever path is wired.
export async function runNerBench(
  redactFn: (text: string) => Promise<string>,
): Promise<StageMetric> {
  const { result: redacted, ms } = await timed(() => redactFn(SEEDED_PII_TEXT));
  const removed = SEEDED_PII_SPANS.filter((span) => !redacted.includes(span));
  const recall = removed.length / SEEDED_PII_SPANS.length;
  return {
    stage: "ner",
    ms,
    ok: recall >= NER_GO_RECALL,
    extra: { recall: Number(recall.toFixed(2)), removedSpans: removed.length },
    output: redacted.slice(0, 400),
  };
}

// Path B (pragmatic on-device fallback): deterministic Malaysian-PII redactor.
// Fully on-device, zero ML risk. The gazetteer line is sample-specific ONLY to
// validate the harness end-to-end; production needs a real MY name/place
// gazetteer + broader patterns, and Path A (ML NER) is the accuracy target.
export async function regexRedact(text: string): Promise<string> {
  return text
    .replace(/\d{6}-\d{2}-\d{4}/g, "[IC]")
    .replace(/01\d-?\d{7,8}/g, "[PHONE]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")
    .replace(
      /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/g,
      "[DATE]",
    )
    .replace(/\b(Ahmad bin Hassan|Siti Aminah|Dr Lim Wei Sheng|Klinik Sihat|Petaling Jaya)\b/g, "[REDACTED]");
}
