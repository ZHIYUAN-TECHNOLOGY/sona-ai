# Scaffold + On-Device Runtime Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the `med-ai` monorepo with the locked stack, then prove (or disprove) that a phone can run on-device STT + a small LLM + PII/NER fast enough for a smooth Sona demo — and lock the on-device runtime choice.

**Architecture:** Generate the Better-T-Stack monorepo (Expo bare RN + oRPC + Cloudflare Workers + Neon). In the native app, integrate on-device Whisper STT, an on-device instruct LLM for SOAP generation, and an on-device PII/NER probe. The **target summarizer is Gemma 4 E4B/E2B** (edge-optimized, 140 languages incl. Malay, multimodal) — but `react-native-executorch` ships NO Gemma build (only Llama/Qwen/Phi/SmolLM/LFM2), so the LLM stage is a **runtime bake-off**: Gemma 4 via **Google AI Edge / LiteRT (MediaPipe LLM Inference)** or **RunAnywhere**, against a guaranteed-works **Qwen3-1.7B on RN-ExecuTorch** baseline. Build an in-app **Benchmark** screen that runs each stage against a bundled sample consult and logs structured latency/quality metrics. Compare to explicit go/no-go thresholds and write a decision doc that locks the runtime, the summarizer model, and the redaction path.

**Tech Stack:** Better-T-Stack CLI, **Expo bare workflow** (`native-bare` = Expo + Expo Router; native projects via `expo prebuild`, on-device modules run in a **dev client**, NOT Expo Go), `react-native-executorch` (Whisper STT + Qwen3 baseline LLM), **Google AI Edge / LiteRT (MediaPipe LLM Inference)** or **RunAnywhere** (to run **Gemma 4 E4B/E2B**), `react-native-audio-api`, `expo-asset`, `expo-file-system`, TypeScript, Cloudflare Workers, Neon Postgres, Alchemy (deploy — out of scope for this spike).

> **Gemma 4 reality:** Gemma 4 edge variants (E2B/E4B) are distributed via Hugging Face, Ollama, and **Google AI Edge (LiteRT)** — NOT as a `react-native-executorch` constant. Running it on-device means either (a) Google AI Edge LiteRT / MediaPipe LLM Inference (official Gemma path, has iOS/Android, needs an RN bridge or small native module), (b) the RunAnywhere SDK if it exposes a LiteRT/Gemma backend, or (c) exporting Gemma 4's text path to an ExecuTorch `.pte` yourself. The spike measures whichever lands first; Qwen3-1.7B on RN-ExecuTorch is the fallback that always produces a number.

> **Scaffold reality (recorded post-Task-0):** `apps/native` is an Expo app whose source lives in `app/`, `components/`, `lib/`, `utils/` (no `src/`). Spike code goes in `apps/native/spike/`, assets in `apps/native/assets/`. There are no `ios/`/`android/` folders until `expo prebuild` runs.

**Why this is a spike, not a feature:** It is deliberately throwaway-tolerant. Its only deliverables are (a) a working scaffolded monorepo and (b) a decision doc with measured numbers. Code quality bar is "stable enough to measure," not "production." This de-risks the #1 technical unknown before any real feature work.

**Target demo device (pick ONE, record it):** a recent flagship — iPhone 15/16 (A16/A17+) or a 2024 Android flagship (Snapdragon 8 Gen 2/3) with ≥8 GB RAM. A 1–1.5B model quantized needs ~1–2 GB free RAM. All benchmarks are measured on this device; the simulator/emulator does NOT count (no real NPU/Neural Engine).

---

## Go / No-Go thresholds (the spike's pass criteria)

Measured on the target device, not simulator:

| Stage               | Metric                              | GO threshold                                                                                        |
| ------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| STT (multilingual)  | Transcribe a 60s consult clip       | ≤ 90s wall-clock (≤1.5× audio) and intelligible BM/EN output                                        |
| LLM (Gemma 4 E4B target; Qwen3 baseline) | SOAP note from ~500-word transcript | ≤ 30s to full note, ≥ 6 tokens/sec, coherent SOAP structure                  |
| PII/NER (on-device) | Redact a sample transcript          | Runs on-device at all, recall ≥ 0.9 on the 10 seeded PII spans — OR a documented redaction fallback |
| End-to-end          | record → note, perceived            | ≤ 90s, no OOM crash across 5 consecutive runs                                                       |

