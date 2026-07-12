# Bundled on-device Whisper model

`ggml-malaysian-small.bin` (~181MB, gitignored) is the **Mesolitica Malaysian Whisper-small**
model — trained on Malay + Manglish + Mandarin + Tamil — converted to whisper.cpp `ggml` and
quantized `q5_1`. It ships inside the app (`metro.config.js` bundles `.bin`; `whisperStt.ts`
loads it via `require()`), so Malaysian speech-to-text runs **fully offline** — nothing downloads,
no audio leaves the device (the moat).

The file is gitignored (too large for git). It must be present at `assets/models/ggml-malaysian-small.bin`
for the app to build. Regenerate it with the steps below.

## Regenerate

```bash
# 1. Tooling (Python 3.12 via uv; whisper.cpp for convert + quantize)
uv venv --python 3.12 .venv && . .venv/bin/activate
uv pip install torch numpy "transformers>=4.40" huggingface_hub cmake
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git
git clone --depth 1 https://github.com/openai/whisper.git openai-whisper   # mel-filter assets
(cd whisper.cpp && cmake -B build -DWHISPER_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release && cmake --build build -j 8)

# 2. Download the source model (standard whisper-small arch, 80-mel, 12+12 layers)
python -c "from huggingface_hub import snapshot_download; \
  snapshot_download('mesolitica/malaysian-whisper-small-v3', local_dir='malaysian-whisper-small-v3', \
  allow_patterns=['*.json','*.safetensors','*.txt','vocab*','merges*','tokenizer*','normalizer*','preprocessor*'])"

# 3. Convert HF -> ggml f16. The weights are bfloat16, which numpy can't cast directly, so patch
#    the convert script to go through float32 first:
sed -i '' 's/list_vars\[src\]\.squeeze()\.numpy()/list_vars[src].squeeze().to(torch.float32).numpy()/g' \
  whisper.cpp/models/convert-h5-to-ggml.py
mkdir -p out-malaysian
python whisper.cpp/models/convert-h5-to-ggml.py ./malaysian-whisper-small-v3/ ./openai-whisper ./out-malaysian

# 4. Quantize f16 -> q5_1 (465MB -> 181MB) and validate it loads/transcribes
whisper.cpp/build/bin/whisper-quantize out-malaysian/ggml-model.bin out-malaysian/ggml-malaysian-small.bin q5_1
whisper.cpp/build/bin/whisper-cli -m out-malaysian/ggml-malaysian-small.bin -f whisper.cpp/samples/jfk.wav -l auto

# 5. Drop it into the app
cp out-malaysian/ggml-malaysian-small.bin apps/native/assets/models/ggml-malaysian-small.bin
```

## Notes
- Source: <https://huggingface.co/mesolitica/malaysian-whisper-small-v3> (whisper-small arch, 80-mel).
- whisper.rn loads it with `initWhisper({ filePath: require('...bin'), useGpu: true })` (Metal).
- To swap tiers (e.g. a `medium` model), convert that repo the same way and update `WHISPER_HIGH`
  in `lib/pipeline/whisperStt.ts`.
- Alternative to bundling: host the `.bin` and set `WHISPER_HIGH.url` instead of `.asset` — the
  engine already supports downloaded models (the Fast tier uses that path).
