# Laya (the card picker) on SageMaker (Malaysia): the image Baseten builds from packages/infra/baseten/laya/config.yaml,
# started as SageMaker starts a container (serve.py: port 8080, /ping and /invocations). A CPU box, as there.
FROM python:3.11-slim
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir "laya[serve]==0.3.21" "fastapi==0.141.1"
COPY serve.py /app/serve.py
# torch otherwise sizes its thread pool to the host's cores, not the box's 2 vCPUs.
ENV OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
ENTRYPOINT ["python", "/app/serve.py"]
