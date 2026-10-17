"""Smart Turn v3's model (pipecat-ai/smart-turn train.py, BSD 2-Clause: Whisper tiny's encoder on 8 s of audio, attention
pooling, a small classifier that says whether the speaker has finished), and its published weights loaded from the ONNX
file, which is the only form they are published in."""
import numpy as np
import onnx
import torch
from huggingface_hub import hf_hub_download
from torch import nn
from transformers import WhisperConfig
from transformers.models.whisper.modeling_whisper import WhisperEncoder

PUBLISHED = ("pipecat-ai/smart-turn-v3", "smart-turn-v3.2-gpu.onnx")  # fp32; the -cpu file is the same model in 8 bits


class SmartTurn(nn.Module):
    def __init__(self):
        super().__init__()
        config = WhisperConfig.from_pretrained("openai/whisper-tiny")
        config.max_source_positions = 400  # 8 s
        self.encoder = WhisperEncoder(config)
        hidden = config.d_model
        self.pool_attention = nn.Sequential(nn.Linear(hidden, 256), nn.Tanh(), nn.Linear(256, 1))
        self.classifier = nn.Sequential(nn.Linear(hidden, 256), nn.LayerNorm(256), nn.GELU(), nn.Dropout(0.1),
                                        nn.Linear(256, 64), nn.GELU(), nn.Linear(64, 1))

    def forward(self, input_features):
        """Log-mel features (batch, 80, 800) to one logit each: finished when its sigmoid is over a half."""
        states = self.encoder(input_features=input_features).last_hidden_state
        weights = torch.softmax(self.pool_attention(states), dim=1)
        return self.classifier(torch.sum(states * weights, dim=1)).squeeze(-1)


def published() -> SmartTurn:
    """The model with Smart Turn v3.2's weights. The export keeps most parameters' names (under "inner."); a Linear
    that became a MatMul has its weight transposed and unnamed, and those come in the order the model uses them: each
    encoder layer's q, k, v, out, fc1 and fc2, then the pooling's two. check() confirms the two models agree."""
    graph = onnx.load(hf_hub_download(*PUBLISHED)).graph
    held = {i.name: onnx.numpy_helper.to_array(i) for i in graph.initializer}
    unnamed = iter([name for node in graph.node if node.op_type == "MatMul" for name in node.input if name in held])
    linears = [f"encoder.layers.{n}.{part}.weight" for n in range(4) for part in ("self_attn.q_proj", "self_attn.k_proj", "self_attn.v_proj", "self_attn.out_proj", "fc1", "fc2")]
    held.update({f"inner.{key}": held[next(unnamed)].T for key in [*linears, "pool_attention.0.weight", "pool_attention.2.weight"]})
    model = SmartTurn()
    state = {key: torch.from_numpy(np.array(held[f"inner.{key}"])) for key in model.state_dict()}
    model.load_state_dict(state)
    return model.eval()


def check(model: SmartTurn) -> float:
    """The largest gap between this model's probability and the published file's on random features."""
    import onnxruntime as ort

    x = np.random.default_rng(0).standard_normal((4, 80, 800)).astype(np.float32)
    theirs = ort.InferenceSession(hf_hub_download(*PUBLISHED)).run(None, {"input_features": x})[0].reshape(-1)
    with torch.no_grad():
        ours = torch.sigmoid(model(torch.from_numpy(x))).numpy()
    return float(np.abs(theirs - ours).max())


if __name__ == "__main__":
    print("largest gap from the published model:", check(published()))
