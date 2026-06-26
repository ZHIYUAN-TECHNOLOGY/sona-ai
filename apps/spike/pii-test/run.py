#!/usr/bin/env python3
# PII / de-identification recall test for the Sona spike.
# Runs a de-id NER model over the raw rojak consult, checks it redacts the labelled
# identifiers (names, age, IC), scores recall vs ../fixtures/consult-01.pii.json.
# Gate: recall >= 0.90.
#
#   bash setup.sh        # one-time venv + deps
#   source .venv/bin/activate
#   python run.py
#
# MODEL: default is a well-known clinical de-id model so this runs out of the box.
# Swap MODEL_ID to the OpenMed privacy-filter for the production number.

import json, os, sys, re

MODEL_ID = os.environ.get("PII_MODEL", "obi/deid_roberta_i2b2")  # swap → OpenMed/<privacy-filter>
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "fixtures", "consult-01.raw.txt")
LABELS = os.path.join(HERE, "..", "fixtures", "consult-01.pii.json")
THRESH = 0.90

def main():
    try:
        from transformers import pipeline
    except ImportError:
        sys.exit("transformers not installed — run: bash setup.sh && source .venv/bin/activate")

    text = open(RAW, encoding="utf8").read()
    labels = json.load(open(LABELS, encoding="utf8"))["spans"]

    print(f"\n  PII recall test — model: {MODEL_ID}\n  loading…")
    ner = pipeline("token-classification", model=MODEL_ID, aggregation_strategy="simple")
    ents = ner(text)

    # NER-flagged character ranges
    ner_ranges = [(int(e["start"]), int(e["end"])) for e in ents if e.get("start") is not None]
    detected_words = " ".join(str(e.get("word", "")).lower() for e in ents)

    # Regex backstop for STRUCTURED identifiers (IC/MyKad, age, phone) that NER alone
    # misses — how every real de-id pipeline handles numeric IDs. Part of the Sona design.
    patterns = [r"\b\d{1,3}\s*tahun\b", r"\b\d{1,3}\s*(?:years?\s*old|y/?o)\b",
                r"\b\d{4,}\b", r"(?:IC|MyKad|NRIC|ending)\D{0,8}\d{3,}"]
    regex_ranges = [(m.start(), m.end()) for p in patterns for m in re.finditer(p, text, re.I)]

    def covered(span_text, ranges):
        lo = 0
        while True:
            i = text.find(span_text, lo)
            if i < 0:
                break
            j = i + len(span_text)
            if any(not (j <= s or i >= e) for s, e in ranges):
                return True
            lo = i + 1
        return False

    def score(ranges, use_words=False):
        caught, misses = 0, []
        for sp in labels:
            ok = covered(sp["text"], ranges) or (use_words and sp["text"].lower() in detected_words)
            (None if ok else misses.append(f'{sp["text"]} ({sp["type"]})'))
            caught += 1 if ok else 0
        return caught, misses

    n = len(labels) or 1
    ner_caught, _ = score(ner_ranges, use_words=True)
    comb_caught, comb_misses = score(ner_ranges + regex_ranges, use_words=True)
    ner_recall, recall = ner_caught / n, comb_caught / n
    pass_ = recall >= THRESH

    print(f"\n  flagged {len(ents)} NER entities + regex backstop")
    print(f"  NER-only recall  : {ner_caught}/{n} = {ner_recall:.2f}")
    print(f"  NER+regex recall : {comb_caught}/{n} = {recall:.2f}   gate ≥ {THRESH}   {'PASS ✓' if pass_ else 'FAIL ✗'}")
    if comb_misses:
        print("  missed : " + ", ".join(comb_misses))
    print()

    out = {"model": MODEL_ID, "labels": n, "ner_recall": round(ner_recall, 3),
           "combined_recall": round(recall, 3), "missed": comb_misses,
           "verdict": "PASS" if pass_ else "FAIL"}
    json.dump(out, open(os.path.join(HERE, "pii-results.json"), "w"), indent=2, ensure_ascii=False)
    print("  wrote pii-results.json\n")

if __name__ == "__main__":
    main()
