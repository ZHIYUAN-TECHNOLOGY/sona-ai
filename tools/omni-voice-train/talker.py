"""MiniCPM-o 4.5's talker (model.tts, MiniCPMTTS) fed exactly as the model feeds it, so it can be trained teacher-forced.

Read from modeling_minicpmo.py at revision 503e754 (docs/minicpm-o-finetune.md, stage 3):
- chat layout (MiniCPMO._generate_speech_non_streaming): [emb_text(reply ids) + norm(projector_semantic(LLM last hidden))]
  + text_eos + audio_bos, then the codes; plain causal attention from position 0; EOS (num_audio_tokens - 1) ends it.
- duplex layout (MiniCPMODuplex.streaming_generate -> _convert_results_to_tts_input -> tts.generate_chunk): each 1 s unit
  is [merged embeds of the unit's text tokens] + audio_bos, then 25 codes; positions and KV run on across the turn's
  units, and the 26th code a unit samples is thrown away (never fed), so it has no target here; the last unit ends in EOS.
The LLM hidden state paired with a token is the one after feeding it (last layer, normed), in both layouts.
"""
import math, sys

import numpy as np, torch, torch.nn.functional as F

REVISION = "503e754207c94da6bb26850b4469f367c9ea3582"
CODES_PER_UNIT = 25  # 1 s of speech; tts.generate_chunk's max_new_token is 25 + 1


def load(device="mps", dtype=torch.float16, repo=None):
    """The model without its eyes (calls never send images) and its tokenizer, ready for chat()."""
    from huggingface_hub import snapshot_download
    from transformers import AutoModel, AutoTokenizer
    repo = repo or snapshot_download("openbmb/MiniCPM-o-4_5", revision=REVISION,
                                     allow_patterns=["*.safetensors", "*.json", "*.py", "*.txt", "assets/token2wav/*", "assets/system_ref_audio.wav"])
    model = AutoModel.from_pretrained(repo, trust_remote_code=True, attn_implementation="sdpa", torch_dtype=dtype,
                                      init_vision=False, init_audio=True, init_tts=True).eval().to(device)
    tokenizer = AutoTokenizer.from_pretrained(repo, trust_remote_code=True)
    model.prepare_processor(tokenizer=tokenizer)
    return model, tokenizer, repo


@torch.inference_mode()
def reply_hidden(model, msgs, reply):
    """(reply token ids [n], LLM hidden [n, 4096]) as chat(teacher_forcing=True, use_tts_template=True) computes them:
    the assistant turn is <|tts_bos|>reply<|tts_eos|>, one prefill (MiniCPMO.generate's embeddings, then the LLM forward
    its generate starts with; generate itself is skipped, its _decode_text fails when the one new token is id 0)."""
    mod = sys.modules[type(model).__module__]
    copy, audios, parts = [], [], []
    for i, m in enumerate([*msgs, {"role": "assistant", "content": [f"<|tts_bos|>{reply}<|tts_eos|>"]}]):
        cur = []
        for c in mod.normalize_content(m["content"]):
            if isinstance(c, np.ndarray):
                audios.append(c); parts.append(i); cur.append("<audio>./</audio>")
            else:
                cur.append(c)
        copy.append({"role": m["role"], "content": "\n".join(cur)})
    tok = model.processor.tokenizer
    prompt = tok.apply_chat_template(copy, tokenize=False, add_generation_prompt=False, use_tts_template=True, enable_thinking=False)
    inputs = model.processor([prompt], [[]], [audios], [parts], max_slice_nums=None, use_image_id=None, stream_input=False,
                             return_tensors="pt", max_length=8192).to(model.device)
    inputs.pop("image_sizes")
    keys = ("input_ids", "audio_features", "audio_feature_lens", "image_bound", "audio_bounds", "spk_bounds", "pixel_values", "tgt_sizes")
    mi = {k: inputs[k] for k in keys if k in inputs}
    emb, _ = model.get_vllm_embedding(mi)
    emb = model.get_omni_embedding(mi, input_embeddings=emb, chunk_length=model.config.audio_chunk_length)
    out = model.llm(inputs_embeds=emb, attention_mask=inputs["attention_mask"], output_hidden_states=True)
    seq, hidden = inputs["input_ids"][0], out.hidden_states[-1][0]
    bos = (seq == tok.convert_tokens_to_ids("<|tts_bos|>")).nonzero()[-1].item() + 1
    eos = (seq == tok.convert_tokens_to_ids("<|tts_eos|>")).nonzero()[-1].item()
    return seq[bos:eos].clone(), hidden[bos:eos].clone()


