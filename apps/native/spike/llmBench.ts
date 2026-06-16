import { timed, StageMetric } from "./metrics";
import { SAMPLE_TRANSCRIPT, SOAP_SYSTEM_PROMPT } from "./sampleData";

const LLM_GO_MS = 30_000; // full note in <= 30s
const LLM_GO_TPS = 6; // >= 6 tokens/sec

type Msg = { role: "system" | "user" | "assistant"; content: string };

// Runtime-agnostic: takes anything with generate(messages) => Promise<string>.
// Qwen3 (RN-ExecuTorch) satisfies this directly; a Gemma 4 (LiteRT / RunAnywhere)
// adapter implements the same shape so both score through one benchmark.
export async function runLlmBench(llm: {
  generate: (messages: Msg[]) => Promise<string>;
}): Promise<StageMetric> {
  const messages: Msg[] = [
    { role: "system", content: SOAP_SYSTEM_PROMPT },
    { role: "user", content: SAMPLE_TRANSCRIPT },
  ];
  const { result, ms } = await timed(() => llm.generate(messages));

  const approxTokens = Math.ceil(result.length / 4); // ~4 chars/token heuristic
  const tps = approxTokens / (ms / 1000);
  const hasAllSections = ["Subjective", "Objective", "Assessment", "Plan"].every((s) =>
    result.includes(s),
  );

  return {
    stage: "llm",
    ms,
    ok: ms <= LLM_GO_MS && tps >= LLM_GO_TPS && hasAllSections,
    extra: { tokensPerSec: Math.round(tps), hasAllSections: hasAllSections ? 1 : 0 },
    output: result.slice(0, 600),
  };
}
