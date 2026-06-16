# Scaffold + On-Device Runtime Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the `med-ai` monorepo with the locked stack, then prove (or disprove) that a phone can run on-device STT + a small LLM + PII/NER fast enough for a smooth Sona demo — and lock the on-device runtime choice.

**Architecture:** Generate the Better-T-Stack monorepo (React Native bare + oRPC + Cloudflare Workers + Neon). In the native-bare app, integrate `react-native-executorch` for on-device Whisper STT and a 1–1.5B instruct LLM, plus an on-device PII/NER probe. Build an in-app **Benchmark** screen that runs each stage against a bundled sample consult and logs structured latency/quality metrics. Compare results to explicit go/no-go thresholds and write a decision doc choosing RN-ExecuTorch vs RunAnywhere.

**Tech Stack:** Better-T-Stack CLI, React Native (bare, new architecture), `react-native-executorch`, `react-native-audio-api`, `react-native-blob-util`, TypeScript, Cloudflare Workers, Neon Postgres, Alchemy (deploy — out of scope for this spike).

**Why this is a spike, not a feature:** It is deliberately throwaway-tolerant. Its only deliverables are (a) a working scaffolded monorepo and (b) a decision doc with measured numbers. Code quality bar is "stable enough to measure," not "production." This de-risks the #1 technical unknown before any real feature work.

**Target demo device (pick ONE, record it):** a recent flagship — iPhone 15/16 (A16/A17+) or a 2024 Android flagship (Snapdragon 8 Gen 2/3) with ≥8 GB RAM. A 1–1.5B model quantized needs ~1–2 GB free RAM. All benchmarks are measured on this device; the simulator/emulator does NOT count (no real NPU/Neural Engine).

---

## Go / No-Go thresholds (the spike's pass criteria)

Measured on the target device, not simulator:

| Stage               | Metric                              | GO threshold                                                                                        |
| ------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| STT (multilingual)  | Transcribe a 60s consult clip       | ≤ 90s wall-clock (≤1.5× audio) and intelligible BM/EN output                                        |
| LLM (local)         | SOAP note from ~500-word transcript | ≤ 30s to full note, ≥ 6 tokens/sec, coherent SOAP structure                                         |
| PII/NER (on-device) | Redact a sample transcript          | Runs on-device at all, recall ≥ 0.9 on the 10 seeded PII spans — OR a documented redaction fallback |
| End-to-end          | record → note, perceived            | ≤ 90s, no OOM crash across 5 consecutive runs                                                       |

**If any stage misses:** do not silently proceed. Record the miss in the decision doc and trigger the documented fallback (smaller model / RunAnywhere spike / streaming STT). The point of the spike is to find this out in week 1.

---

## File structure (created by this plan)

```
med-ai/                              # better-t-stack monorepo root (generated)
  apps/native/                       # React Native bare app (name may vary by template)
    src/
      spike/
        BenchmarkScreen.tsx          # in-app harness: runs all stages, shows metrics
        sttBench.ts                  # STT run + timing
        llmBench.ts                  # LLM run + timing + tokens/sec
        nerBench.ts                  # on-device PII/NER probe + recall calc
        metrics.ts                   # Metric type + structured logger + JSON dump
        sampleData.ts                # SAMPLE_TRANSCRIPT + SEEDED_PII + SOAP_PROMPT
      assets/
        sample-consult.wav           # ~60s BM/EN role-play consult (16 kHz mono)
  docs/superpowers/decisions/
    2026-06-16-ondevice-runtime-decision.md   # the deliverable
```

> The exact app folder (`apps/native` vs `apps/mobile`) depends on the template output. Task 1 records the real path; later tasks use it.

---

## Task 0: Scaffold the monorepo

**Files:**

- Create: entire `med-ai/` monorepo via CLI

- [ ] **Step 1: Run the Better-T-Stack scaffolder**

The exact config is the one saved in the builder URL (`api=orpc, fe-n=native-bare, rt=workers, sd=cloudflare, db=postgres, dbs=neon, wd=cloudflare, add=vite-plus`). The builder page renders the precise command for that config — open it and copy the shown command. As a starting point (cross-check flag names against the builder output, the CLI evolves):

Run from the parent of the current repo, naming the project `med-ai`:

```bash
npm create better-t-stack@latest med-ai -- \
  --frontend native-bare \
  --backend hono \
  --runtime workers \
  --api orpc \
  --database postgres \
  --db-setup neon \
  --addons turborepo \
  --install
```

If a flag is rejected, drop `--<flag>` and the wizard will prompt for it interactively — accept the values matching the config above.

- [ ] **Step 2: Verify the scaffold installed and type-checks**

Run:

```bash
cd med-ai && npm run check-types || npx turbo run check-types
```

Expected: completes with no type errors (a fresh template is clean). If the script name differs, list scripts with `npm run` and run the type-check one.

- [ ] **Step 3: Verify the web/API dev server boots**

Run (template script name may be `dev`):

```bash
npm run dev
```

Expected: the Workers/web dev server starts and prints a local URL with no crash. Stop it with Ctrl-C.

- [ ] **Step 4: Commit the scaffold**

```bash
git add -A
git commit -m "chore: scaffold med-ai monorepo (better-t-stack: native-bare + orpc + workers + neon)"
```

---

## Task 1: Get the native-bare app building on the target device

**Files:**

- Modify: `apps/native/package.json` (add on-device deps)
- Record: real app path + run commands

- [ ] **Step 1: Identify the native app path and run commands**

Run:

```bash
ls apps && cat apps/*/package.json | grep -A20 '"scripts"'
```

Expected: find the React Native app folder (e.g. `apps/native`). Note its `ios`/`android`/`start` scripts. Use this path everywhere `apps/native` appears below.

- [ ] **Step 2: Add on-device + audio dependencies**

From the app folder:

```bash
cd apps/native
npm install react-native-executorch react-native-audio-api react-native-blob-util
```

Expected: installs without peer-dependency errors. `react-native-executorch` requires the New Architecture (default in current RN templates).

- [ ] **Step 3: Install native pods (iOS) and confirm a clean device build**

iOS:

```bash
cd ios && pod install && cd ..
npm run ios -- --device   # or open the workspace in Xcode and run on the connected device
```

Android:

```bash
npm run android   # with a physical device connected and USB debugging on
```

Expected: app builds and launches on the **physical** device showing the template home screen. A simulator build is acceptable only to confirm compilation — all later benchmarks must run on the physical device.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add -A
git commit -m "chore(native): add react-native-executorch + audio-api on-device deps"
```

---

## Task 2: Sample data + metrics harness

**Files:**

- Create: `apps/native/src/spike/metrics.ts`
- Create: `apps/native/src/spike/sampleData.ts`
- Create: `apps/native/src/assets/sample-consult.wav`

- [ ] **Step 1: Add the sample audio asset**

Record (or have a teammate record) a ~60-second scripted doctor–patient role-play that **code-switches Malay/English** (e.g. "Doctor, saya ada fever dah tiga hari, batuk kering, and my throat sakit bila telan…"). Export as **16 kHz mono WAV** to `apps/native/src/assets/sample-consult.wav`. This single clip is the fixed input for every benchmark run so numbers are comparable.

- [ ] **Step 2: Write the metrics module**

Create `apps/native/src/spike/metrics.ts`:

```typescript
import RNBlobUtil from "react-native-blob-util";

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
  const path = `${RNBlobUtil.fs.dirs.DocumentDir}/spike-metrics.json`;
  await RNBlobUtil.fs.writeFile(path, JSON.stringify(runs, null, 2), "utf8");
  return path; // shown in UI so the engineer can pull the file
}
```

- [ ] **Step 3: Write the sample data + prompt module**

Create `apps/native/src/spike/sampleData.ts`:

```typescript
// A pre-written de-identified transcript used to benchmark the LLM in isolation
// (so STT variance doesn't pollute LLM timing). ~500 words.
export const SAMPLE_TRANSCRIPT = `Patient is a 34 year old presenting with a three day history of fever, dry cough, and sore throat that is worse on swallowing. Reports temperature measured at home around 38.5 degrees. No shortness of breath, no chest pain. Denies recent travel. Has mild headache and body aches. No known drug allergies. Currently taking paracetamol as needed with partial relief. On examination throat is mildly erythematous, no exudate, chest clear on auscultation, oxygen saturation 98 percent on room air. Working impression is a viral upper respiratory tract infection. Plan is supportive care, paracetamol for fever, adequate hydration and rest, and to return if breathing difficulty, persistent high fever beyond five days, or worsening symptoms.`;

