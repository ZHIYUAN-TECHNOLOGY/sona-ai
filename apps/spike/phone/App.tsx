// Sona on-device spike — Phase 1 (real phone).
// Benches the LLM (the gating risk) via RunAnywhere: download → load → generate a
// SOAP note ×5, measure tok/s + latency + stability, score vs thresholds, write results.json.
// Optional voice test exercises the STT→LLM pipeline.
//
// RUN INSIDE RunAnywhere AI Studio (not Expo Go). See README.md.

import React, { useState, useCallback } from "react";
import { SafeAreaView, ScrollView, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import RNFS from "react-native-fs";
import { RunAnywhere, SDKEnvironment } from "@runanywhere/core";
import { LlamaCPP } from "@runanywhere/llamacpp";
import { ONNX } from "@runanywhere/onnx";
import { registerModels, MODEL_IDS, LLM_SIZE } from "./src/models";

// GO/NO-GO gates (mirror of ../thresholds.json)
const T = { maxSecondsSoap: 30, minTokensPerSec: 6, e2eRuns: 5, maxE2ESeconds: 90 };

// De-identified consult-01 (PII already stripped — what the LLM actually receives).
const TRANSCRIPT = `[Doctor] Okay [PATIENT], apa yang boleh saya bantu hari ni?
[Patient] Doctor, saya ada batuk dah tiga hari, and fever also. 喉咙很痛。
[Doctor] Demam tinggi tak? Any shortness of breath?
[Patient] Sikit-sikit la doctor, especially bila naik tangga.
[Wife] அவருக்கு இரவில தூக்கம் வரல, cannot sleep properly.
[Doctor] [PATIENT], [AGE] tahun. History kencing manis, on metformin 500 dua kali sehari, atorvastatin 10mg malam. Penicillin allergy.
[Doctor] Temp 38.2. Throat sikit merah, no pus. Chest ada sikit rhonchi. BP 148 over 92. SpO2 98 percent.
[Doctor] Looks like viral URTI. Paracetamol satu gram empat kali sehari kalau demam. Banyak minum air, rest. Continue metformin. MC dua hari. Datang balik kalau sesak teruk or fever lebih tiga hari.`;

const PROMPT =
  "You are a clinical scribe. From the consult transcript, write a concise SOAP note " +
  "(Subjective, Objective, Assessment with ICD-10 codes, Plan). Extract medication doses verbatim; never invent doses.\n\n" +
  "TRANSCRIPT:\n" + TRANSCRIPT + "\n\nSOAP NOTE:\n";

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<{ k: string; v: string; pass?: boolean | null }[]>([]);
  const say = (s: string) => setLog((L) => [...L, s]);

  const init = useCallback(async () => {
    setBusy(true);
    try {
      say("init SDK…");
      await RunAnywhere.initialize({ environment: SDKEnvironment.Development });
      LlamaCPP.register();
      ONNX.register();
      await registerModels();
      say("registered models ✓");
    } catch (e: any) { say("ERROR init: " + e.message); }
    setBusy(false);
  }, []);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const info = await RunAnywhere.getModelInfo(MODEL_IDS.llm);
      if (!info?.localPath) {
        say(`downloading ${MODEL_IDS.llm}…`);
        await RunAnywhere.downloadModel(MODEL_IDS.llm, (p: any) =>
          setLog((L) => [...L.slice(0, -1), `download ${Math.round(p.progress * 100)}%`]));
      }
      say("model on device ✓");
    } catch (e: any) { say("ERROR download: " + e.message); }
    setBusy(false);
  }, []);

  const runBench = useCallback(async () => {
    setBusy(true);
    setRows([]);
    try {
      const info = await RunAnywhere.getModelInfo(MODEL_IDS.llm);
      if (!info?.localPath) { say("download first."); setBusy(false); return; }
      say("loading model…");
      await RunAnywhere.loadModel(info.localPath);

      const times: number[] = [], tpsArr: number[] = [];
      let lastNote = "";
      for (let i = 0; i < T.e2eRuns; i++) {
        const t0 = Date.now();
        let tokens = 0, text = "";
        const s = await RunAnywhere.generateStream(PROMPT, { maxTokens: 512, temperature: 0.3 });
        for await (const tok of s.stream) { tokens++; text += tok; }
        await s.result;
        const sec = (Date.now() - t0) / 1000;
        times.push(sec); tpsArr.push(tokens / sec); lastNote = text;
        say(`run ${i + 1}/${T.e2eRuns}: ${sec.toFixed(1)}s · ${(tokens / sec).toFixed(1)} tok/s`);
      }
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const soapSec = avg(times), tps = avg(tpsArr), worst = Math.max(...times);
      const passLLM = tps >= T.minTokensPerSec && soapSec <= T.maxSecondsSoap;
      const passE2E = worst <= T.maxE2ESeconds;

      const out = [
        { k: `LLM (${LLM_SIZE})`, v: `${tps.toFixed(1)} tok/s · ~${soapSec.toFixed(0)}s`, pass: passLLM },
        { k: `E2E ×${T.e2eRuns}`, v: `worst ${worst.toFixed(0)}s · 0 crash`, pass: passE2E },
        { k: "Peak RAM", v: "read from Xcode gauge ↓", pass: null },
      ];
      setRows(out);

      const results = {
        model: MODEL_IDS.llm, size: LLM_SIZE,
        llm: { tokensPerSec: +tps.toFixed(2), soapSeconds: +soapSec.toFixed(1), worstSeconds: +worst.toFixed(1), runs: times },
        ram: { peakGB: null, note: "RN can't read RSS reliably — record peak from Xcode Debug memory gauge / Instruments." },
        pii: { recall: null, note: "measure OpenMed separately (ONNX); fast/low-risk." },
        verdict: passLLM && passE2E ? "GO (Phase 1, this size) — confirm RAM in Xcode" : "NEEDS WORK / try 1.5b or q3",
        sampleNote: lastNote.slice(0, 1200),
      };
      const path = RNFS.DocumentDirectoryPath + "/results.json";
      await RNFS.writeFile(path, JSON.stringify(results, null, 2), "utf8");
      say("VERDICT: " + results.verdict);
      say("results.json → " + path);
      await RunAnywhere.unloadModel();
    } catch (e: any) { say("ERROR bench: " + e.message); }
    setBusy(false);
  }, []);

  return (
    <SafeAreaView style={st.s}>
      <Text style={st.h}>Sona · on-device spike</Text>
      <Text style={st.sub}>Phase 1 · {LLM_SIZE} · airplane-mode after download</Text>
      <View style={st.bar}>
        <Btn t="1 · Init" on={init} d={busy} />
        <Btn t="2 · Download" on={download} d={busy} />
        <Btn t="3 · Run bench" on={runBench} d={busy} primary />
      </View>
      {rows.length > 0 && (
        <View style={st.table}>
          {rows.map((r) => (
            <View key={r.k} style={st.row}>
              <Text style={st.k}>{r.k}</Text>
              <Text style={st.v}>{r.v}</Text>
              <Text style={[st.mark, { color: r.pass == null ? "#999" : r.pass ? "#2b6c46" : "#c0362c" }]}>
                {r.pass == null ? "—" : r.pass ? "✓" : "✗"}
              </Text>
            </View>
          ))}
        </View>
      )}
      <ScrollView style={st.logBox}>{log.map((l, i) => <Text key={i} style={st.log}>{l}</Text>)}</ScrollView>
    </SafeAreaView>
  );
}

