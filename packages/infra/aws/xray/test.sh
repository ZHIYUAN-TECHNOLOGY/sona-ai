#!/bin/bash
# Box ③ (MedGemma 1.5 4B, the X-ray reader) on SageMaker, Malaysia: bring the endpoint up on one L4, ask it one question
# in words and one about a chest X-ray, and take it down again, so nothing is left billing.
# Usage: AWS_PROFILE=sona bash test.sh [image.jpg]   (the image and weights come from buildspec.yml; TYPE= another instance)
set -u
export AWS_DEFAULT_REGION=ap-southeast-5 AWS_SDK_UA_APP_ID=AWSSkill-SageMaker
cd "$(dirname "$0")"
A=$(aws sts get-caller-identity --query Account --output text); B="sona-ai-models-${A}-apse5"
REV=91850547d9f0b2fdd21aa7c5f4f3d1a8a52c243b; N=sona-xray; OUT=${OUT:-/tmp/sona-xray-test}; mkdir -p "$OUT"
IMAGE=${1:-../../../../apps/native/features/imaging/assets/normal-pa-chest.jpg}
# The flags of ../../baseten/xray/config.yaml.
ARGS="--served-model-name medgemma-1.5-4b --quantization fp8 --max-model-len 8192 --max-num-seqs 8 --gpu-memory-utilization 0.9 --limit-mm-per-prompt.image 1"
down() {
  # An endpoint cannot be deleted while it is Creating: wait for it to settle (InService or Failed) first.
  until [ "$(aws sagemaker describe-endpoint --endpoint-name $N --query EndpointStatus --output text 2>/dev/null)" != Creating ]; do sleep 15; done
  aws sagemaker delete-endpoint --endpoint-name $N > /dev/null 2>&1
  for i in $(seq 40); do aws sagemaker describe-endpoint --endpoint-name $N > /dev/null 2>&1 || break; sleep 15; done
  echo "endpoints left running: $(aws sagemaker list-endpoints --query 'length(Endpoints)' --output text)"
}
trap down EXIT
aws sagemaker delete-endpoint-config --endpoint-config-name $N > /dev/null 2>&1; aws sagemaker delete-model --model-name $N > /dev/null 2>&1
aws sagemaker create-model --model-name $N --execution-role-arn "arn:aws:iam::${A}:role/sona-sagemaker-hosting" \
  --primary-container "{\"Image\":\"${A}.dkr.ecr.ap-southeast-5.amazonaws.com/sona/vllm:v0.29.0\",\"ModelDataSource\":{\"S3DataSource\":{\"S3Uri\":\"s3://${B}/xray/${REV}/\",\"S3DataType\":\"S3Prefix\",\"CompressionType\":\"None\"}},\"Environment\":{\"VLLM_LOGGING_LEVEL\":\"WARNING\",\"VLLM_ARGS\":\"${ARGS}\"}}" \
  --query ModelArn --output text || exit 1
aws sagemaker create-endpoint-config --endpoint-config-name $N --production-variants \
  "VariantName=main,ModelName=$N,InstanceType=${TYPE:-ml.g6.xlarge},InitialInstanceCount=1,ContainerStartupHealthCheckTimeoutInSeconds=900,ModelDataDownloadTimeoutInSeconds=1200" \
  --query EndpointConfigArn --output text || exit 1
T0=$(date +%s)
aws sagemaker create-endpoint --endpoint-name $N --endpoint-config-name $N --query EndpointArn --output text || exit 1
for i in $(seq 180); do  # 45 min at most
  S=$(aws sagemaker describe-endpoint --endpoint-name $N --query EndpointStatus --output text)
  [ "$S" = InService ] && break
  [ "$S" = Failed ] && { aws sagemaker describe-endpoint --endpoint-name $N --query FailureReason --output text; break; }
  sleep 15
done
echo "endpoint $S after $(( ($(date +%s) - T0) / 60 )) min"
[ "$S" = InService ] || { aws logs tail /aws/sagemaker/Endpoints/$N --since 1h 2>/dev/null | tail -25 | cut -c1-240; exit 1; }
# ask <name> <prompt> [image]: the body the server sends (chatLook, packages/api/src/vision-models.ts).
ask() {
  python3 - "$2" "${3:-}" > "$OUT/req.json" <<'PY'
import base64, json, sys
prompt, image = sys.argv[1], sys.argv[2]
content = [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(open(image, "rb").read()).decode()}}, {"type": "text", "text": prompt}] if image else prompt
print(json.dumps({"model": "medgemma-1.5-4b", "temperature": 0, "max_tokens": 200, "messages": [{"role": "user", "content": content}]}))
PY
  local t=$(python3 -c "import time; print(time.time())")
  aws sagemaker-runtime invoke-endpoint --endpoint-name $N --content-type application/json --body "fileb://$OUT/req.json" "$OUT/$1.json" > /dev/null || return 1
  python3 -c "import json,time; d=json.load(open('$OUT/$1.json')); print('$1', round(time.time()-$t,1), 's |', d['choices'][0]['message']['content'].strip()[:500], '|', d.get('usage'))"
}
ask words "What does cardiomegaly mean on a chest X-ray? Answer in two short sentences."
ask xray "Describe this chest X-ray in three short sentences. Is it normal?" "$IMAGE"
ask xray-again "Is the heart size normal on this chest X-ray? Answer in one sentence." "$IMAGE"
# THEN: one more command while the endpoint is up.
[ -z "${THEN:-}" ] || bash -c "$THEN"
