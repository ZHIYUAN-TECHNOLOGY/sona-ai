#!/bin/bash
# Box ① on SageMaker, Malaysia: bring the endpoint up on one L4, ask it one question, and take it down again, so
# nothing is left billing. ml.g6.2xlarge: the 17 GB weights file could not be mapped in ml.g6.xlarge's 16 GB (4 Oct). Usage: AWS_PROFILE=sona bash test.sh   (the image and weights come from buildspec.yml)
set -u
export AWS_DEFAULT_REGION=ap-southeast-5 AWS_SDK_UA_APP_ID=AWSSkill-SageMaker
A=$(aws sts get-caller-identity --query Account --output text); B="sona-ai-models-${A}-apse5"
REV=18a3c7285c33ee39d3e5e16ee6fb2c18f4955ef9; N=sona-brain; OUT=${OUT:-/tmp/sona-brain-test}; mkdir -p "$OUT"
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
  --primary-container "{\"Image\":\"${A}.dkr.ecr.ap-southeast-5.amazonaws.com/sona/brain:v0.29.0\",\"ModelDataSource\":{\"S3DataSource\":{\"S3Uri\":\"s3://${B}/brain/${REV}/\",\"S3DataType\":\"S3Prefix\",\"CompressionType\":\"None\"}},\"Environment\":{\"VLLM_LOGGING_LEVEL\":\"WARNING\"}}" \
  --query ModelArn --output text || exit 1
aws sagemaker create-endpoint-config --endpoint-config-name $N --production-variants \
  "VariantName=main,ModelName=$N,InstanceType=ml.g6.2xlarge,InitialInstanceCount=1,ContainerStartupHealthCheckTimeoutInSeconds=900,ModelDataDownloadTimeoutInSeconds=1200" \
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
ask() {
  echo "{\"model\":\"gemma-4-26b-a4b\",\"messages\":[{\"role\":\"user\",\"content\":\"$1\"}],\"temperature\":0,\"max_tokens\":120,\"chat_template_kwargs\":{\"enable_thinking\":false}}" > "$OUT/req.json"
  local t=$(python3 -c "import time; print(time.time())")
  aws sagemaker-runtime invoke-endpoint --endpoint-name $N --content-type application/json --body "fileb://$OUT/req.json" "$OUT/$2.json" > /dev/null || return 1
  python3 -c "import json,sys,time; d=json.load(open('$OUT/$2.json')); print('$2', round(time.time()-$t,1), 's |', d['choices'][0]['message']['content'].strip()[:300], '|', d.get('usage'))"
}
ask "Can I take paracetamol on an empty stomach? Answer in two short sentences." en
ask "Bolehkah saya makan paracetamol semasa perut kosong? Jawab dalam dua ayat pendek." ms
ask "Can I take paracetamol on an empty stomach? Answer in two short sentences." en-again
