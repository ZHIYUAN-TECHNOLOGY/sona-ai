"""Which voiceprint (speaker embedding) model tells people apart, on whole clips and on their first 3 s.

Voices: the one real person (15 clips, 08-12 in a low register), the 20 synthetic voices of build.clips(), and real
strangers from ASCEND (CAiRE/ASCEND, Mandarin-English code-switched conversation, CC BY-SA 4.0; three small shards are
fetched once). 12 clips of 3.5 s or more per voice, and the cosine between every two clips.

Five tests, each two clips of one voice (same) against two clips of two voices (different):

  all       every voice. Different is two voices of one kind, or the real person against anyone (synthetic against
            ASCEND is left out: too easy). The synthetic voices sound alike, so they set this test's threshold.
  people    ASCEND speakers only: real strangers, one corpus.
  clean     people, without the clips the model itself places nearer another speaker than their own (cross-talk or a
            wrong label; nobody listened). Each model drops its own, so this flatters it: read it beside people.
  patient   the real person against everyone else: "is this turn the patient".
  tts       synthetic voices only: one text-to-speech voice against the other 19. Not a test of a voice drifting.

Per model, length and test: equal error rate, then the share of same pairs caught at the threshold that wrongly joins
1% of different pairs (caught@threshold). cross is the real person's low register against the high one, the hard
same-person case: the share caught at the all, clean and patient thresholds. CPU ms per 3 s clip, 4 threads.

  ~/zyt/venvs/voiceprint/bin/python tools/diar-eval/voiceprint.py     # writes ~/zyt/data/sona-diar/voiceprint.json

Its own venv (not diar's, whose transformers is pinned): torch torchaudio librosa soundfile scipy numpy onnxruntime
speechbrain transformers huggingface_hub pyarrow. Weights and ASCEND shards land in ~/zyt/data/sona-diar/voiceprint.
"""
import io, json, random, sys, time, urllib.request
from pathlib import Path

import librosa, numpy as np, onnxruntime as ort, pyarrow.parquet as pq, soundfile as sf, torch
import torchaudio.compliance.kaldi as kaldi
from huggingface_hub import hf_hub_download, snapshot_download

sys.path.insert(0, str(Path(__file__).parent))
import build

SR, PER, MIN_S, CUT_S = 16000, 12, 3.5, 3
DATA = Path.home() / "zyt/data/sona-diar/voiceprint"
OUT = Path.home() / "zyt/data/sona-diar/voiceprint.json"
CAMPP = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
TESTS = ["all", "people", "clean", "patient", "tts"]
torch.set_num_threads(4)


def size_mb(p): return round(sum(f.stat().st_size for f in ([Path(p)] if Path(p).is_file() else Path(p).rglob("*")) if f.is_file()) / 1e6)


def onnx(path, scale, window):
    """A Kaldi-fbank ONNX model: 80 mel bins, mean taken off over the clip. scale and window are each toolkit's own."""
    o = ort.SessionOptions(); o.intra_op_num_threads = 4
    s = ort.InferenceSession(str(path), o, providers=["CPUExecutionProvider"])
    def embed(x):
        f = kaldi.fbank(torch.from_numpy(x)[None] * scale, num_mel_bins=80, dither=0.0, sample_frequency=SR, window_type=window)
        return s.run(None, {s.get_inputs()[0].name: (f - f.mean(0))[None].numpy()})[0][0]
    return embed, size_mb(path)


def wavlm():
    from transformers import AutoFeatureExtractor, WavLMForXVector
    d = snapshot_download("microsoft/wavlm-base-plus-sv", allow_patterns=["*.json", "pytorch_model.bin"])
    fe, m = AutoFeatureExtractor.from_pretrained(d), WavLMForXVector.from_pretrained(d).eval()
    return lambda x: m(**fe(x, sampling_rate=SR, return_tensors="pt")).embeddings[0].numpy(), size_mb(Path(d))


def ecapa():
    from speechbrain.inference.speaker import EncoderClassifier
    m = EncoderClassifier.from_hparams("speechbrain/spkrec-ecapa-voxceleb", savedir=str(DATA / "models/ecapa"), run_opts={"device": "cpu"})
    return lambda x: m.encode_batch(torch.from_numpy(x)[None])[0, 0].numpy(), size_mb(DATA / "models/ecapa")


def wespeaker():
    return onnx(hf_hub_download("Wespeaker/wespeaker-voxceleb-resnet34-LM", "voxceleb_resnet34_LM.onnx", local_dir=DATA / "models"), 32768, "hamming")


def campplus():
    p = DATA / "models/campplus_zh_en_advanced.onnx"
    if not p.exists(): p.parent.mkdir(parents=True, exist_ok=True); urllib.request.urlretrieve(CAMPP, p)
    return onnx(p, 1, "povey")


MODELS = {  # name: (loader, licence as its model card states it)
    "wavlm-base-plus-sv (baseline)": (wavlm, "none stated on the card"),
    "speechbrain ecapa-voxceleb": (ecapa, "Apache-2.0"),
    "wespeaker resnet34-LM (onnx)": (wespeaker, "CC-BY-4.0"),
    "3D-Speaker CAM++ zh-en (onnx)": (campplus, "Apache-2.0"),
}