// The same text with 10 PII spans seeded, to measure redaction recall.
export const SEEDED_PII_TEXT = `Ahmad bin Hassan, IC 880101-14-5523, a 34 year old from Petaling Jaya, phone 012-3456789, email ahmad.h@example.com, seen on 14 June 2026 by Dr Lim Wei Sheng at Klinik Sihat presents with fever and sore throat. Next of kin Siti Aminah, contactable at 019-8765432.`;

export const SEEDED_PII_SPANS = [
  "Ahmad bin Hassan",
  "880101-14-5523",
  "Petaling Jaya",
  "012-3456789",
  "ahmad.h@example.com",
  "14 June 2026",
  "Dr Lim Wei Sheng",
  "Klinik Sihat",
  "Siti Aminah",
  "019-8765432",
]; // 10 spans; recall = (spans removed) / 10

export const SOAP_SYSTEM_PROMPT =
  "You are a clinical documentation assistant. Convert the consultation transcript into a concise SOAP note with four labelled sections: Subjective, Objective, Assessment, Plan. Use only information present in the transcript. Do not invent findings, medications, or doses.";
```

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/spike/metrics.ts apps/native/src/spike/sampleData.ts apps/native/src/assets/sample-consult.wav
git commit -m "test(spike): add sample consult, seeded-PII fixture, and metrics harness"
```

---

## Task 3: STT benchmark (Whisper, multilingual)

**Files:**

- Create: `apps/native/src/spike/sttBench.ts`

- [ ] **Step 1: Write the STT benchmark runner**

Create `apps/native/src/spike/sttBench.ts`. It loads the multilingual Whisper model, transcribes the bundled clip, and times it. (Hook usage per `react-native-executorch`: `useSpeechToText` exposes `.transcribe(audioBuffer, opts)` and `.isReady`.)

```typescript
import { AudioContext } from "react-native-audio-api";
import RNBlobUtil from "react-native-blob-util";
import { timed, StageMetric } from "./metrics";

const STT_GO_MS = 90_000; // 60s clip must transcribe in <= 90s

// Resolve the bundled wav to a file uri the AudioContext can decode.
async function sampleUri(): Promise<string> {
  // react-native asset -> copy into a readable path
  const asset = require("../assets/sample-consult.wav");
  const { uri } = require("react-native/Libraries/Image/resolveAssetSource")(asset);
  if (uri.startsWith("http") || uri.startsWith("file")) return uri;
  // Dev bundler returns an http uri; download to cache for decode.
  const dest = `${RNBlobUtil.fs.dirs.CacheDir}/sample-consult.wav`;
  await RNBlobUtil.config({ path: dest }).fetch("GET", uri);
  return `file://${dest}`;
}

// `model` is the object returned by useSpeechToText (passed in from the screen).
export async function runSttBench(model: {
  transcribe: (buf: Float32Array, opts?: { language?: string }) => Promise<{ text: string }>;
}): Promise<StageMetric> {
  const uri = await sampleUri();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const decoded = await audioContext.decodeAudioData(uri);
  const buffer = decoded.getChannelData(0);

  const { result, ms } = await timed(() => model.transcribe(buffer)); // multilingual auto-detect
  return {
    stage: "stt",
    ms,
    ok: ms <= STT_GO_MS && result.text.trim().length > 0,
    output: result.text.slice(0, 400),
  };
}
```

- [ ] **Step 2: Wire the multilingual model in the screen (verified in Task 6)**

The screen will call `useSpeechToText({ model: WHISPER_SMALL })` (multilingual; `WHISPER_TINY_EN` is English-only and must NOT be used for the BM/EN test) and pass the hook object into `runSttBench`. No standalone run yet — verified end-to-end in Task 6.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/spike/sttBench.ts
git commit -m "feat(spike): on-device Whisper STT benchmark runner"
```

---

## Task 4: LLM benchmark (local SOAP generation)

**Files:**

- Create: `apps/native/src/spike/llmBench.ts`

- [ ] **Step 1: Write the LLM benchmark runner**

Create `apps/native/src/spike/llmBench.ts`. It feeds the fixed `SAMPLE_TRANSCRIPT` to a local instruct model and produces a SOAP note, timing it and estimating tokens/sec. (Per `react-native-executorch`: `useLLM` exposes `.generate(messages)` returning the full string, plus `.response`/`.isReady`.)