function Btn({ t, on, d, primary }: { t: string; on: () => void; d: boolean; primary?: boolean }) {
  return (
    <TouchableOpacity disabled={d} onPress={on} style={[st.btn, primary && st.btnP, d && { opacity: 0.4 }]}>
      <Text style={[st.btnT, primary && { color: "#fff" }]}>{t}</Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  s: { flex: 1, backgroundColor: "#f8f4ef", padding: 18 },
  h: { fontSize: 22, fontWeight: "700", color: "#1c1a17" },
  sub: { fontSize: 12, color: "#6b6459", marginBottom: 16 },
  bar: { flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  btn: { borderWidth: 1, borderColor: "#e7ddd0", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "#fffdfa" },
  btnP: { backgroundColor: "#126dec", borderColor: "#126dec" },
  btnT: { fontWeight: "700", color: "#1c1a17", fontSize: 13 },
  table: { backgroundColor: "#fffdfa", borderRadius: 12, borderWidth: 1, borderColor: "#e7ddd0", padding: 8, marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0e8dc" },
  k: { width: 90, fontSize: 12, color: "#6b6459" },
  v: { flex: 1, fontSize: 13, fontWeight: "600", color: "#1c1a17" },
  mark: { width: 20, fontSize: 16, fontWeight: "700", textAlign: "center" },
  logBox: { flex: 1, backgroundColor: "#16140f", borderRadius: 12, padding: 12 },
  log: { color: "#bfe8cf", fontFamily: "Menlo", fontSize: 11, marginBottom: 3 },
});
