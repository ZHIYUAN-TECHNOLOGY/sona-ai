"""Local side-by-side demo: record or upload speech, see base Qwen3-ASR and the fine-tuned model's transcripts.

python demo.py [fine-tuned model path or HF id]   then open http://127.0.0.1:7860
"""
import sys, torch, librosa, gradio as gr
from qwen_asr import Qwen3ASRModel
from voice import DATA

tuned = sys.argv[1] if len(sys.argv) > 1 else str(DATA / "ckpt" / "mixed-final")
models = {name: Qwen3ASRModel.from_pretrained(path, dtype=torch.float32, device_map="mps")
          for name, path in (("base", "Qwen/Qwen3-ASR-1.7B"), ("tuned", tuned))}

def transcribe(path):
    if not path: return "", ""
    x = librosa.load(path, sr=16000)[0]
    out = [models[k].transcribe((x, 16000))[0].text for k in ("base", "tuned")]
    torch.mps.empty_cache()
    return tuple(out)

gr.Interface(transcribe, gr.Audio(sources=["microphone", "upload"], type="filepath", label="Speak or upload (best under 30 s)"),
             [gr.Textbox(label="Base Qwen3-ASR-1.7B"), gr.Textbox(label="Fine-tuned (sona-qwen3-asr-manglish)")],
             title="Sona Manglish ASR", flagging_mode="never").launch(server_name="127.0.0.1")
