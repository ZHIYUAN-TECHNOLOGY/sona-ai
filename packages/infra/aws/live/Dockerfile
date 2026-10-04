# Box ④ (sona-live, MiniCPM-o 4.5) on a SageMaker GPU in Malaysia, to measure it there: the image Baseten builds from
# packages/infra/baseten/live/config.yaml, with serve.py in front (SageMaker's /ping and /invocations; a live call is a
# WebSocket, which an endpoint does not carry, so the test call is played inside the box). Build context: this folder,
# baseten/live/data as data/, baseten/live/check.py, and question.wav (buildspec.yml).
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel
RUN pip install --no-cache-dir "minicpmo-utils[tts]==1.0.6" "transformers==4.51.3" "accelerate<1.8" "setuptools<80" \
    safetensors huggingface_hub fastapi "uvicorn[standard]" websockets soundfile && \
    python -c "import stepaudio2, transformers, torch; print('live deps ok', transformers.__version__, torch.__version__)"
COPY data /app/data
COPY check.py serve.py question.wav /app/
ENV MODEL=/opt/ml/model/live TALKER=/opt/ml/model/voice/talker.safetensors VOICE=/opt/ml/model/sona_voice.wav
ENTRYPOINT ["python", "/app/serve.py"]
