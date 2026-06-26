#!/usr/bin/env bash
# One-time setup for the PII recall test. Uses a venv (avoids PEP-668 system-pip block).
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate
pip install -q -U pip
pip install -q "transformers>=4.40" "torch" "sentencepiece"
echo "==> Done. Now run:  source .venv/bin/activate && python run.py"
