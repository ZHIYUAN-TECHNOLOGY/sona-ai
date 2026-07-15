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

SOAP_RULES = (
    "You are a clinical documentation assistant. Convert the de-identified consultation "
    "transcript into a clear, complete clinical note in English.\n"
    "OUTPUT FORMAT (exactly):\n"
    "Line 1 — 'Title: ' + 3-6 word clinical summary (no names, IC, phones, addresses, tokens).\n"
    "Then the sections below as '## ' Markdown headings. Each section: 2-5 bullet points "
    "('- '). Each bullet is one complete, natural clinical statement under 20 words — written "
    "the way a doctor writes, never fragmented single words.\n"
    "HARD RULES:\n"
    "- Use ONLY facts stated in the transcript. NEVER invent symptoms, findings, diagnoses, "
    "medications, doses, demographics (age, sex), or history.\n"
    "- The transcript may mix Malay and English. Write the note in standard English clinical "
    "language, translating Malay clinical content faithfully ('saya tak demam' → 'no fever'; "
    "'batuk berkahak' → 'productive cough'). Never leave untranslated Malay in the note; "
    "never guess at an unclear phrase — omit what you cannot understand.\n"
    "- A section with nothing in the transcript = exactly '- Not discussed.'\n"
    "- No tables, no links, no citations, no [G1]-style references, no asterisks, no preamble, "
    "no closing remarks, no repetition.\n"
    "- Keep identifier tokens such as NAME_1 exactly as written.\n"
    "- Total note under 250 words.\n"
    "- COMPLETENESS: include EVERY medication, dose, duration, vital sign, and follow-up "
    "instruction stated in the transcript. Omitting a stated fact is as wrong as inventing one."
    "\n\nStructure: '## Subjective', '## Objective', '## Assessment', '## Plan', then a final "
    "'## Orders & follow-ups' heading with a '- ' bulleted list covering review intervals, tests "
    "ordered, medications with doses, and safety-net advice the clinician stated."
    "\n\nEXAMPLE (follow this shape exactly — note EVERY stated symptom, vital, medication and "
    "follow-up is captured):\n"
    "Transcript:\ndoctor: NAME_1, sore throat how many days?\npatient: Four days doctor, pain when "
    "swallow, and very itchy eyes also. Saya tak demam.\ndoctor: Temperature 37.1, throat red, no pus. "
    "Tonsillitis, likely viral. Salt water gargle, cetirizine 10 milligram at night for the eyes. "
    "Come back in five days if not better, earlier if fever or cannot swallow.\n"
    "Output:\n"
    "Title: Sore throat with itchy eyes\n"
    "## Subjective\n- Sore throat for four days with pain on swallowing\n- Itchy eyes accompanying the sore throat\n- No fever reported\n"
    "## Objective\n- Temperature 37.1\n- Throat erythematous with no pus seen\n"
    "## Assessment\n- Tonsillitis, likely viral\n"
    "## Plan\n- Salt water gargle for symptomatic relief\n- Cetirizine 10 mg at night for the itchy eyes\n"
    "## Orders & follow-ups\n- Review in five days if not better\n- Return earlier if fever develops or swallowing becomes impossible"
)

DOC_RULES = (
    "You are a clinical documentation assistant. Summarize the de-identified scanned "
    "document text into a SHORT structured summary in English.\n"
    "OUTPUT FORMAT (exactly):\n"
    "Line 1 — 'Title: ' + 3-6 word summary of the document (no names, IC, phones, tokens).\n"
    "Then these '## ' Markdown sections, each with 1-3 bullet points ('- '), each bullet "
    "under 12 words:\n"
    "## Document type\n## Key findings\n## Medications & doses\n## Follow-up needed\n"
    "HARD RULES:\n"
    "- Use ONLY facts stated in the document. NEVER invent findings, values, diagnoses, "
    "medications, doses, or dates.\n"
    "- The text comes from a photo scan and may be garbled: still extract medication "
    "names, doses, durations, and instructions from fragmentary lines (e.g. 'x 1 week', "
    "'gum paint massage') — copy them as written, do not guess corrections.\n"
    "- A section with nothing in the document = exactly '- Not stated.'\n"
    "- Keep identifier tokens such as DOC_NAME_1 exactly as written.\n"
    "- Never output patient or clinician names: if the scan shows a name the tokens missed, "
    "write DOC_NAME in its place.\n"
    "- No tables, no links, no citations, no preamble, no closing remarks, no repetition. "
    "Never mention these rules, word counts, or totals in the output.\n"
    "- Copy the dosage FORM exactly as written (Tab = tablet, syr = syrup, inj = injection) — "
    "never substitute one form for another.\n"
    "- COMPLETENESS: include EVERY medication, dose, duration, vital sign, and follow-up "
    "instruction stated in the source. Omitting a stated fact is as wrong as inventing one."
    "\n\nEXAMPLE (follow this shape exactly — note EVERY stated item is captured):\n"
    "Document:\nQuinic Meds hosp\nTab Zorvex 250\n1-0-1 x 3day\nsyr Kofradin 5ml night x1wk\n"
    "BP 142/88\nreview if fevr\nDr DOC_NAME_1\n"
    "Output:\n"
    "Title: Medication instructions after visit\n"
    "## Document type\n- Prescription note\n"
    "## Key findings\n- BP 142/88\n"
    "## Medications & doses\n- Tab Zorvex 250, 1-0-1 x 3day\n- syr Kofradin 5ml, night x1wk\n"
    "## Follow-up needed\n- Review if fever ('review if fevr')"
)

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