def merged(tts, ids, hidden):
    """What the talker reads per text token: its text embedding plus the projected, normed LLM state."""
    h = tts.projector_semantic(hidden.to(tts.dtype))
    if tts.config.normalize_projected_hidden:
        h = F.normalize(h, p=2, dim=-1)
    return tts.emb_text(ids) + h


def special(tts, token_id):
    return tts.emb_text(torch.tensor([token_id], device=tts.emb_text.weight.device))


def chat_inputs(tts, ids, hidden, codes):
    """Chat layout: (embeds [L, 768], targets [L]); targets[i] is what position i predicts, -100 for nothing."""
    cond = torch.cat([merged(tts, ids, hidden), special(tts, tts.config.text_eos_token_id), special(tts, tts.audio_bos_token_id)])
    x = torch.cat([cond, tts.emb_code[0](codes)])
    y = torch.full((len(x),), -100, dtype=torch.long, device=x.device)
    y[len(cond) - 1 : len(cond) - 1 + len(codes)] = codes
    y[len(cond) - 1 + len(codes)] = tts.num_audio_tokens - 1  # EOS after the last code
    return x, y


def units_of(n_text, n_codes, lead=0):
    """Text token boundaries per 1 s unit for a reply of n_text tokens spoken in n_codes codes: even pacing, the text
    `lead` units ahead of its speech. Live (parity.py, 1 Oct) the LLM wrote about 3 tokens a unit, in step with the speech.
    ponytail: even pacing, not forced alignment; align words to audio if the voice drifts from its text."""
    n_units = max(1, math.ceil(n_codes / CODES_PER_UNIT))
    ends = [min(n_text, math.ceil((k + 1 + lead) * n_text / n_units)) for k in range(n_units)]
    return list(zip([0, *ends[:-1]], ends))


def duplex_units(units_text, codes):
    """Training units for one reply: [(ids, hidden, codes, ends)] with 25 codes a unit and EOS after the last."""
    n = len(units_text)
    return [(ids, hidden, codes[k * CODES_PER_UNIT :] if k == n - 1 else codes[k * CODES_PER_UNIT : (k + 1) * CODES_PER_UNIT], k == n - 1)
            for k, (ids, hidden) in enumerate(units_text)]


def duplex_inputs(tts, units):
    """Duplex layout for one turn. units: [(ids, hidden, codes, ends)] per 1 s unit, `ends` when an EOS follows its
    codes (the turn's last unit; live, also any unit the talker stopped early). Returns (embeds [L, 768], targets [L])."""
    bos = special(tts, tts.audio_bos_token_id)
    xs, ys = [], []
    for ids, hidden, c, ends in units:
        cond = torch.cat([merged(tts, ids, hidden), bos]) if len(ids) else bos
        y = torch.full((len(cond) + len(c),), -100, dtype=torch.long, device=cond.device)
        y[len(cond) - 1 : len(cond) - 1 + len(c)] = c  # the audio_bos predicts the unit's first code, each code the next
        if ends:  # otherwise the last code predicts the 26th code generate_chunk samples and throws away
            y[-1] = tts.num_audio_tokens - 1
        xs += [cond, tts.emb_code[0](c)]
        ys.append(y)
    return torch.cat(xs), torch.cat(ys)


def logits(tts, x):
    """Teacher-forced talker logits [L, num_audio_tokens] for embeds [L, 768], positions from 0 as at a turn start."""
    pos = torch.arange(len(x), device=x.device)[None]
    h = tts.model(inputs_embeds=x[None], position_ids=pos, use_cache=False).last_hidden_state
    return tts.head_code[0](h)[0]


def loss(tts, x, y):
    return F.cross_entropy(logits(tts, x).float(), y, ignore_index=-100)
