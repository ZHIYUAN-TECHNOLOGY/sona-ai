#!/usr/bin/env python3
"""Note-model trial harness — the swap gate for NOTE_MODEL (see docs/model-roadmap.md).

Runs the app's EXACT prompts (mirrored from lib/pipeline/templates.ts and
lib/vision/docSummary.ts — keep in sync when those change) over the gold cases
and writes out_<tag>.json for score.py.

  python3 harness.py --model Qwen/Qwen3-1.7B --tag q17b
  python3 harness.py --model aisingapore/Gemma-SEA-LION-v4-4B-VL --tag sealion

Rules this harness enforces by existing (memory: model-swaps-trial-first):
  1. No NOTE_MODEL swap without this trial passing vs the incumbent.
  2. A Mac bf16 pass is NECESSARY, NOT SUFFICIENT — the device-quantized runtime
     must pass the same cases before the swap ships (Qwen3-4B lesson, Jul 2026).
"""
import argparse, json, os, re, time

import torch
from transformers import AutoConfig, AutoProcessor, AutoTokenizer

# --- App prompts (verbatim mirrors) -------------------------------------------------

from prompts import SOAP_RULES, DOC_RULES  # noqa: F401

# --- Runner --------------------------------------------------------------------------

def load_model(repo: str, device: str):
    cfg = AutoConfig.from_pretrained(repo)
    arch = (cfg.architectures or [""])[0]
    if "ConditionalGeneration" in arch or "ImageText" in arch:
        # VL checkpoints (Gemma3/SEA-LION-VL): text-only chat via the processor.
        from transformers import AutoModelForImageTextToText
        model = AutoModelForImageTextToText.from_pretrained(repo, dtype=torch.bfloat16).to(device)
        tok = AutoProcessor.from_pretrained(repo)
        return model, tok, True
    from transformers import AutoModelForCausalLM
    model = AutoModelForCausalLM.from_pretrained(repo, dtype=torch.bfloat16).to(device)
    tok = AutoTokenizer.from_pretrained(repo)
    return model, tok, False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--temp", type=float, default=0.15)
    args = ap.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    cases = json.load(open(os.path.join(os.path.dirname(__file__), "cases.json")))
    model, tok, is_vl = load_model(args.model, device)
    model.eval()
    print(f"model={args.model} device={device} vl={is_vl}", flush=True)

    rows = []
    for c in cases:
        system = DOC_RULES if c["kind"] == "doc" else SOAP_RULES
        user = (
            f"Document (detected type: Document):\n{c['input']}\n/no_think"
            if c["kind"] == "doc"
            else f"{c['input']}\n/no_think"
        )
        msgs = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        if is_vl:
            msgs = [
                {"role": m["role"], "content": [{"type": "text", "text": m["content"]}]}
                for m in msgs
            ]
        enc = tok.apply_chat_template(
            msgs, tokenize=True, add_generation_prompt=True,
            return_dict=True, return_tensors="pt",
        )
        enc = {k: v.to(device) for k, v in enc.items()}
        t0 = time.time()
        with torch.no_grad():
            out = model.generate(
                **enc, max_new_tokens=320, do_sample=True, temperature=args.temp,
                top_p=0.9, repetition_penalty=1.3,
            )
        text = tok.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True) \
            if not is_vl else tok.tokenizer.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True)
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
        rows.append({**c, "output": text, "secs": round(time.time() - t0, 1)})
        print(f"[{args.tag}] {c['id']} done ({rows[-1]['secs']}s)", flush=True)

    out_path = os.path.join(os.path.dirname(__file__), f"out_{args.tag}.json")
    json.dump(rows, open(out_path, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
