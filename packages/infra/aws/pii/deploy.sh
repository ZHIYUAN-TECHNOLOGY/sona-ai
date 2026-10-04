#!/bin/bash
# The PII box as a Lambda function in Malaysia, from the image buildspec.yml pushed: creates sona-pii (or points it at
# the image again) and asks it one synthetic line. Nothing bills while it is idle, so there is nothing to take down.
# 6144 MB: the model holds 3.3 GB, and Lambda gives CPU in step with memory. The first call after idle loads the model
# (19-95 s on 4 Oct; 230 s the first time ever); a warm call takes 0.3 s. Function URLs are not offered in Malaysia, so
# callers use Invoke with an HTTP event (packages/api/src/sagemaker.ts, "lambda:sona-pii").
# Usage: AWS_PROFILE=sona bash deploy.sh   (role sona-lambda: lambda.amazonaws.com with AWSLambdaBasicExecutionRole)
set -eu
export AWS_DEFAULT_REGION=ap-southeast-5
A=$(aws sts get-caller-identity --query Account --output text); N=sona-pii; IMAGE="${A}.dkr.ecr.ap-southeast-5.amazonaws.com/sona/pii:2.5.0"
if aws lambda get-function --function-name $N > /dev/null 2>&1; then
  aws lambda update-function-code --function-name $N --image-uri "$IMAGE" --query LastUpdateStatus --output text
  aws lambda wait function-updated-v2 --function-name $N
else
  aws lambda create-function --function-name $N --package-type Image --code "ImageUri=$IMAGE" --role "arn:aws:iam::${A}:role/sona-lambda" \
    --memory-size 6144 --timeout 300 --architectures x86_64 --query State --output text
  aws lambda wait function-active-v2 --function-name $N
fi
OUT=$(mktemp)
BODY='{\"text\":\"Pt Ah Kow, 81M. Anak perempuan, Mei Fong, minta update.\",\"model_name\":\"OpenMed/OpenMed-PII-mClinicalE5-Large-560M-v1\",\"confidence_threshold\":0.5}'
aws lambda invoke --function-name $N --cli-binary-format raw-in-base64-out --cli-read-timeout 320 \
  --payload "{\"version\":\"2.0\",\"rawPath\":\"/pii/extract\",\"rawQueryString\":\"\",\"headers\":{\"content-type\":\"application/json\"},\"requestContext\":{\"http\":{\"method\":\"POST\",\"path\":\"/pii/extract\",\"sourceIp\":\"127.0.0.1\"}},\"body\":\"$BODY\",\"isBase64Encoded\":false}" \
  "$OUT" --query StatusCode --output text
python3 -c "import json; print([(e['text'], e['label']) for e in json.loads(json.load(open('$OUT'))['body'])['entities']])"
