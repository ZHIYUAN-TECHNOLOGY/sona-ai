"""A listening page comparing speak.py runs (each scored by score.py): the same sentences, one column per run, with the
word errors heard in each. Audio is embedded as MP3 (needs ffmpeg), so the page is one file to send.
Usage: python page.py out.html "Title" name=run_dir [name=run_dir ...]   (run_dir holds scored.jsonl and audio/)
"""
import base64, html, json, subprocess, sys
from pathlib import Path

out, title, runs = Path(sys.argv[1]), sys.argv[2], [a.split("=", 1) for a in sys.argv[3:]]
rows = {name: {r["key"]: r for r in map(json.loads, (Path(d) / "scored.jsonl").read_text().splitlines())} for name, d in runs}
names = [n for n, _ in runs]
SETS = {"ms_speak": "Malay", "manglish_speak": "Manglish", "en_speak": "English", "zh_speak": "Mandarin"}


def rate(name, s):
    rs = [r for r in rows[name].values() if r["set"] == s]
    return sum(r["err_resynth"] for r in rs) / max(1, sum(r["words"] for r in rs))


def mp3(wav):
    return base64.b64encode(subprocess.run(["ffmpeg", "-loglevel", "error", "-i", wav, "-b:a", "48k", "-f", "mp3", "-"],
                                           capture_output=True, check=True).stdout).decode()


summary = " · ".join(f"{label} " + " → ".join(f"{100 * rate(n, s):.1f}%" for n in names) for s, label in SETS.items())
cards = []
for s, label in SETS.items():
    for key in sorted(k for k, r in rows[names[0]].items() if r["set"] == s):
        cols = "".join(
            f"<div><span>{html.escape(n)} · {rows[n][key]['err_resynth']} wrong of {rows[n][key]['words']}</span>"
            f"<audio controls preload=none src=\"data:audio/mpeg;base64,{mp3(rows[n][key]['resynth'])}\"></audio>"
            f"<p>heard: {html.escape(rows[n][key]['hyp_resynth'])}</p></div>" for n in names if key in rows[n])
        cards.append(f"<section><h2>{label}</h2><p class=ref>{html.escape(rows[names[0]][key]['target'])}</p><div class=pair>{cols}</div></section>")

out.write_text(f"""<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title>
<style>:root{{--bg:#f7f8fb;--panel:#fff;--ink:#1f1f1f;--muted:#5b5e66;--line:#e3e6ec;--accent:#2563eb}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{--bg:#111318;--panel:#181b22;--ink:#edeef1;--muted:#a9adb6;--line:#2b2f39;--accent:#6b9bff}}}}
:root[data-theme=dark]{{--bg:#111318;--panel:#181b22;--ink:#edeef1;--muted:#a9adb6;--line:#2b2f39;--accent:#6b9bff}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,system-ui,sans-serif;padding:24px 16px}}main{{max-width:960px;margin:0 auto;display:grid;gap:14px}}
h1{{font-size:22px;margin:0}}h2{{font-size:13px;margin:0 0 4px;color:var(--accent);text-transform:uppercase;letter-spacing:.05em}}section{{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px}}
.ref{{margin:0 0 8px}}.pair{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}}.pair span{{font-size:12px;font-weight:600;color:var(--muted)}}.pair p{{margin:4px 0 0;font-size:13px;color:var(--muted)}}audio{{width:100%;margin-top:4px}}.sum{{color:var(--muted);margin:0}}</style></head><body><main>
<h1>{html.escape(title)}</h1><p class=sum>Same held-out sentences in Sona's cloned voice; word errors, speech against its own text ({" → ".join(map(html.escape, names))}): {summary}</p>
{"".join(cards)}</main></body></html>""")
print(out, f"{out.stat().st_size / 1e6:.1f} MB")