def voices(rng):
    """[(kind, voice, low register?, samples)]: real person, synthetic voices, ASCEND speakers."""
    out, by = [], build.clips()
    for w, _ in by.pop(build.REAL): out.append(("real", "real", w.stem in {"08", "09", "10", "11", "12"}, sf.read(w, dtype="float32")[0]))
    for v, cs in sorted(by.items()):
        ws = [w for w, _ in cs]; rng.shuffle(ws)
        got = [x for x in (sf.read(w, dtype="float32")[0] for w in ws[:PER * 4]) if len(x) >= MIN_S * SR][:PER]
        out += [("syn", v, False, x) for x in got]
    rows = []
    for shard in ["test-00000-of-00001", "validation-00000-of-00001", "train-00000-of-00003"]:
        t = pq.read_table(hf_hub_download("CAiRE/ASCEND", f"main/{shard}.parquet", repo_type="dataset", local_dir=DATA / "ascend"))
        keep = [i for i, d in enumerate(t.column("duration").to_pylist()) if d >= MIN_S]
        rows += t.take(keep).select(["audio", "original_speaker_id"]).to_pylist()
    rng.shuffle(rows)
    for spk in sorted({r["original_speaker_id"] for r in rows}):
        mine = [r for r in rows if r["original_speaker_id"] == spk][:PER]
        if len(mine) < PER: continue
        for r in mine:
            x, sr = sf.read(io.BytesIO(r["audio"]["bytes"]), dtype="float32")
            out.append(("asc", f"asc{spk}", False, x if sr == SR else librosa.resample(x, orig_sr=sr, target_sr=SR)))
    return out


def eer(p, n):
    t = np.unique(np.concatenate([p, n]))
    miss, join = np.searchsorted(np.sort(p), t) / len(p), 1 - np.searchsorted(np.sort(n), t) / len(n)
    k = np.argmin(np.abs(miss - join))
    return float((miss[k] + join[k]) / 2)


def score(E, kind, voice, low):
    E = E / np.linalg.norm(E, axis=1, keepdims=True)
    i, j = np.triu_indices(len(E), 1)
    S = E @ E.T
    s, same, ki, kj = S[i, j], voice[i] == voice[j], kind[i], kind[j]
    # An ASCEND clip nearer (median) to another speaker than to its own: cross-talk or a wrong label. Not listened to.
    near = lambda k, v: np.median(S[k][(voice == v) & (np.arange(len(E)) != k)])
    odd = np.array([kind[k] == "asc" and near(k, voice[k]) < max(near(k, v) for v in set(voice[kind == "asc"]) - {voice[k]}) for k in range(len(E))])
    cross, real = same & (low[i] != low[j]), (ki == "real") | (kj == "real")
    def test(m, also=()):
        p, n = s[same & m], s[~same & m]
        thr = float(np.quantile(n, 0.99))
        return {"eer": eer(p, n), "thr": thr, "caught": float((p > thr).mean()), "cross_caught": float((s[cross] > thr).mean()),
                "same_median": float(np.median(p)), "different_median": float(np.median(n)), "pairs": [len(p), len(n)]}
    return {"all": test((ki == kj) | real), "people": test((ki == "asc") & (kj == "asc")), "clean": test((ki == "asc") & (kj == "asc") & ~odd[i] & ~odd[j]),
            "patient": test(real), "odd_clips": int(odd.sum()),
            "tts": test((ki == "syn") & (kj == "syn")), "cross_median": float(np.median(s[cross])), "cross_min": float(s[cross].min())}


def main():
    assert eer(np.array([.9, .8]), np.array([.1, .2])) == 0 and eer(np.array([.1, .9]), np.array([.1, .9])) == .5
    vs = voices(random.Random(0))
    kind, voice, low = (np.array(c) for c in zip(*[v[:3] for v in vs]))
    print(f"{len(vs)} clips: {len(set(voice[kind == 'syn']))} synthetic voices, {len(set(voice[kind == 'asc']))} ASCEND speakers, 1 real person", flush=True)
    res = {}
    with torch.no_grad():
        for name, (load, licence) in MODELS.items():
            embed, mb = load()
            x3 = vs[0][3][:CUT_S * SR]; embed(x3); embed(x3)
            ms = []
            for _ in range(10): t = time.perf_counter(); embed(x3); ms.append((time.perf_counter() - t) * 1000)
            res[name] = {"licence": licence, "mb": mb, "cpu_ms_3s": round(float(np.median(ms)), 1),
                         "full": score(np.stack([embed(v[3]) for v in vs]), kind, voice, low),
                         "3s": score(np.stack([embed(v[3][:CUT_S * SR]) for v in vs]), kind, voice, low)}
            r = res[name]
            for cut in ["full", "3s"]:
                c = r[cut]
                print(f"{name:30} {mb:4d} MB {r['cpu_ms_3s']:6.1f} ms {cut:4} " + " ".join(f"{k} {c[k]['eer']:5.1%} {c[k]['caught']:4.0%}@{c[k]['thr']:.2f}" for k in TESTS)
                      + f"  cross {c['all']['cross_caught']:4.0%} {c['clean']['cross_caught']:4.0%} {c['patient']['cross_caught']:4.0%} odd {c['odd_clips']} (median {c['cross_median']:.2f} min {c['cross_min']:.2f})", flush=True)
    OUT.write_text(json.dumps(res, indent=1))
    print("pairs same/different", {k: res[name]["full"][k]["pairs"] for k in TESTS}, "->", OUT)


if __name__ == "__main__":
    main()
