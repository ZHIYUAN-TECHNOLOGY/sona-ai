# Box ① Brain on SageMaker (Malaysia): the same vLLM as Baseten's (packages/infra/baseten/brain/config.yaml), started the
# way SageMaker starts a container: `docker run <image> serve`, port 8080, GET /ping and POST /invocations (vLLM has both).
FROM vllm/vllm-openai:v0.29.0-cu129
COPY serve /usr/local/bin/serve
RUN chmod +x /usr/local/bin/serve
ENTRYPOINT ["/usr/local/bin/serve"]