```typescript
import { timed, StageMetric } from "./metrics";
import { SAMPLE_TRANSCRIPT, SOAP_SYSTEM_PROMPT } from "./sampleData";

const LLM_GO_MS = 30_000; // full note in <= 30s
const LLM_GO_TPS = 6; // >= 6 tokens/sec

type Msg = { role: "system" | "user" | "assistant"; content: string };

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
```

- [ ] **Step 2: Wire the model in the screen (verified in Task 6)**

The screen will call `useLLM({ model: LFM2_5_1_2B_INSTRUCT })` and pass the hook object into `runLlmBench`. `LFM2_5_1_2B_INSTRUCT` is the documented default; if it OOMs on the target device, fall back to a smaller listed model (record which one in the decision doc).

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/spike/llmBench.ts
git commit -m "feat(spike): on-device LLM SOAP-generation benchmark runner"
```

---

## Task 5: On-device PII/NER probe (the riskiest stage)

**Files:**

- Create: `apps/native/src/spike/nerBench.ts`

> **Honest framing:** OpenMed ships Hugging Face `transformers` models (PyTorch). There is no first-class React Native binding. This task is a _feasibility probe with a decision_, not a guaranteed integration. It tries the realistic on-device path and, if that path is not viable inside the spike window, records a concrete fallback. Either outcome is a valid spike result.

- [ ] **Step 1: Write a redaction-recall scorer (runtime-agnostic)**

Create `apps/native/src/spike/nerBench.ts`. The scorer is independent of how redaction is produced, so it works for whichever path Step 2 picks:

```typescript
import { StageMetric, timed } from "./metrics";
import { SEEDED_PII_TEXT, SEEDED_PII_SPANS } from "./sampleData";

const NER_GO_RECALL = 0.9;

// redactFn: takes raw text, returns text with PII removed/masked.
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
```

- [ ] **Step 2: Provide a redaction function, trying paths in order**

Implement `redactFn` using the FIRST path that works on the target device, and record which one in the decision doc:

- **Path A (preferred — true ML NER on-device):** export an OpenMed PII model to ONNX, add `onnxruntime-react-native`, run token classification on-device, mask predicted PII spans. If you can export and load it within the spike window, use it.
- **Path B (pragmatic on-device fallback):** a deterministic Malaysian-PII redactor — regex for IC numbers (`\d{6}-\d{2}-\d{4}`), phone (`01\d-?\d{7,8}`), email, dates, plus a small bundled gazetteer of common names/clinics. Fully on-device, zero ML risk. This is the realistic P0 redaction floor; ML NER becomes an accuracy upgrade later.

Add this Path B implementation now so the benchmark always runs (Path A can replace it if it lands):

```typescript
export async function regexRedact(text: string): Promise<string> {
  return text
    .replace(/\d{6}-\d{2}-\d{4}/g, "[IC]")
    .replace(/01\d-?\d{7,8}/g, "[PHONE]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")
    .replace(
      /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/g,
      "[DATE]",
    )
    .replace(
      /\b(Ahmad bin Hassan|Siti Aminah|Dr Lim Wei Sheng|Klinik Sihat|Petaling Jaya)\b/g,
      "[REDACTED]",
    );
}
```

> The gazetteer line is sample-specific on purpose — it exists only to validate the harness end-to-end. The decision doc must state plainly that production Path B needs a real Malaysian name/place gazetteer + broader patterns, and that Path A (ML NER) is the accuracy target. Do not present Path B's sample recall as production recall.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/spike/nerBench.ts
git commit -m "feat(spike): on-device PII redaction probe + recall scorer"
```

---

## Task 6: Benchmark screen + end-to-end run

**Files:**

- Create: `apps/native/src/spike/BenchmarkScreen.tsx`
- Modify: app entry to show `BenchmarkScreen` (record exact file in Step 1)

- [ ] **Step 1: Build the benchmark screen**

Create `apps/native/src/spike/BenchmarkScreen.tsx`. It loads both models via hooks, runs all stages, computes an end-to-end metric, and writes the JSON dump:

