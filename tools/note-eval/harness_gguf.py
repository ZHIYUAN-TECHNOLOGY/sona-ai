#!/usr/bin/env python3
"""GGUF-model trial via llama-server — same cases/prompts/scoring as harness.py.

Start the server first, e.g.:
  llama-server -m Ternary-Bonsai-8B-Q2_0.gguf --port 8090 -ngl 99 -c 4096
Then:
  python3 harness_gguf.py --tag bonsai8b --port 8090

Writes out_<tag>.json (score with score.py). Prompts are imported from
harness.py so the app-prompt mirror stays single-source.
"""
import argparse, json, os, time, urllib.request

from prompts import DOC_RULES, SOAP_RULES


def chat(port: int, system: str, user: str, timeout: int = 300) -> str:
    body = json.dumps(
        {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.15,
            "top_p": 0.9,
            "max_tokens": 400,
        }
    ).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)["choices"][0]["message"]["content"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--port", type=int, default=8090)
    args = ap.parse_args()

    cases = json.load(open(os.path.join(os.path.dirname(__file__), "cases.json")))
    rows = []
    for c in cases:
        system = DOC_RULES if c["kind"] == "doc" else SOAP_RULES
        user = (
            f"Document (detected type: Document):\n{c['input']}\n/no_think"
            if c["kind"] == "doc"
            else f"{c['input']}\n/no_think"
        )
        t0 = time.time()
        try:
            text = chat(args.port, system, user)
        except Exception as e:
            text = f"<ERROR {e}>"
        rows.append({**c, "output": text.strip(), "secs": round(time.time() - t0, 1)})
        print(f"[{args.tag}] {c['id']} done ({rows[-1]['secs']}s)", flush=True)

    out = os.path.join(os.path.dirname(__file__), f"out_{args.tag}.json")
    json.dump(rows, open(out, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
