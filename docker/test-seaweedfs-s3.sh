#!/bin/sh
set -eu

endpoint=http://127.0.0.1:8333
access_key=${SEAWEEDFS_ACCESS_KEY_ID:-chalktalk-local}
secret_key=${SEAWEEDFS_SECRET_ACCESS_KEY:-chalktalk-local-secret}
bucket="chalktalk-smoke-$(date +%s)-$$"
object=payload.txt
temporary_directory=$(mktemp -d)
bucket_may_exist=0

s3_request() {
  curl --fail --silent --show-error --retry 20 --retry-delay 1 \
    --retry-all-errors --aws-sigv4 aws:amz:us-east-1:s3 \
    --user "$access_key:$secret_key" "$@"
}

cleanup() {
  result=$?
  trap - 0

  if [ "$bucket_may_exist" -eq 1 ]; then
    if [ "$result" -eq 0 ]; then
      if ! s3_request --request DELETE "$endpoint/$bucket/$object" >/dev/null; then
        result=1
      fi
      if ! s3_request --request DELETE "$endpoint/$bucket" >/dev/null; then
        result=1
      fi
    else
      s3_request --request DELETE "$endpoint/$bucket/$object" >/dev/null 2>&1 || true
      s3_request --request DELETE "$endpoint/$bucket" >/dev/null 2>&1 || true
    fi
  fi

  if [ "$result" -eq 0 ]; then
    object_status=$(curl --silent --show-error --output /dev/null \
      --write-out '%{http_code}' --aws-sigv4 aws:amz:us-east-1:s3 \
      --user "$access_key:$secret_key" "$endpoint/$bucket/$object") || result=1
    bucket_status=$(curl --silent --show-error --output /dev/null \
      --write-out '%{http_code}' --head --aws-sigv4 aws:amz:us-east-1:s3 \
      --user "$access_key:$secret_key" "$endpoint/$bucket") || result=1
    if [ "$object_status" != 404 ] || [ "$bucket_status" != 404 ]; then
      printf 'SeaweedFS smoke data remained after teardown (object: %s, bucket: %s).\n' \
        "$object_status" "$bucket_status" >&2
      result=1
    fi
  fi

  rm -rf "$temporary_directory"
  if [ "$result" -eq 0 ]; then
    printf 'SeaweedFS S3 upload, download, restart persistence, and teardown passed.\n'
  fi
  exit "$result"
}
trap cleanup 0

printf 'ChalkTalk SeaweedFS S3 smoke payload\n' >"$temporary_directory/expected"
bucket_may_exist=1
s3_request --request PUT "$endpoint/$bucket" >/dev/null
s3_request --upload-file "$temporary_directory/expected" \
  "$endpoint/$bucket/$object" >/dev/null
s3_request --output "$temporary_directory/actual" \
  "$endpoint/$bucket/$object"
cmp "$temporary_directory/expected" "$temporary_directory/actual"

docker compose restart seaweedfs >/dev/null
s3_request --output "$temporary_directory/after-restart" \
  "$endpoint/$bucket/$object"
cmp "$temporary_directory/expected" "$temporary_directory/after-restart"
