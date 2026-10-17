"""MiniCPM-o 4.5's speech decoder (CosyVoice2 S3 tokens, then flow + HiFT) without CUDA.

stepaudio2's Token2wav, which MiniCPM-o's init_tts() loads, hard-codes CUDA; this is its non-streaming path on CPU, with
the same call, so it can also stand in as model.tts.audio_tokenizer. Needs `minicpmo-utils[tts]==1.0.6`.
"""
import io

import librosa, onnxruntime, s3tokenizer, soundfile as sf, torch
import torchaudio.compliance.kaldi as kaldi
from huggingface_hub import snapshot_download
from hyperpyyaml import load_hyperpyyaml
from stepaudio2.flashcosyvoice.modules.hifigan import HiFTGenerator
from stepaudio2.flashcosyvoice.utils.audio import mel_spectrogram
from stepaudio2.token2wav import _setup_cosyvoice2_alias

REVISION = "503e754207c94da6bb26850b4469f367c9ea3582"
ASSETS = ["assets/token2wav/*", "assets/system_ref_audio.wav"]


def load(path, sr):
    """Mono float32 audio at `sr` Hz."""
    x, r = sf.read(path, dtype="float32")
    x = x.mean(1) if x.ndim > 1 else x
    return librosa.resample(x, orig_sr=r, target_sr=sr) if r != sr else x


class Token2wav:
    """As stepaudio2.Token2wav: (speech tokens, prompt wav path) -> 24 kHz WAV bytes in the prompt's voice."""

    def __init__(self, repo=None):
        repo = repo or snapshot_download("openbmb/MiniCPM-o-4_5", revision=REVISION, allow_patterns=ASSETS)
        a = f"{repo}/assets/token2wav"
        _setup_cosyvoice2_alias()  # flow.yaml names cosyvoice2.* classes
        self.tokenizer = s3tokenizer.load_model(f"{a}/speech_tokenizer_v2_25hz.onnx").eval()
        self.campplus = onnxruntime.InferenceSession(f"{a}/campplus.onnx", providers=["CPUExecutionProvider"])
        with open(f"{a}/flow.yaml") as f:
            self.flow = load_hyperpyyaml(f)["flow"]
        self.flow.load_state_dict(torch.load(f"{a}/flow.pt", map_location="cpu", weights_only=True), strict=True)
        self.flow.eval()
        self.hift = HiFTGenerator()
        self.hift.load_state_dict({k.replace("generator.", ""): v for k, v in torch.load(f"{a}/hift.pt", map_location="cpu", weights_only=True).items()}, strict=True)
        self.hift.eval()
        self.default_voice = f"{repo}/assets/system_ref_audio.wav"
        self._voice = (None, None)

    @torch.inference_mode()
    def tokens(self, audio16):
        """Speech tokens [1, T] of 16 kHz audio, as MiniCPM-o's tokenizer makes them."""
        mels, lens = s3tokenizer.padding([s3tokenizer.log_mel_spectrogram(torch.from_numpy(audio16))])
        t, tl = self.tokenizer.quantize(mels, lens)
        return t[:, : int(tl[0])].int()

    @torch.inference_mode()
    def voice(self, wav):
        """The prompt voice as Token2wav._prepare_prompt makes it: tokens, lengths, 24 kHz mel, speaker embedding."""
        if self._voice[0] != wav:
            x16 = load(wav, 16000)
            tok = self.tokens(x16)
            fbank = kaldi.fbank(torch.from_numpy(x16).unsqueeze(0), num_mel_bins=80, dither=0, sample_frequency=16000)
            spk = torch.from_numpy(self.campplus.run(None, {self.campplus.get_inputs()[0].name: (fbank - fbank.mean(0, keepdim=True)).unsqueeze(0).numpy()})[0])
            mel = mel_spectrogram(torch.from_numpy(load(wav, 24000)).unsqueeze(0)).transpose(1, 2)
            mel = torch.nn.functional.pad(mel, (0, 0, 0, tok.shape[1] * self.flow.up_rate - mel.shape[1]), mode="replicate")
            self._voice = (wav, (tok, torch.tensor([tok.shape[1]], dtype=torch.int32), mel, torch.tensor([mel.shape[1]], dtype=torch.int32), spk))
        return self._voice[1]

    @torch.inference_mode()
    def __call__(self, tokens, prompt_wav=None):
        t = tokens.int() if torch.is_tensor(tokens) else torch.tensor([tokens], dtype=torch.int32)
        mel = self.flow.inference(t.cpu(), torch.tensor([t.shape[1]], dtype=torch.int32), *self.voice(prompt_wav or self.default_voice), 10)
        wav, _ = self.hift(speech_feat=mel)
        out = io.BytesIO()
        sf.write(out, wav.squeeze(0).numpy(), 24000, format="WAV")
        return out.getvalue()
