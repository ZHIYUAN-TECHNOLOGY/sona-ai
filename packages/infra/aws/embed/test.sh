#!/bin/bash
# The embedder on SageMaker, Malaysia: bring the endpoint up on one small CPU instance, embed a question and a batch
# of sections the way the Worker does, time them, and leave it running (search has no box to wake). DOWN=1 takes it
# down at the end instead. ml.c6i.large (2 vCPU, 4 GB) as Laya; TYPE= another instance.
# Usage: AWS_PROFILE=sona bash test.sh   (the image comes from buildspec.yml; the weights are at embed/300m/ in S3)
set -u
export AWS_DEFAULT_REGION=ap-southeast-5 AWS_SDK_UA_APP_ID=AWSSkill-SageMaker
A=$(aws sts get-caller-identity --query Account --output text); B="sona-ai-models-${A}-apse5"
N=${N:-sona-embed}; OUT=${OUT:-/tmp/sona-embed-test}; mkdir -p "$OUT"
down() {
  until [ "$(aws sagemaker describe-endpoint --endpoint-name $N --query EndpointStatus --output text 2>/dev/null)" != Creating ]; do sleep 15; done
  aws sagemaker delete-endpoint --endpoint-name $N > /dev/null 2>&1
  for i in $(seq 40); do aws sagemaker describe-endpoint --endpoint-name $N > /dev/null 2>&1 || break; sleep 15; done
  echo "endpoints left running: $(aws sagemaker list-endpoints --query 'length(Endpoints)' --output text)"
}
[ "${DOWN:-}" = 1 ] && trap down EXIT
# A new model and config each run (named by the minute); an endpoint already up is updated to them in place.
V=$N-$(date -u +%m%d%H%M)
aws sagemaker create-model --model-name $V --execution-role-arn "arn:aws:iam::${A}:role/sona-sagemaker-hosting" \
  --primary-container "{\"Image\":\"${A}.dkr.ecr.ap-southeast-5.amazonaws.com/sona/embed:300m\",\"ModelDataSource\":{\"S3DataSource\":{\"S3Uri\":\"s3://${B}/embed/300m/\",\"S3DataType\":\"S3Prefix\",\"CompressionType\":\"None\"}}}" \
  --query ModelArn --output text || exit 1
aws sagemaker create-endpoint-config --endpoint-config-name $V --production-variants \
  "VariantName=main,ModelName=$V,InstanceType=${TYPE:-ml.c6i.large},InitialInstanceCount=1,ContainerStartupHealthCheckTimeoutInSeconds=600" \
  --query EndpointConfigArn --output text || exit 1
T0=$(date +%s)
if aws sagemaker describe-endpoint --endpoint-name $N > /dev/null 2>&1; then
  aws sagemaker update-endpoint --endpoint-name $N --endpoint-config-name $V --query EndpointArn --output text || exit 1
else
  aws sagemaker create-endpoint --endpoint-name $N --endpoint-config-name $V --query EndpointArn --output text || exit 1
fi
sleep 20
for i in $(seq 120); do
  S=$(aws sagemaker describe-endpoint --endpoint-name $N --query EndpointStatus --output text)
  [ "$S" = InService ] && break
  [ "$S" = Failed ] && { aws sagemaker describe-endpoint --endpoint-name $N --query FailureReason --output text; break; }
  sleep 15
done
echo "endpoint $S after $(( ($(date +%s) - T0) / 60 )) min"
[ "$S" = InService ] || { aws logs tail /aws/sagemaker/Endpoints/$N --since 1h 2>/dev/null | tail -25 | cut -c1-240; exit 1; }
# embed <name> <json>: one call, timed; the vectors' count and length printed.
embed() {
  echo "$2" > "$OUT/$1.json"
  T=$(date +%s%N)
  aws sagemaker-runtime invoke-endpoint --endpoint-name $N --content-type application/json --body "fileb://$OUT/$1.json" "$OUT/$1.out" > /dev/null \
    && echo "$1: $(( ($(date +%s%N) - T) / 1000000 )) ms, $(python3 -c "import json; d=json.load(open('$OUT/$1.out'))['data']; print(len(d), 'vectors of', len(d[0]))")" \
    || { echo "$1: FAILED"; cat "$OUT/$1.out" | head -c 300; }
}
embed question '{"text":["task: search result | query: Boleh berhenti antibiotik bila demam dah hilang?"]}'
embed question '{"text":["task: search result | query: 肾脏感染退烧后可以停药吗？"]}'
python3 - > "$OUT/sections.json" <<'PY'
import json
s = "title: none | text: " + " ".join(["Take one tablet of amoxicillin 500 mg three times a day for seven days, with food, and finish the course even when you feel well."] * 20)
print(json.dumps({"text": [s] * 25}))
PY
T=$(date +%s%N); aws sagemaker-runtime invoke-endpoint --endpoint-name $N --content-type application/json --body "fileb://$OUT/sections.json" "$OUT/sections.out" > /dev/null \
  && echo "25 sections of ~600 tokens: $(( ($(date +%s%N) - T) / 1000000 )) ms" || { echo "sections: FAILED"; head -c 300 "$OUT/sections.out"; }
