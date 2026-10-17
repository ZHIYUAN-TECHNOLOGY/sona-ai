#!/bin/sh
# Voice every script turn, then redo flagged clips as plain text until clean (at most 3 rounds).
set -e
PY=${PY:-python3}
A=${ASR_DATA_DIR:-$HOME/zyt/data/sona-asr}/audio
complete() { [ "$(ls "$A" | grep -c '\.wav$')" = "$(ls "$A" | grep -c '\.txt$')" ]; }
$PY voice.py poll && $PY voice.py all
complete || { echo "some turns still have no audio; stopping before the check"; exit 1; }
for round in 1 2 3; do
  out=$($PY check.py --delete 2>&1 | grep "^clips"); echo "round $round: $out"
  case "$out" in *"bad 0"*) break;; esac
  $PY voice.py all --plain
done
