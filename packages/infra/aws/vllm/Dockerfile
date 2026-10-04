# vLLM as SageMaker starts a container (`docker run <image> serve`, port 8080, /ping and /invocations), for any box
# that is one vLLM model: the flags come from the model's VLLM_ARGS (box ③ uses it; box ① still has its own copy in
# ../brain and can move here, which would save its 10 GB of image storage).
FROM vllm/vllm-openai:v0.29.0-cu129
COPY --chmod=755 serve /usr/local/bin/serve
ENTRYPOINT ["/usr/local/bin/serve"]
