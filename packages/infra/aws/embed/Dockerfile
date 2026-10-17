# The library's embedder (EmbeddingGemma-300M) and the films' (BiomedCLIP) on SageMaker (Malaysia), started as SageMaker
# starts a container (serve.py: port 8080, /ping and /invocations). A CPU box, beside Laya; the weights come from S3
# (buildspec.yml). torchvision from the CPU index too, or pip pulls the CUDA torch with it.
FROM python:3.11-slim
RUN pip install --no-cache-dir torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir "sentence-transformers==5.1.1" "open_clip_torch==3.3.0" "fastapi==0.141.1" "uvicorn==0.37.0"
COPY serve.py /app/serve.py
# torch otherwise sizes its thread pool to the host's cores, not the box's: 4, as the box is ml.c6i.xlarge (test.sh)
# since 7 Oct, when the two models ran the 4 GB of ml.c6i.large out at start. HF_HUB_OFFLINE: every weight is on disk,
# so a start never waits on (or fails over) the hub.
ENV OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 TOKENIZERS_PARALLELISM=false HF_HUB_OFFLINE=1
ENTRYPOINT ["python", "/app/serve.py"]