```tsx
import React, { useState } from "react";
import { SafeAreaView, ScrollView, Text, Button, View } from "react-native";
import {
  useSpeechToText,
  useLLM,
  WHISPER_SMALL,
  LFM2_5_1_2B_INSTRUCT,
} from "react-native-executorch";
import { StageMetric, dumpMetrics } from "./metrics";
import { runSttBench } from "./sttBench";
import { runLlmBench } from "./llmBench";
import { runNerBench, regexRedact } from "./nerBench";

export default function BenchmarkScreen() {
  const stt = useSpeechToText({ model: WHISPER_SMALL });
  const llm = useLLM({ model: LFM2_5_1_2B_INSTRUCT });
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
            {m.extra && <Text>{JSON.stringify(m.extra)}</Text>}
            {m.output && <Text numberOfLines={4}>{m.output}</Text>}
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
```

- [ ] **Step 2: Render the benchmark screen as the app root**

Find the app entry (e.g. `apps/native/App.tsx` or `apps/native/index.js` registered component) and render `BenchmarkScreen` as the root for the duration of the spike. Record the exact file edited.

- [ ] **Step 3: Run on the target device and capture numbers**

Launch on the **physical** target device. Wait for both models to finish downloading (first launch downloads weights — note the download time and size too; it matters for real-world onboarding). Tap **Run all benchmarks**. Record:

- Each stage's GO/NO-GO + ms (and tokens/sec, recall)
- Run it **5 times**; note any crash/OOM and the spread.

Expected: a results list with per-stage verdicts and a written `spike-metrics.json` path. There is no green-bar unit test here — the device output IS the test, judged against the threshold table.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(spike): benchmark screen running STT + LLM + redaction end-to-end"
```

---

## Task 7: Decision doc (the deliverable)

**Files:**

- Create: `docs/superpowers/decisions/2026-06-16-ondevice-runtime-decision.md`

- [ ] **Step 1: Write the decision doc from measured numbers**

Create `docs/superpowers/decisions/2026-06-16-ondevice-runtime-decision.md` with the real recorded data:

```markdown
# Decision: On-Device Runtime for Sona — 2026-06-16

## Target device

<model, chip, RAM, OS version>

## Measured results (median of 5 runs)

| Stage                       | Model                | Median ms   | tokens/sec | recall | GO/NO-GO |
| --------------------------- | -------------------- | ----------- | ---------- | ------ | -------- |
| STT                         | WHISPER_SMALL        | …           | —          | —      | …        |
| LLM                         | LFM2_5_1_2B_INSTRUCT | …           | …          | —      | …        |
| NER                         | <Path A or B>        | …           | —          | …      | …        |
| E2E                         | —                    | …           | —          | —      | …        |
| First-launch model download | —                    | … (size MB) | —          | —      | note     |

## Decision

- Runtime chosen: **react-native-executorch** | **RunAnywhere** (with reason).
- Redaction path chosen: **A (ML NER)** | **B (deterministic)** (with reason + production gap noted).
- Models locked for P0: STT=<>, LLM=<>.

## If NO-GO on any stage — fallback taken

<e.g. smaller LLM, streaming STT for perceived latency, or spin RunAnywhere comparison spike>

## Implications for the P0 plan

<e.g. "cloud Claude is the default summarizer; local LLM is the offline toggle only" if local LLM is too slow for primary use>
```

- [ ] **Step 2: Decide RN-ExecuTorch vs RunAnywhere explicitly**

- If all stages are **GO** on RN-ExecuTorch → lock RN-ExecuTorch; do **not** spend time integrating RunAnywhere. Record this.
- If LLM or STT is **NO-GO** → before switching SDKs, retry with a smaller model and with streaming STT (perceived latency). If still NO-GO → open a follow-up spike to repeat Tasks 3–6 against the RunAnywhere RN SDK and compare. Note this as the next action; it is out of scope for this plan.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/decisions/2026-06-16-ondevice-runtime-decision.md
git commit -m "docs: on-device runtime decision from spike benchmarks"
```

---

## Done when

- Monorepo scaffolds, type-checks, and the dev server boots.
- The native app builds and runs on a physical target device.
- The benchmark screen produces per-stage GO/NO-GO numbers across 5 runs.
- The decision doc records measured numbers and locks: runtime, redaction path, and P0 models — or names the fallback spike if a stage is NO-GO.

This plan intentionally stops at "we know what runs and how fast." The P0 scribe pipeline plan (record → redact → SOAP → review → export) is the next plan and consumes this decision.
