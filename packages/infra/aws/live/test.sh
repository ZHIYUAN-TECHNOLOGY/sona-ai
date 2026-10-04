#!/bin/bash
# Box ④ (sona-live, MiniCPM-o 4.5) in Malaysia at full precision: does it load, and does each second of a call take
# under a second? No single GPU there holds it: on one L4 (21.96 GB usable) it loaded and then ran out of memory setting
# up her voice (4 Oct, twice). So this runs it on ml.g6.12xlarge (4 L4s) with her voice (talker and decoder) on a second GPU
# (VOICE_GPU, packages/infra/baseten/live/data/live.py). Brings the endpoint up, plays one recorded question to it in
# real time inside the box (serve.py), prints each second's time and the GPUs' memory, and takes the endpoint down again.
# Result (4 Oct): it fits (16.7 GB and 6.5 GB of 23) and keeps up. A spoken second: the brain 0.56-0.81 s, her voice
# 0.82-1.02 s beside it (in one line on one GPU's worth of work it was 1.25 s and she fell behind). First sound about
# 2.7 s after the question. With TRANSCRIBE her own writing-down (2.6 s) stalls her voice: leave that to box ② here.
# Not done: a live socket to the endpoint (a call is played inside the box), and nobody has listened to the sound.
# Usage: AWS_PROFILE=sona bash test.sh   (the image and weights come from buildspec.yml; TYPE= another instance)
set -u
export AWS_DEFAULT_REGION=ap-southeast-5 AWS_SDK_UA_APP_ID=AWSSkill-SageMaker
A=$(aws sts get-caller-identity --query Account --output text); B="sona-ai-models-${A}-apse5"
N=sona-live; OUT=${OUT:-/tmp/sona-live-test}; mkdir -p "$OUT"
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
  --primary-container "{\"Image\":\"${A}.dkr.ecr.ap-southeast-5.amazonaws.com/sona/live:1\",\"ModelDataSource\":{\"S3DataSource\":{\"S3Uri\":\"s3://${B}/live/ear1/\",\"S3DataType\":\"S3Prefix\",\"CompressionType\":\"None\"}},\"Environment\":{\"VOICE_GPU\":\"1\"}}" \
  --query ModelArn --output text || exit 1
aws sagemaker create-endpoint-config --endpoint-config-name $N --production-variants \
  "VariantName=main,ModelName=$N,InstanceType=${TYPE:-ml.g6.12xlarge},InitialInstanceCount=1,ContainerStartupHealthCheckTimeoutInSeconds=900,ModelDataDownloadTimeoutInSeconds=1200" \
  --query EndpointConfigArn --output text || exit 1
T0=$(date +%s)
aws sagemaker create-endpoint --endpoint-name $N --endpoint-config-name $N --query EndpointArn --output text || exit 1
for i in $(seq 200); do  # 50 min at most
  S=$(aws sagemaker describe-endpoint --endpoint-name $N --query EndpointStatus --output text)
  [ "$S" = InService ] && break
  [ "$S" = Failed ] && { aws sagemaker describe-endpoint --endpoint-name $N --query FailureReason --output text; break; }
  sleep 15
done
echo "endpoint $S after $(( ($(date +%s) - T0) / 60 )) min"
[ "$S" = InService ] || { aws logs tail /aws/sagemaker/Endpoints/$N --since 1h 2>/dev/null | tail -40 | cut -c1-260; exit 1; }
# call <name> <body>: one invocation; the run goes on inside the box, so ask until it is done.
call() { echo "$2" > "$OUT/req.json"; aws sagemaker-runtime invoke-endpoint --endpoint-name $N --content-type application/json --body "fileb://$OUT/req.json" "$OUT/$1.json" > /dev/null; }
play() {
  call "$1" "{\"run\": $2}" || return 1
  for i in $(seq 40); do sleep 10; call "$1" "{}"; [ "$(python3 -c "import json; print(json.load(open('$OUT/$1.json'))['done'])")" = True ] && break; done
  python3 -c "
import json; d=json.load(open('$OUT/$1.json')); print('== $1 | gpu:', d['gpu']); print('\n'.join(d['run'][-45:]))"
}
SAY="You can take two tablets of paracetamol every six hours. Please call the clinic if the fever stays for three days."
play own '{"SEED": "7"}'                    # she hears the question and answers by herself
play again '{"SEED": "7", "TRANSCRIBE": "1"}'   # the same, and she writes the patient's turn down too
play say "{\"HOLD\": \"1\", \"SAY\": \"$SAY\", \"RATE\": \"4\"}"   # a given answer, 8 seconds of speech
# THEN: one more command while the endpoint is up.
[ -z "${THEN:-}" ] || bash -c "$THEN"
