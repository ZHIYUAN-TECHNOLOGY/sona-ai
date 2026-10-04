#!/bin/bash
# Box ② on SageMaker, Malaysia: bring the endpoint up on one L4, try its three jobs (write down speech, speak a line,
# rerank), and take it down again so nothing is left billing.
# Usage: AWS_PROFILE=sona bash test.sh <speech.wav> [more.wav ...]   (image and weights come from buildspec.yml)
set -u
export AWS_DEFAULT_REGION=ap-southeast-5 AWS_SDK_UA_APP_ID=AWSSkill-SageMaker
A=$(aws sts get-caller-identity --query Account --output text); B="sona-ai-models-${A}-apse5"
N=sona-voice; TYPE=${TYPE:-ml.g6.2xlarge}; OUT=${OUT:-/tmp/sona-voice-test}; mkdir -p "$OUT"
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
  --primary-container "{\"Image\":\"${A}.dkr.ecr.ap-southeast-5.amazonaws.com/sona/voice:2\",\"ModelDataSource\":{\"S3DataSource\":{\"S3Uri\":\"s3://${B}/voice/1/\",\"S3DataType\":\"S3Prefix\",\"CompressionType\":\"None\"}}}" \
  --query ModelArn --output text || exit 1
aws sagemaker create-endpoint-config --endpoint-config-name $N --production-variants \
  "VariantName=main,ModelName=$N,InstanceType=$TYPE,InitialInstanceCount=1,ContainerStartupHealthCheckTimeoutInSeconds=900,ModelDataDownloadTimeoutInSeconds=1200" \
  --query EndpointConfigArn --output text || exit 1
T0=$(date +%s)
aws sagemaker create-endpoint --endpoint-name $N --endpoint-config-name $N --query EndpointArn --output text || exit 1
for i in $(seq 180); do
  S=$(aws sagemaker describe-endpoint --endpoint-name $N --query EndpointStatus --output text)
  [ "$S" = InService ] && break
  [ "$S" = Failed ] && { aws sagemaker describe-endpoint --endpoint-name $N --query FailureReason --output text; break; }
  sleep 15
done
echo "endpoint $S on $TYPE after $(( ($(date +%s) - T0) / 60 )) min"
[ "$S" = InService ] || { aws logs tail /aws/sagemaker/Endpoints/$N --since 1h 2>/dev/null | grep -vE 'Warning|deprecated' | tail -30 | cut -c1-260; exit 1; }
call() {  # call <content-type> <body file> <out file>: seconds taken
  python3 - "$@" <<'PY'
import subprocess, sys, time
t = time.time()
r = subprocess.run(["aws", "sagemaker-runtime", "invoke-endpoint", "--endpoint-name", "sona-voice", "--content-type", sys.argv[1], "--body", "fileb://" + sys.argv[2], sys.argv[3]], capture_output=True, text=True)
print(f"{time.time() - t:.1f} s" if r.returncode == 0 else "FAILED " + r.stderr.strip()[-300:])
PY
}
for wav in "$@"; do
  python3 - "$wav" "$OUT/form.bin" <<'PY'
import sys
b = "sonaformboundary"; wav = open(sys.argv[1], "rb").read()
body = (f'--{b}\r\nContent-Disposition: form-data; name="model"\r\n\r\nsona-asr\r\n--{b}\r\nContent-Disposition: form-data; name="file"; filename="speech.wav"\r\n'
        f'Content-Type: audio/wav\r\n\r\n').encode() + wav + f"\r\n--{b}--\r\n".encode()
open(sys.argv[2], "wb").write(body)
PY
  echo "heard $(basename "$wav"): $(call 'multipart/form-data; boundary=sonaformboundary' "$OUT/form.bin" "$OUT/heard.json") | $(python3 -c "import json; print(json.load(open('$OUT/heard.json')).get('text'))")"
done
i=0
for line in "Take one tablet after food, three times a day." "Makan satu biji selepas makan, tiga kali sehari."; do
  i=$((i + 1)); echo "{\"text\": \"$line\"}" > "$OUT/say.json"
  echo "spoke line $i: $(call application/json "$OUT/say.json" "$OUT/say$i.mp3") | $(wc -c < "$OUT/say$i.mp3" | tr -d ' ') bytes -> $OUT/say$i.mp3"
done
echo '{"query": "When should I take amoxicillin?", "passages": ["Amoxicillin 500mg: take 1 tablet three times a day after food.", "Follow-up at the clinic on Thursday."]}' > "$OUT/rank.json"
echo "rerank: $(call application/json "$OUT/rank.json" "$OUT/rank.out") | $(cat "$OUT/rank.out")"
# THEN: one more command while the endpoint is up.
[ -z "${THEN:-}" ] || bash -c "$THEN"
