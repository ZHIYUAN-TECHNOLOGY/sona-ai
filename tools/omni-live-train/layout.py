"""MiniCPM-o's live (full-duplex) layout, rebuilt to train the brain in it (docs/minicpm-o-finetune.md, live format).

Stage 1 trained the brain on chat turns; a live call feeds it something else (MiniCPMODuplex in the model code):
  system   <|im_start|>system\\n{brief}\\n<|audio_start|> [Sona's reference clip] <|audio_end|><|im_end|>
  a second <unit> [10 audio embeddings], then the brain writes <|listen|>, or <|speak|>, a few words and <|chunk_eos|>;
           then </unit>
  turn end <unit> [audio] <|speak|><|turn_eos|><|chunk_eos|></unit>
Seen on the base model, 2 Oct (tools/omni-live-train/parity.py prints it). Only what the brain writes is trained: each
second's decision, the words and the end marks; the audio and the marks around them are input.

The embeddings come from the model's own code: its prefill runs with the brain swapped for a recorder (Recorder), so
the system prompt, the reference clip and every second of audio are exactly what a live call feeds.
"""
import math

import librosa
import numpy as np
import torch

UNIT = 16_000  # a second of 16 kHz audio, the live unit
# Sona's speaking rate, text tokens a second (her 12,133 training clips, 2 Oct): an answer gets a second per this many.
RATE = {"en": 3.2, "ms": 4.2, "zh": 2.7, "manglish": 3.9}
SPEAK_AFTER_S = 0.3  # she starts in the second that holds the end of the question plus this much quiet


class Recorder:
    """The brain's place in a live session while the model's own prefill runs: keeps every embedding it is fed."""

    def __init__(self, duplex):
        self.duplex, self.fed = duplex, []

    def __enter__(self):
        self.real = self.duplex.decoder.feed

        def feed(embeds, return_logits=False):
            self.fed.append(embeds.detach())
            return (torch.zeros(1, 1, device=embeds.device), None) if return_logits else None

        self.duplex.decoder.feed = feed
        return self

    def __exit__(self, *exc):
        self.duplex.decoder.feed = self.real

    def take(self):
        out, self.fed = torch.cat(self.fed), []
        return out


def spans(n_text, lang):
    """Token ranges per spoken second for an answer of n_text tokens: even pacing at Sona's rate (as the talker learnt)."""
    n = max(1, math.ceil(n_text / RATE.get(lang, 3.5)))
    ends = [min(n_text, math.ceil((k + 1) * n_text / n)) for k in range(n)]
    return [(s, e) for s, e in zip([0, *ends[:-1]], ends) if e > s]


def speech_end(audio):
    """Seconds into the clip where the patient stops talking (trailing quiet trimmed)."""
    return librosa.effects.trim(audio, top_db=35)[1][1] / UNIT


def writes_for(tokenizer, question, answer, lang, after=1):
    """What the brain writes each second of a call where the patient asks `question` (16 kHz) and Sona answers:
    listen while they talk, the answer a second at a time at her pace, its end, then listen `after` seconds."""
    ids = tokenizer.convert_tokens_to_ids
    listen, speak, chunk_eos, turn_eos = map(ids, ["<|listen|>", "<|speak|>", "<|chunk_eos|>", "<|turn_eos|>"])
    words = tokenizer.encode(answer, add_special_tokens=False)
    first = max(0, math.ceil(speech_end(question) + SPEAK_AFTER_S) - 1)
    return ([[listen]] * first + [[speak, *words[s:e], chunk_eos] for s, e in spans(len(words), lang)]
            + [[speak, turn_eos, chunk_eos]] + [[listen]] * after)


def example(duplex, brief, voice, question, answer, lang, after=1):
    """One call in the live layout (writes_for, then build)."""
    return build(duplex, brief, voice, question, writes_for(duplex.tokenizer, question, answer, lang, after))


def build(duplex, brief, voice, question, writes):
    """The call as the brain sees it: (inputs_embeds [L, H], labels [L]); labels are the next token wherever the brain
    writes (`writes`, a token list per second), else -100. The phone sends silence while Sona is audible (its echo gate),
    so after the question every second is zeros."""
    embeds, labels, _ = assemble(duplex, *heard_call(duplex, brief, voice, question, len(writes)), writes)
    return embeds, labels


def heard_call(duplex, brief, voice, question, seconds):
    """What a call feeds the brain before anything it writes: the system part, and each second's <unit> with its audio
    embeddings (`seconds` of them: the question, then quiet). They do not depend on what the brain writes, so one call's
    hearing serves any answer (tools/omni-voice-train/train.py --layout live)."""
    audio = np.concatenate([question, np.zeros(seconds * UNIT, np.float32)])[: seconds * UNIT].astype(np.float32)
    duplex.model.reset_session()  # a fresh call: prepare() keeps the ear's streaming cache (audio_past_key_values)
    with Recorder(duplex) as rec:
        duplex.prepare(prefix_system_prompt=brief, ref_audio=voice)
        system = rec.take()
        heard = []
        for k in range(seconds):
            duplex.streaming_prefill(audio_waveform=audio[k * UNIT:(k + 1) * UNIT])
            heard.append(rec.take())
    return system, heard


def assemble(duplex, system, heard, writes):
    """The call from its hearing and what the brain writes each second: (inputs_embeds, labels, where), `where[k]` the
    position of each token written in second k (the brain's state after feeding it is what the talker reads)."""
    unit_end = duplex.tokenizer.convert_tokens_to_ids("</unit>")
    embeds, labels, where, at = [system], [torch.full((len(system),), -100)], [], len(system)
    for h, wrote in zip(heard, writes):
        out = wrote + [unit_end]
        embeds += [h, duplex.decoder.embed_tokens(out).detach()]
        # The last audio embedding predicts the decision; each written token the next; </unit> is fed, not written.
        y = torch.full((len(h) + len(out),), -100)
        y[len(h) - 1: len(h) - 1 + len(wrote)] = torch.tensor(wrote)
        labels.append(y)
        where.append([at + len(h) + i for i in range(len(wrote))])
        at += len(h) + len(out)
    return torch.cat(embeds), torch.cat(labels), where