**If any stage misses:** do not silently proceed. Record the miss in the decision doc and trigger the documented fallback (smaller model / RunAnywhere spike / streaming STT). The point of the spike is to find this out in week 1.

---

## File structure (created by this plan)

```
med-ai/                              # better-t-stack monorepo root (scaffolded in Task 0)
  apps/native/                       # Expo bare-workflow app (source in app/, components/, lib/, utils/)
    spike/
      BenchmarkScreen.tsx            # in-app harness: runs all stages, shows metrics
      sttBench.ts                    # STT run + timing
      llmBench.ts                    # LLM run + timing + tokens/sec
      nerBench.ts                    # on-device PII/NER probe + recall calc
      metrics.ts                     # Metric type + structured logger + JSON dump
      sampleData.ts                  # SAMPLE_TRANSCRIPT + SEEDED_PII + SOAP_PROMPT
    assets/
      sample-consult.wav             # ~60s BM/EN role-play consult (16 kHz mono)
  apps/web/                          # tanstack-router (Vite) — clinician dashboard (later plans)
  apps/server/                       # hono on Cloudflare Workers (later plans)
  docs/superpowers/decisions/
    2026-06-16-ondevice-runtime-decision.md   # the deliverable
```

> App folder confirmed as `apps/native` (Expo). Web = `apps/web`, server = `apps/server`.

---

## Task 0: Scaffold the monorepo

**Files:**

- Create: entire `med-ai/` monorepo via CLI

- [x] **Step 1: Run the Better-T-Stack scaffolder** ✅ DONE

Scaffolded directly into this repo with `--directory-conflict merge` (preserves `docs/` + git history). Two config resolutions vs the builder URL: a web frontend (`tanstack-router`) was added because `--web-deploy cloudflare` requires one (and the spec needs a Vite dashboard), and `turborepo` was dropped because `vite-plus` is itself the task runner. Actual reproducible command:

```bash
npm create better-t-stack@latest -- create . \
  --frontend native-bare tanstack-router \
  --backend hono --runtime workers --api orpc \
  --database postgres --orm drizzle --db-setup neon --manual-db \
  --web-deploy cloudflare --server-deploy cloudflare \
  --addons vite-plus --auth none --payments none --examples none \
  --package-manager npm --no-git --no-install \
  --directory-conflict merge --disable-analytics
```

- [ ] **Step 2: Install deps and verify type-check**

```bash
npm install
npm run check        # vite-plus lint+format+typecheck (see root package.json scripts)
```

Expected: install completes; `check` passes on the fresh template. If `check` isn't present, run `npx tsc --noEmit` per workspace.

- [ ] **Step 3: Verify the web/API dev server boots**

```bash
npm run dev
```

Expected: web on http://localhost:5173 and backend on http://localhost:3000 (OpenAPI at /api-reference) with no crash. Stop with Ctrl-C. (Note: `--manual-db` means Neon isn't provisioned yet — DB-dependent routes need a `DATABASE_URL` set first; not required for this spike.)

- [x] **Step 4: Commit the scaffold** ✅ DONE (commit `chore: scaffold med-ai monorepo (better-t-stack)`)

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

From the repo root (installs the whole monorepo first if not done), then add to the native app:

```bash
npm install
npm install --workspace apps/native react-native-executorch react-native-audio-api expo-asset expo-file-system
```

Expected: installs without peer-dependency errors. `react-native-executorch` requires the New Architecture — Expo SDK enables it by default. `expo-asset`/`expo-file-system` handle bundled-asset reads (no `react-native-blob-util` needed under Expo).

- [ ] **Step 3: Prebuild native projects, build a dev client, run on device**

`native-bare` is the Expo bare workflow, so generate native projects then build a custom **dev client** (Expo Go cannot load these native modules):

```bash
cd apps/native
npx expo prebuild --clean          # generates ios/ and android/ from config
```

iOS (physical device):

```bash
npx expo run:ios --device          # builds the dev client and installs on the connected device
```

Android (physical device, USB debugging on):

```bash
npx expo run:android --device
```

Expected: the dev client builds and launches on the **physical** device showing the Expo Router home screen. A simulator/emulator build is acceptable only to confirm compilation — all later benchmarks must run on the physical device (no Neural Engine/NPU in simulators).

