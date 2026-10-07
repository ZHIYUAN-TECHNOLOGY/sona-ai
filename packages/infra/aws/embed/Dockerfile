# The library's embedder (EmbeddingGemma-300M) on SageMaker (Malaysia), started as SageMaker starts a container
# (serve.py: port 8080, /ping and /invocations). A CPU box, beside Laya; the weights come from S3 (buildspec.yml).
FROM python:3.11-slim
RUN pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir "sentence-transformers==5.1.1" "fastapi==0.141.1" "uvicorn==0.37.0"
COPY serve.py /app/serve.py
# torch otherwise sizes its thread pool to the host's cores, not the box's.
ENV OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 TOKENIZERS_PARALLELISM=false
ENTRYPOINT ["python", "/app/serve.py"]
