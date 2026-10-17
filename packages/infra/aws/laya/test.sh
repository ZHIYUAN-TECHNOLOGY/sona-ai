#!/bin/bash
# Laya on SageMaker, Malaysia: bring the endpoint up on one small CPU instance, ask it which card answers three
# requests (the question pickCard asks, packages/api/src/laya.ts), and take it down again, so nothing is left billing.
# ml.c6i.large (2 vCPU, 4 GB): Malaysia has no ml.m5 or ml.m7i for endpoints (4 Oct).
# Usage: AWS_PROFILE=sona bash test.sh   (the image and weights come from buildspec.yml; TYPE= another instance)
set -u
export AWS_DEFAULT_REGION=ap-southeast-5 AWS_SDK_UA_APP_ID=AWSSkill-SageMaker
A=$(aws sts get-caller-identity --query Account --output text); B="sona-ai-models-${A}-apse5"
REV=c75de435cb825110cce8d51ec06a8314d902584d; N=sona-laya; OUT=${OUT:-/tmp/sona-laya-test}; mkdir -p "$OUT"
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
  --primary-container "{\"Image\":\"${A}.dkr.ecr.ap-southeast-5.amazonaws.com/sona/laya:0.3.21\",\"ModelDataSource\":{\"S3DataSource\":{\"S3Uri\":\"s3://${B}/laya/${REV}/\",\"S3DataType\":\"S3Prefix\",\"CompressionType\":\"None\"}}}" \
  --query ModelArn --output text || exit 1
aws sagemaker create-endpoint-config --endpoint-config-name $N --production-variants \
  "VariantName=main,ModelName=$N,InstanceType=${TYPE:-ml.c6i.large},InitialInstanceCount=1,ContainerStartupHealthCheckTimeoutInSeconds=600" \
  --query EndpointConfigArn --output text || exit 1
T0=$(date +%s)
aws sagemaker create-endpoint --endpoint-name $N --endpoint-config-name $N --query EndpointArn --output text || exit 1
for i in $(seq 120); do  # 30 min at most
  S=$(aws sagemaker describe-endpoint --endpoint-name $N --query EndpointStatus --output text)
  [ "$S" = InService ] && break
  [ "$S" = Failed ] && { aws sagemaker describe-endpoint --endpoint-name $N --query FailureReason --output text; break; }
  sleep 15
done
echo "endpoint $S after $(( ($(date +%s) - T0) / 60 )) min"
[ "$S" = InService ] || { aws logs tail /aws/sagemaker/Endpoints/$N --since 1h 2>/dev/null | tail -25 | cut -c1-240; exit 1; }
# ask <name> <request>: the capability question of PICK_QUESTIONS (packages/api/src/laya.ts), cards as trained.
ask() {
  python3 - "$2" > "$OUT/req.json" <<'PY'
import json, sys
cards = {
  "briefing": "Summary of the patient's background, history, allergies and medicines",
  "reasoning": "Differential diagnosis and clinical reasoning",
  "xray": "Chest X-ray reading",
  "medication": "Review current medicines for interactions or problems",
  "prescription": "Write or draft a prescription",
  "followup": "Follow-up visit, safety-netting or a task",
  "note": "Write the consultation note",
  "evidence": "Studies, guidelines or severity score behind a decision",
  "not-covered": "None of the above",
}
print(json.dumps({"model": "multilingual", "state": {"request": sys.argv[1], "patient": "Respiratory review"},
  "questions": {"capability": {"type": "choice", "instructions": "Which clinical result answers this request?", "criteria": cards}}}))
PY
  local t=$(python3 -c "import time; print(time.time())")
  aws sagemaker-runtime invoke-endpoint --endpoint-name $N --content-type application/json --body "fileb://$OUT/req.json" "$OUT/$1.json" > /dev/null || return 1
  python3 -c "import json,time; a=json.load(open('$OUT/$1.json'))['answers']['capability']; print('$1', round(time.time()-$t,2), 's |', a.get('choice'), a.get('answer_confidence'))"
}
ask xray "Can you read this chest X-ray for me?"
ask prescription "Tolong tulis preskripsi salbutamol inhaler untuk dia"
ask note "帮我写今天的问诊记录"
ask xray-again "Can you read this chest X-ray for me?"
# THEN: one more command while the endpoint is up.
[ -z "${THEN:-}" ] || bash -c "$THEN"
