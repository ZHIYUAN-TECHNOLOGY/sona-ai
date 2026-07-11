# Going fully real: on-device speaker diarization

The diarization pipeline (cluster → role → enroll → moat) is production code. Two stages
have a **real** implementation already wired, plus a **mock** stand-in that keeps the app
running until you drop in a neural model:

| Stage | Real (wired) | Mock stand-in |
|---|---|---|
| VAD (speech regions) | ✅ `vad.ts` — ExecuTorch FSMN-VAD (`detectSpeech`) | — |
| Feature frontend | ✅ `features.ts` — log-mel fbank (real DSP) | — |
| Speaker embedding | ✅ `executorchEmbedder.ts` — runs an ECAPA `.pte` | `mockEmbedder.ts` (Goertzel band-energy) |
| Cluster / role / enroll | ✅ real, model-agnostic | — |
| Audio source | mic PCM (react-native-audio-api, wired for consult) | synth window keyed to speaker |

To flip the embedder from mock → real, you provide **one file**: a speaker-embedding model
exported to ExecuTorch `.pte`. ExecuTorch is already linked (LLM, STT, text embeddings), so
**no new native module** is added — this avoids the precompiled-RN link failures we hit with
react-native-svg / skia.

## 1. Pick a speaker model

Any small speaker-embedding net works. Good open ones:

- **ECAPA-TDNN** (SpeechBrain `spkrec-ecapa-voxceleb`) — 192-dim, ~20 MB, strong.
- **CAM++** (3D-Speaker / WeSpeaker) — 192-dim, lighter, mobile-friendly.
- **x-vector** — smaller, older, fine as a baseline.

## 2. Export to ExecuTorch `.pte`

Roughly (see the ExecuTorch export docs for your torch version):

```python
import torch
from executorch.exir import to_edge
from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner

model = load_ecapa().eval()                 # your nn.Module, fbank-in → 192-d out
example = torch.randn(1, 300, 80)           # [batch, frames, mel]  (or raw waveform)
exported = torch.export.export(model, (example,))
edge = to_edge(exported).to_backend(XnnpackPartitioner())
open("ecapa_tdnn_xnnpack.pte", "wb").write(edge.to_executorch().buffer)
```

Decide the **input contract** and match it in the config below:
- **fbank** (most speaker nets): `inputKind: "fbank"`, `numMel: 80`. `features.ts` produces
  `[frames × mel]`; if your graph wants `[mel × frames]`, transpose inside the export.
- **raw waveform** (frontend baked into the graph): `inputKind: "waveform"`.

The output must be a single float embedding tensor (e.g. 192-d); we L2-normalize it.

## 3. Host or bundle the `.pte`

- **Remote** (auto-download, cached): upload to Hugging Face / any HTTPS host, use the URL.
- **Bundled**: put it in `assets/` and `require()` it.

## 4. Fill in `speakerModel.ts`

```ts
export const SPEAKER_MODEL: ExecutorchEmbedderConfig = {
  id: "ecapa-tdnn-192",
  dim: 192,
  inputKind: "fbank",   // or "waveform"
  numMel: 80,
  modelSource: "https://your-host/ecapa_tdnn_xnnpack.pte", // or require("../../assets/ecapa.pte")
};
```

`initSpeakerModel()` (called at app start) loads it and registers it as the active embedder.
On any failure it keeps the mock — the app never crashes. Settings → On-device AI →
**Diarization** shows the active model id (`mock-goertzel-bands` vs `ecapa-tdnn-192`).

## 5. Wire real mic audio per segment (Stage 2)

Today the recording hook embeds a synth window keyed to the speaker. For real audio:

1. Capture the consult with react-native-audio-api into a Float32Array @ 16 kHz (already
   wired for the consult path).
2. `const segs = await detectSpeech(waveform)` — real VAD.
3. `const windows = sliceSegments(waveform, segs)` — per-speech-region PCM.
4. Embed each window with the active embedder → cluster → role. (Align to STT text by
   timestamp.)

Then rebuild (`rm -rf ios/build && npx expo run:ios`) so the `.pte` links. First launch
downloads the model once, then everything runs offline.

## Moat

Audio and voiceprints are biometric PHI. The model runs **on-device**; audio, features, and
voiceprints never leave the phone. The enrolled clinician voiceprint persists only in the
local `doctor_voiceprint` table. Never log/export a voiceprint.
