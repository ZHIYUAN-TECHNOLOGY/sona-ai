#!/usr/bin/env bash
# Phase-0 Mac bench setup — installs llama.cpp + whisper.cpp and pulls models.
# Runs on a Mac (Apple silicon ideal). No Xcode / phone needed.
# These give a DIRECTIONAL read; the real GO/NO-GO is the on-phone run.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p models audio

echo "==> Installing engines (Homebrew)…"
brew list llama.cpp   >/dev/null 2>&1 || brew install llama.cpp
brew list whisper-cpp >/dev/null 2>&1 || brew install whisper-cpp
command -v hf >/dev/null 2>&1 || brew install huggingface-cli

# --- Models -----------------------------------------------------------------
# NOTE: these are the upstream Qwen2.5 / Whisper builds — used for a directional
# performance number (speed is ~the same as the Malaysian fine-tunes of equal
# size/quant). Swap in the mesolitica GGUF/ggml builds when benching quality.
echo "==> Downloading LLM GGUF (q4_k_m)…"
hf download bartowski/Qwen2.5-7B-Instruct-GGUF   Qwen2.5-7B-Instruct-Q4_K_M.gguf   --local-dir models >/dev/null
hf download bartowski/Qwen2.5-1.5B-Instruct-GGUF Qwen2.5-1.5B-Instruct-Q4_K_M.gguf --local-dir models >/dev/null

echo "==> Downloading Whisper ggml…"
hf download ggerganov/whisper.cpp ggml-small.bin            --local-dir models >/dev/null
hf download ggerganov/whisper.cpp ggml-large-v3-turbo.bin   --local-dir models >/dev/null || true

# --- Audio sample -----------------------------------------------------------
# Real test = record a ~60s rojak consult to audio/consult-01.wav (16 kHz mono).
# Smoke-test fallback: synthesize a clip with macOS `say` so STT has something to run.
if [ ! -f audio/consult-01.wav ]; then
  echo "==> No audio/consult-01.wav found — generating a smoke-test clip with 'say' (English only)."
  echo "    For a real WER number, replace it with a recorded rojak clip (16 kHz mono wav)."
  say -o audio/consult-01.aiff "Patient has a cough and fever for three days, sore throat, and shortness of breath on exertion. Known type two diabetes on metformin." || true
  # convert to 16 kHz mono wav (whisper.cpp wants wav)
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -y -i audio/consult-01.aiff -ar 16000 -ac 1 audio/consult-01.wav >/dev/null 2>&1 || true
  else
    afconvert -f WAVE -d LEI16@16000 -c 1 audio/consult-01.aiff audio/consult-01.wav || true
  fi
fi

echo "==> Done. Now run:  node bench.mjs"
