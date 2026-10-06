# Box ② Voice on SageMaker (Malaysia): the same image Baseten builds from packages/infra/baseten/voice/config.yaml
# (its build_commands, in order), started as SageMaker starts a container: port 8080, /ping and /invocations
# (data/gateway.py). Build context: this folder plus baseten/voice/data as data/ (buildspec.yml). The gateway reads
# the weights from MODELS: asr, tts, rerank and, for who spoke when, diar (without that folder it only writes speech down).
FROM vllm/vllm-openai:v0.29.0-cu129
RUN apt-get update -qq && apt-get install -y -qq ffmpeg git && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip freeze | grep -iE '^(torch|torchvision|triton|transformers|numpy|fastapi|starlette|pydantic|pydantic_core|uvicorn)==' > /tmp/pins.txt && \
    python3 -m pip install --no-cache-dir -c /tmp/pins.txt sentence-transformers httpx virtualenv librosa soundfile
RUN python3 -m virtualenv /opt/tts && /opt/tts/bin/pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
RUN ABI=$(/opt/tts/bin/python -c "import torch; print(str(torch._C._GLIBCXX_USE_CXX11_ABI).upper())") && \
    /opt/tts/bin/pip install --no-cache-dir "https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3.post1/flash_attn-2.8.3.post1+cu12torch2.8cxx11abi${ABI}-cp312-cp312-linux_x86_64.whl"
RUN printf 'torch==2.8.0\ntorchaudio==2.8.0\ntorchcodec==0.7.0\n' > /tmp/tts-pins.txt && \
    /opt/tts/bin/pip install --no-cache-dir -c /tmp/tts-pins.txt nano-vllm-voxcpm==2.0.4 fastapi uvicorn soundfile
RUN /opt/tts/bin/python -c "import flash_attn, torch, nanovllm_voxcpm.models.voxcpm2.server; print('voice deps ok, torch', torch.__version__)"
RUN python3 -m virtualenv /opt/diar && /opt/diar/bin/pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
RUN /opt/diar/bin/pip install --no-cache-dir "transformers @ git+https://github.com/huggingface/transformers@d28b79377cdf2a36549bb4b163f1956a70d07926" \
    soundfile numpy fastapi uvicorn python-multipart
RUN /opt/diar/bin/python -c "import soundfile, python_multipart, torch, transformers.models.nemotron3_diarization; print('diar deps ok, torch', torch.__version__)"
COPY data /app/data
ENV MODELS=/opt/ml/model PORT=8080 VLLM_LOGGING_LEVEL=WARNING VLLM_MAX_AUDIO_DECODE_DURATION_S=3900 VLLM_MAX_AUDIO_CLIP_FILESIZE_MB=120
ENTRYPOINT ["python3", "/app/data/gateway.py"]
