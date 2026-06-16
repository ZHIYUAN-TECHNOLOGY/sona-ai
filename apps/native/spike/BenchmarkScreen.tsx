import React, { useState } from "react";
import { SafeAreaView, ScrollView, Text, Button, View } from "react-native";
import {
  useSpeechToText,
  useLLM,
  WHISPER_SMALL,
  QWEN3_1_7B_QUANTIZED,
} from "react-native-executorch";
import { StageMetric, dumpMetrics } from "./metrics";
import { runSttBench } from "./sttBench";
import { runLlmBench } from "./llmBench";
import { runNerBench, regexRedact } from "./nerBench";

export default function BenchmarkScreen() {
  const stt = useSpeechToText({ model: WHISPER_SMALL });
  // Baseline LLM (always available in RN-ExecuTorch). Swap for the Gemma 4
  // LiteRT/RunAnywhere adapter (same .generate(messages) shape) to benchmark the target.
  const llm = useLLM({ model: QWEN3_1_7B_QUANTIZED });
  const [metrics, setMetrics] = useState<StageMetric[]>([]);
  const [path, setPath] = useState("");
  const [running, setRunning] = useState(false);

  const ready = stt.isReady && llm.isReady;

  const runAll = async () => {
    setRunning(true);
    const e2eStart = Date.now();
    const ner = await runNerBench(regexRedact);
    const sttM = await runSttBench(stt);
    const llmM = await runLlmBench(llm);
    const e2e: StageMetric = {
      stage: "e2e",
      ms: Date.now() - e2eStart,
      ok: ner.ok && sttM.ok && llmM.ok && Date.now() - e2eStart <= 90_000,
    };
    const all = [ner, sttM, llmM, e2e];
    setMetrics(all);
    setPath(await dumpMetrics(all));
    setRunning(false);
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: "600" }}>Sona On-Device Spike</Text>
        <Text>
          STT ready: {String(stt.isReady)} ({Math.round((stt.downloadProgress ?? 0) * 100)}%)
        </Text>
        <Text>
          LLM ready: {String(llm.isReady)} ({Math.round((llm.downloadProgress ?? 0) * 100)}%)
        </Text>
        <View style={{ height: 12 }} />
        <Button
          title={running ? "Running…" : "Run all benchmarks"}
          onPress={runAll}
          disabled={!ready || running}
        />
        <View style={{ height: 12 }} />
        {metrics.map((m) => (
          <View key={m.stage} style={{ marginVertical: 6 }}>
            <Text style={{ fontWeight: "600" }}>
              {m.stage.toUpperCase()} — {m.ok ? "✅ GO" : "❌ NO-GO"} — {m.ms} ms
            </Text>
            {m.extra ? <Text>{JSON.stringify(m.extra)}</Text> : null}
            {m.output ? <Text numberOfLines={4}>{m.output}</Text> : null}
          </View>
        ))}
        {path ? (
          <Text selectable style={{ marginTop: 12 }}>
            Metrics JSON: {path}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
