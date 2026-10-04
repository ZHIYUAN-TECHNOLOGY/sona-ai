# The PII box on AWS Lambda (Malaysia): the image Baseten builds from packages/infra/baseten/pii/config.yaml, with
# Lambda's web adapter, which hands each call to the service on port 8000 as plain HTTP. Lambda rather than a SageMaker
# endpoint because the box works at training capture only: it bills per call and nothing while idle.
# Build context: this folder plus baseten/pii/data as data/ (buildspec.yml).
FROM python:3.11-slim
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
# Lambda's file system is read-only but /tmp, and it runs as another user: the weights and OpenMed's integrity manifest
# are baked under a HOME every user can read, and nothing is fetched at run time.
ENV HOME=/opt/home
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir "openmed[service,hf]==2.5.0" "transformers==5.18.0" "fastapi==0.142.2"
RUN mkdir -p $HOME && python -c "from openmed import extract_pii; print(extract_pii('Seen with her son Hafiz.', model_name='OpenMed/OpenMed-PII-mClinicalE5-Large-560M-v1').entities)" && chmod -R a+rX $HOME
COPY data /app/data
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 AWS_LWA_PORT=8000 AWS_LWA_READINESS_CHECK_PATH=/health AWS_LWA_ASYNC_INIT=true \
    OPENMED_SERVICE_PRELOAD_MODELS=OpenMed/OpenMed-PII-mClinicalE5-Large-560M-v1 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
ENTRYPOINT ["python", "/app/data/serve.py"]
