import React, { useState } from "react";
import { SafeAreaView, ScrollView, Text, Button, View } from "react-native";
import {
  useSpeechToText,
  useLLM,
  WHISPER_SMALL,
  WHISPER_SMALL_MODEL_XNNPACK,
  QWEN3_1_7B_QUANTIZED,
} from "react-native-executorch";
import { StageMetric, dumpMetrics } from "./metrics";
import { runSttBench } from "./sttBench";
import { runLlmBench } from "./llmBench";
import { runNerBench, regexRedact } from "./nerBench";

// The spike home is the app's launch route. If it loaded Qwen3 + Whisper on mount,
// then entering the Consult demo (which loads its OWN Qwen3 in PipelineProvider)
// would hold TWO copies of the model in memory at once -> OOM / jetsam on device.
// So the model-loading hooks live in <BenchmarkRunner>, mounted only after an
// explicit tap. A normal demo (launch -> Consult) therefore holds exactly one Qwen3.
export default function BenchmarkScreen() {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ padding: 16, gap: 10 }}>
          <Text style={{ fontSize: 20, fontWeight: "600" }}>Sona On-Device Spike</Text>
          <Text style={{ color: "#555", lineHeight: 18 }}>
            Loads Qwen3-1.7B + Whisper into memory for the Gate-0 benchmark. Run this on its own —
            do not keep it loaded while walking the Consult demo on a device, or the two model
            copies can exceed memory.
          </Text>
          <Button title="Load models & benchmark" onPress={() => setArmed(true)} />
        </View>
      </SafeAreaView>
    );
  }

  return <BenchmarkRunner />;
}

function BenchmarkRunner() {
  // Force the XNNPACK Whisper model. The CoreML .pte variants are NOT published
  // at v0.9.0 (every coreml URL 404s; every xnnpack URL is live), and executorch
  // otherwise picks CoreML on iOS -> "Load failed: 404". XNNPACK runs on-device
  // fine (CPU/GPU, not the ANE); swap to CoreML later if/when SWM publishes it.
  const stt = useSpeechToText({
    model: { ...WHISPER_SMALL, modelSource: WHISPER_SMALL_MODEL_XNNPACK },
  });
  // Baseline LLM (always available in RN-ExecuTorch). Swap for the Gemma 4
  // LiteRT/RunAnywhere adapter (same .generate(messages) shape) to benchmark the target.
  const llm = useLLM({ model: QWEN3_1_7B_QUANTIZED });
  const [metrics, setMetrics] = useState<StageMetric[]>([]);
  const [path, setPath] = useState("");
  const [running, setRunning] = useState(false);

  const ready = stt.isReady && llm.isReady;

  const runAll = async () => {
    setRunning(true);
    try {
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
    } catch (e) {
      // Surface the failure instead of leaving the button stuck on "Running…".
      setMetrics([
        { stage: "e2e", ms: 0, ok: false, output: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setRunning(false);
    }
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
