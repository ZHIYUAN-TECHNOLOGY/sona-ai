# Box ④ (sona-live, MiniCPM-o 4.5) with box ② (the Manglish ASR, Sona's VoxCPM voice, the reranker) beside it, for one
# SageMaker machine in Malaysia with four L4s (ml.g6.12xlarge): the live model takes two of them (her voice on the
# second), and box ②'s three models the third, which sat idle. One endpoint fewer, and the ear a live call needs is on
# the machine that takes the call. Built on box ②'s image (../voice: vLLM, its voice venv, data/gateway.py at
# /app/data), with the live model's own Python beside it, as Baseten builds it from ../../baseten/live/config.yaml
# (that image's torch is another version). serve.py is in front: SageMaker's /ping and /invocations for both.
# Build context: this folder, baseten/live/data as live/, baseten/live/check.py, and question.wav (buildspec.yml).
ARG VOICE_IMAGE
FROM ${VOICE_IMAGE}
RUN python3 -m virtualenv /opt/live && \
    /opt/live/bin/pip install --no-cache-dir torch==2.6.0 torchaudio==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124 && \
    printf 'torch==2.6.0\ntorchaudio==2.6.0\ntorchvision==0.21.0\n' > /tmp/live-pins.txt && \
    /opt/live/bin/pip install --no-cache-dir -c /tmp/live-pins.txt "minicpmo-utils[tts]==1.0.6" "transformers==4.51.3" "accelerate<1.8" "setuptools<80" \
    safetensors huggingface_hub fastapi "uvicorn[standard]" websockets soundfile onnxruntime && \
    /opt/live/bin/python -c "import stepaudio2, transformers, torch, onnxruntime, librosa; print('live deps ok', transformers.__version__, torch.__version__)"
RUN python3 -m pip install --no-cache-dir --no-deps websockets
COPY live /app/live
COPY check.py serve.py question.wav /app/live/
ENV MODEL=/opt/ml/model/live TALKER=/opt/ml/model/voice/talker.safetensors VOICE=/opt/ml/model/sona_voice.wav TURN=/opt/ml/model/turn/sona-turn.onnx \
    VOICE_BOX=/opt/ml/model/voicebox
ENTRYPOINT ["python3", "/app/live/serve.py"]