> If `react-native-audio-api` or `react-native-executorch` need a config plugin, add it to `apps/native/app.json` under `expo.plugins` before `prebuild` (check each package's README). Re-run `expo prebuild --clean` after any plugin change.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add -A
git commit -m "chore(native): add react-native-executorch + audio-api on-device deps"
```

---

## Task 2: Sample data + metrics harness

**Files:**

- Create: `apps/native/spike/metrics.ts`
- Create: `apps/native/spike/sampleData.ts`
- Create: `apps/native/assets/sample-consult.wav`

- [ ] **Step 1: Add the sample audio asset**

Record (or have a teammate record) a ~60-second scripted doctor–patient role-play that **code-switches Malay/English** (e.g. "Doctor, saya ada fever dah tiga hari, batuk kering, and my throat sakit bila telan…"). Export as **16 kHz mono WAV** to `apps/native/assets/sample-consult.wav`. This single clip is the fixed input for every benchmark run so numbers are comparable.

- [ ] **Step 2: Write the metrics module**

Create `apps/native/spike/metrics.ts`:

```typescript
import * as FileSystem from "expo-file-system";

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
```

- [ ] **Step 3: Write the sample data + prompt module**

Create `apps/native/spike/sampleData.ts`:

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
git add apps/native/spike/metrics.ts apps/native/spike/sampleData.ts apps/native/assets/sample-consult.wav
git commit -m "test(spike): add sample consult, seeded-PII fixture, and metrics harness"
```

---

## Task 3: STT benchmark (Whisper, multilingual)

**Files:**

- Create: `apps/native/spike/sttBench.ts`

- [ ] **Step 1: Write the STT benchmark runner**

Create `apps/native/spike/sttBench.ts`. It loads the multilingual Whisper model, transcribes the bundled clip, and times it. (Hook usage per `react-native-executorch`: `useSpeechToText` exposes `.transcribe(audioBuffer, opts)` and `.isReady`.)

```typescript
import { AudioContext } from "react-native-audio-api";
import { Asset } from "expo-asset";
import { timed, StageMetric } from "./metrics";

const STT_GO_MS = 90_000; // 60s clip must transcribe in <= 90s

// Resolve the bundled wav to a local file uri the AudioContext can decode.
// expo-asset downloads the bundled asset to the local cache and exposes localUri.
async function sampleUri(): Promise<string> {
  const asset = Asset.fromModule(require("../assets/sample-consult.wav"));
  await asset.downloadAsync();
  return asset.localUri ?? asset.uri;
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
git add apps/native/spike/sttBench.ts
git commit -m "feat(spike): on-device Whisper STT benchmark runner"
```

---

## Task 4: LLM benchmark (local SOAP generation)

**Files:**

- Create: `apps/native/spike/llmBench.ts`

- [ ] **Step 1: Write the LLM benchmark runner**

Create `apps/native/spike/llmBench.ts`. It is **runtime-agnostic on purpose** — it takes any object with a `generate(messages) => Promise<string>` method, so the same benchmark scores Gemma 4 (via LiteRT/RunAnywhere) and the Qwen3 baseline (via `react-native-executorch`, whose `useLLM` already exposes `.generate(messages)`). It feeds the fixed `SAMPLE_TRANSCRIPT`, produces a SOAP note, and times it + estimates tokens/sec.

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

- [ ] **Step 2: Provide a `generate()` for each candidate (bake-off)**

`runLlmBench` needs an object with `generate(messages)`. Wire candidates in this priority, feeding each into `runLlmBench` and recording its numbers:

- **Candidate A — Gemma 4 E4B (target).** Get the LiteRT/`.task` build of Gemma 4 E4B from Google AI Edge (Hugging Face / AI Edge) and run it through **MediaPipe LLM Inference** (or the RunAnywhere SDK if it exposes a Gemma/LiteRT backend). Wrap its call in a `generate(messages)` adapter that flattens the `Msg[]` into the model's prompt format and returns the full string. If RAM-constrained, try **E2B** first.
- **Candidate B — Qwen3-1.7B baseline (guaranteed).** `react-native-executorch`'s `useLLM({ model: QWEN3_1_7B_QUANTIZED })` already returns a `.generate(messages)`-shaped object — pass it straight in. This always yields a number so the spike never stalls waiting on the Gemma toolchain.

Run BOTH if you can; the decision doc compares them. Gemma 4 wins on multilingual (Malay) + future multimodal (Guardian); Qwen3 wins on "it runs in our existing runtime today." If Gemma 4 OOMs or has no working on-device build in the spike window, ship P0 on the baseline and keep Gemma 4 as the upgrade — record this explicitly.

- [ ] **Step 3: Commit**

```bash
git add apps/native/spike/llmBench.ts
git commit -m "feat(spike): on-device LLM SOAP-generation benchmark runner"
```

---

## Task 5: On-device PII/NER probe (the riskiest stage)

**Files:**

- Create: `apps/native/spike/nerBench.ts`

> **Honest framing:** OpenMed ships Hugging Face `transformers` models (PyTorch). There is no first-class React Native binding. This task is a _feasibility probe with a decision_, not a guaranteed integration. It tries the realistic on-device path and, if that path is not viable inside the spike window, records a concrete fallback. Either outcome is a valid spike result.

- [ ] **Step 1: Write a redaction-recall scorer (runtime-agnostic)**

Create `apps/native/spike/nerBench.ts`. The scorer is independent of how redaction is produced, so it works for whichever path Step 2 picks:

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
git add apps/native/spike/nerBench.ts
git commit -m "feat(spike): on-device PII redaction probe + recall scorer"
```

---

## Task 6: Benchmark screen + end-to-end run

**Files:**

- Create: `apps/native/spike/BenchmarkScreen.tsx`
- Modify: app entry to show `BenchmarkScreen` (record exact file in Step 1)

- [ ] **Step 1: Build the benchmark screen**

Create `apps/native/spike/BenchmarkScreen.tsx`. It loads both models via hooks, runs all stages, computes an end-to-end metric, and writes the JSON dump. This baseline wiring uses the **Qwen3 RN-ExecuTorch** path (always runs); to benchmark Gemma 4, replace `llm` with the LiteRT/RunAnywhere adapter from Task 4 Step 2 (same `.generate(messages)` shape — `runLlmBench(llm)` is unchanged) and re-run.

```tsx
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
  // Baseline LLM (always available). Swap for the Gemma 4 LiteRT/RunAnywhere adapter to benchmark the target.
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

| Stage                       | Model / Runtime                          | Median ms   | tokens/sec | recall | GO/NO-GO |
| --------------------------- | ---------------------------------------- | ----------- | ---------- | ------ | -------- |
| STT                         | WHISPER_SMALL (RN-ExecuTorch)            | …           | —          | —      | …        |
| LLM — target                | Gemma 4 E4B/E2B (LiteRT / RunAnywhere)   | …           | …          | —      | …        |
| LLM — baseline              | QWEN3_1_7B_QUANTIZED (RN-ExecuTorch)     | …           | …          | —      | …        |
| NER                         | <Path A or B>                            | …           | —          | …      | …        |
| E2E                         | —                                        | …           | —          | —      | …        |
| First-launch model download | —                                        | … (size MB) | —          | —      | note     |

## Decision

- Summarizer runtime chosen: **Google AI Edge / LiteRT** | **RunAnywhere** | **RN-ExecuTorch (baseline)** (with reason).
- Summarizer model locked for P0: **Gemma 4 E4B** | **Gemma 4 E2B** | **Qwen3-1.7B (fallback)** (with reason).
- STT: **WHISPER_SMALL on RN-ExecuTorch** (or note if STT moved to the same runtime as the LLM).
- Redaction path chosen: **A (ML NER)** | **B (deterministic)** (with reason + production gap noted).
- Two-runtime note: if STT stays on RN-ExecuTorch while the LLM runs on LiteRT/RunAnywhere, confirm both coexist in one dev-client build without conflict.

## If NO-GO on any stage — fallback taken

<e.g. Gemma 4 has no working on-device build in window → ship P0 on Qwen3 baseline, Gemma 4 as upgrade; or smaller LLM / streaming STT for perceived latency>

## Implications for the P0 plan

<e.g. "cloud Claude is the default summarizer; local LLM is the offline toggle only" if local LLM is too slow for primary use>
```

- [ ] **Step 2: Decide the summarizer runtime explicitly (3-way)**

- If **Gemma 4 E4B/E2B is GO** on LiteRT or RunAnywhere (meets thresholds, coexists with Whisper STT) → lock it. This is the preferred outcome (Malay + multimodal future).
- If Gemma 4 has **no working on-device build / OOMs / misses thresholds** in the spike window → ship P0 on the **Qwen3-1.7B RN-ExecuTorch baseline** (a real number you already have) and file Gemma 4 as a fast-follow upgrade. Do NOT block P0 on the Gemma toolchain.
- Either way, record the exact builds tried (model file, runtime version) so the next engineer doesn't repeat dead ends.

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
