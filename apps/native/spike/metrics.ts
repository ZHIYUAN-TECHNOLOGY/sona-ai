import * as FileSystem from "expo-file-system/legacy";

export interface StageMetric {
  stage: "stt" | "llm" | "ner" | "e2e";
  ms: number; // wall-clock duration
  ok: boolean; // passed its go threshold
  extra?: Record<string, number | string>; // tokens/sec, recall, etc.
  output?: string; // transcript / note / redacted text (truncated)
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}

export async function dumpMetrics(runs: StageMetric[]): Promise<string> {
  const path = `${FileSystem.documentDirectory}spike-metrics.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(runs, null, 2));
  return path; // shown in UI so the engineer can pull the file
}
