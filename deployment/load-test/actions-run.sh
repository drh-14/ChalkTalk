#!/usr/bin/env bash
# Manually dispatched, production-environment-only Actions runner.
set -euo pipefail
umask 077
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)
[[ ${GITHUB_ACTIONS:-} == true && ${GITHUB_REF:-} == refs/heads/main && ${GITHUB_REPOSITORY:-} == drh-14/ChalkTalk ]] || { echo 'Trusted main Actions dispatch required' >&2; exit 2; }
[[ ${MODE:-} == smoke || ${MODE:-} == ramp ]] || { echo 'Choose smoke or ramp' >&2; exit 2; }
[[ ${GITHUB_RUN_ATTEMPT:-} == 1 ]] || { echo 'GitHub Actions rerun refused before fixture access' >&2; exit 2; }
[[ -z ${RUN_ID:-} ]] || { echo 'Externally supplied run ID refused' >&2; exit 2; }
RUN_ID=
[[ ${EXPECTED_SHA:-} =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid deployed SHA' >&2; exit 2; }
[[ ${GITHUB_RUN_ID:-} =~ ^[0-9]{6,30}$ ]] || { echo 'GitHub run identity required' >&2; exit 2; }
[[ $(git -C "$repo_root" rev-parse HEAD) == "$EXPECTED_SHA" ]] || { echo 'Checkout SHA mismatch' >&2; exit 2; }
current_main=$(git ls-remote https://github.com/drh-14/ChalkTalk.git refs/heads/main | cut -f1)
[[ $current_main == "$EXPECTED_SHA" ]] || { echo 'Dispatch is not current main' >&2; exit 2; }
[[ ${VM_HOST:-} =~ ^[a-zA-Z0-9.-]+$ && -n ${SSH_PRIVATE_KEY:-} && -n ${VM_KNOWN_HOSTS:-} ]] || { echo 'Pinned VM SSH configuration is incomplete' >&2; exit 2; }
command -v docker >/dev/null
command -v jq >/dev/null
command -v ssh >/dev/null
command -v scp >/dev/null
command -v node >/dev/null
command -v sha256sum >/dev/null
command -v timeout >/dev/null
input_dir=$(mktemp -d)
credential_dir=$(mktemp -d)
raw_dir=$(mktemp -d)
chmod 700 "$input_dir" "$credential_dir" "$raw_dir"
sanitized_dir=${LOAD_TEST_REPORT_DIR:?Sanitized report directory required}
vm_root=/srv/chalktalk/shared/load-test
profile_vm_path="$vm_root/attempt-$GITHUB_RUN_ID.profile.json"
release="/srv/chalktalk/releases/$EXPECTED_SHA"
claimed=false
artifacts_published=false
source_workflow_url=
tunnel_pid=
cleanup_failed=false
cleanup_verified=false
report_status=not-attempted
email_status=not-attempted
traffic_status=not-started
summary_file=${GITHUB_STEP_SUMMARY:-/dev/null}
workload_start_utc=
workload_end_utc=
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  if [[ $traffic_status == running ]]; then traffic_status=failed-or-incomplete; fi
  if [[ -n $workload_start_utc && -z $workload_end_utc ]]; then
    workload_end_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  fi
  if [[ -n $workload_start_utc ]]; then
    printf '{"start":"%s","end":"%s"}\n' "$workload_start_utc" "$workload_end_utc" > "$raw_dir/window.json"
  fi
  if [[ -n $tunnel_pid ]]; then kill "$tunnel_pid" 2>/dev/null || true; wait "$tunnel_pid" 2>/dev/null || true; fi
  if [[ $claimed == true && -z $RUN_ID ]]; then
    cleanup_failed=true
  elif [[ $claimed == true ]]; then
    echo 'Attempting reviewed VM fixture cleanup' >&2
    cleanup_deadline=$(($(date +%s) + 120))
    if vm_ssh_cleanup "test -f $vm_root/$RUN_ID.json"; then
      local attempt step_error retryable cleanup_baseline=
      for attempt in 1 2 3; do
        retryable=false
        step_error="$raw_dir/cleanup-error"
        if ! vm_ssh_cleanup "bash $release/deployment/load-test/vm_fixture.sh inventory $RUN_ID $EXPECTED_SHA $project_ref $db_host" > "$raw_dir/final-inventory.json" 2>"$step_error"; then
          if grep -q 'CONNECTION_ACQUISITION_EXHAUSTED' "$step_error"; then retryable=true; fi
        elif ! node "$script_dir/verify-inventory.mjs" "$raw_dir/final-inventory.json" ${cleanup_baseline:+"$cleanup_baseline"}; then
          cleanup_failed=true
          break
        else
          if [[ -z $cleanup_baseline ]]; then
            cleanup_baseline="$raw_dir/cleanup-baseline.json"
            cp -- "$raw_dir/final-inventory.json" "$cleanup_baseline"
          fi
          if ! vm_ssh_cleanup "bash $release/deployment/load-test/vm_fixture.sh teardown $RUN_ID $EXPECTED_SHA $project_ref $db_host $RUN_ID" > "$raw_dir/teardown.json" 2>"$step_error"; then
            if grep -q 'CONNECTION_ACQUISITION_EXHAUSTED' "$step_error"; then retryable=true; fi
          else
            if ! jq -e --arg run "$RUN_ID" '.runId == $run and .residue == 0 and .manifestRemoved == true' "$raw_dir/teardown.json" >/dev/null; then
              cleanup_failed=true
            else
              local cleaned_state
              if ! cleaned_state=$(vm_ssh "python3 $release/deployment/load-test/vm_state.py mark-cleaned --root $vm_root --run-id $RUN_ID --deployed-sha $EXPECTED_SHA --profile-file $profile_vm_path"); then
                cleanup_failed=true
              elif ! printf '%s' "$cleaned_state" | jq -e --arg run "$RUN_ID" --arg sha "$EXPECTED_SHA" '.runId == $run and .deployedSha == $sha and .status == "cleaned"' >/dev/null; then
                cleanup_failed=true
              else
                cleanup_verified=true
                printf '{"runId":"%s","mode":"%s","zeroResidue":true,"manifestRemoved":true,"state":"cleaned"}\n' "$RUN_ID" "$MODE" > "$raw_dir/cleanup-receipt.json"
              fi
            fi
            break
          fi
        fi
        if [[ $retryable != true || $attempt == 3 || $(date +%s) -ge $((cleanup_deadline - 30)) ]]; then cleanup_failed=true; break; fi
        echo 'Connection-acquisition exhaustion during cleanup; retrying after quiescence' >&2
        sleep 30
      done
    else
      cleanup_failed=true
    fi
  fi
  if [[ $artifacts_published != true && -f $input_dir/manifest.json ]]; then
    if ! node "$script_dir/sanitize-artifacts.mjs" "$input_dir/manifest.json" "$raw_dir" "$sanitized_dir" "$RUN_ID" "$MODE" "$source_workflow_url"; then
      report_status=failed
    fi
  fi
  if [[ $report_status == generated && ! -f $sanitized_dir/report.html ]]; then report_status=failed; fi
  if [[ $cleanup_verified == true && $report_status == generated && -f $sanitized_dir/report.html ]]; then
    local delivery
    if [[ -n ${RESEND_API_KEY:-} ]]; then
      delivery=$(node "$script_dir/email-report.mjs" "$sanitized_dir" "$raw_dir/cleanup-receipt.json" "$input_dir/manifest.json" "$RUN_ID" "$MODE") || true
      email_status=$(printf '%s' "$delivery" | jq -er '.status // "failed"' 2>/dev/null || echo failed)
    else
      email_status=failed
    fi
  fi
  if [[ $cleanup_failed == true ]]; then
    echo 'Load-test cleanup or report sanitization needs manual review; state remains consumed' >&2
    result=1
  fi
  if [[ $report_status == failed ]]; then result=1; fi
  local fixture_status=not-claimed
  local effective_profile=unavailable
  if [[ -f $input_dir/profile.json ]]; then
    effective_profile=$(jq -r '"max VUs=\(.maxVus), stage minutes=\(.stageMinutes | join(",")), ramp write attempts=\(.rampWriteAttempts)"' "$input_dir/profile.json")
  fi
  if [[ $claimed == true ]]; then
    if [[ $cleanup_verified == true ]]; then
      fixture_status=verified
    else
      fixture_status=manual-recovery-required
    fi
  fi
  {
    echo "## Bounded k6 $MODE — ${RUN_ID:-not-resolved}"
    echo "- Source workflow: ${source_workflow_url:-not-selected}"
    if [[ $MODE == ramp ]]; then
      echo "- Selected ordinary course activity: three isolated courses, course/feed/post/notification and resource metadata reads, bounded post and Thread writes, Thread signal socket"
    else
      echo "- Minimal readiness flows: login, course/feed/post/notification reads and one vote"
    fi
    echo "- Not all app flows: signup/email workflows, course administration, file upload/download/OCR, collaboration and destructive actions are excluded"
    echo "- Production deployment SHA: $EXPECTED_SHA"
    echo "- Effective bounded profile: $effective_profile"
    echo "- Workload UTC window: ${workload_start_utc:-not-started} → ${workload_end_utc:-not-started}"
    echo "- Test outcome: $traffic_status"
    echo "- Fixture cleanup: $fixture_status"
    echo "- Custom report: $report_status"
    echo "- Report email delivery: $email_status"
    echo "- Overall workflow: $([[ $result -eq 0 ]] && echo passed || echo failed-or-incomplete)"
    echo "- Grafana: Load Tests / Load Test Correlation, run ID ${RUN_ID:-not-resolved} (private VM access required)"
    echo "- Supabase Studio baseline and warnings require human review"
  } >> "$summary_file"
  rm -rf -- "$input_dir" "$credential_dir" "$raw_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "$SSH_PRIVATE_KEY" > "$credential_dir/id_ed25519"
printf '%s\n' "$VM_KNOWN_HOSTS" > "$credential_dir/known_hosts"
chmod 600 "$credential_dir/id_ed25519" "$credential_dir/known_hosts"
ssh-keygen -F "$VM_HOST" -f "$credential_dir/known_hosts" >/dev/null || { echo 'Pinned VM host key missing' >&2; exit 2; }
ssh_options=(-p 22 -i "$credential_dir/id_ed25519" -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$credential_dir/known_hosts")
vm_ssh() { ssh "${ssh_options[@]}" "ubuntu@$VM_HOST" "$1"; }
vm_ssh_cleanup() {
  local remaining=$((cleanup_deadline - $(date +%s)))
  (( remaining > 0 )) || return 124
  timeout "${remaining}s" ssh "${ssh_options[@]}" "ubuntu@$VM_HOST" "$1"
}
vm_scp() { scp -P 22 -i "$credential_dir/id_ed25519" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$credential_dir/known_hosts" "$@"; }
node "$script_dir/prepare-runner.mjs" "$input_dir"
project_ref=$(jq -r .projectRef "$input_dir/identity.json")
db_host=$(jq -r .databaseHost "$input_dir/identity.json")
nonce=$(jq -r .nonce "$input_dir/identity.json")
mac=$(jq -r .mac "$input_dir/identity.json")
[[ $(vm_ssh 'cat /srv/chalktalk/shared/deployed.sha') == "$EXPECTED_SHA" ]] || { echo 'VM is not running the dispatched main SHA' >&2; exit 1; }
ssh "${ssh_options[@]}" -o ExitOnForwardFailure=yes -N -L 19090:127.0.0.1:9090 "ubuntu@$VM_HOST" &
tunnel_pid=$!
for _ in {1..15}; do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:19090/-/ready >/dev/null 2>&1; then break; fi
  kill -0 "$tunnel_pid" || { echo 'Private metrics tunnel failed' >&2; exit 1; }
  sleep 1
done
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:19090/-/ready >/dev/null
node "$script_dir/preflight.mjs" ready "$RUN_ID"
vm_ssh "install -d -m 0700 $vm_root"
vm_scp "$input_dir/profile.json" "ubuntu@$VM_HOST:$profile_vm_path"
claim_result=$(vm_ssh "python3 $release/deployment/load-test/vm_state.py claim-$MODE-auto --root $vm_root --deployed-sha $EXPECTED_SHA --profile-file $profile_vm_path --project-ref $project_ref --database-host $db_host --nonce $nonce --mac $mac --source-run-id $GITHUB_RUN_ID")
claimed=true
RUN_ID=$(printf '%s' "$claim_result" | jq -er .runId)
source_workflow_url=$(printf '%s' "$claim_result" | jq -er .sourceRunUrl)
[[ $RUN_ID =~ ^load-[0-9]{8}-[a-z0-9]{8,32}$ && $source_workflow_url =~ ^https://github.com/drh-14/ChalkTalk/actions/runs/[0-9]+$ ]] || { echo 'VM claim response identity invalid; manual review required' >&2; exit 1; }
vm_ssh "python3 $release/deployment/load-test/vm_control.py prepare --root $vm_root --run-id $RUN_ID --deployed-sha $EXPECTED_SHA --project-ref $project_ref --database-host $db_host --nonce $nonce --mac $mac" >/dev/null
vm_ssh "bash $release/deployment/load-test/vm_fixture.sh provision $RUN_ID $EXPECTED_SHA $project_ref $db_host $MODE" >/dev/null
vm_ssh "bash $release/deployment/load-test/vm_fixture.sh inventory $RUN_ID $EXPECTED_SHA $project_ref $db_host" > "$raw_dir/inventory.json"
node "$script_dir/verify-inventory.mjs" "$raw_dir/inventory.json"
vm_scp "ubuntu@$VM_HOST:$vm_root/$RUN_ID.json" "$input_dir/manifest.json"
chmod 600 "$input_dir/manifest.json"
verified_manifest=$(vm_ssh "python3 $release/deployment/load-test/vm_state.py verify-fixture --root $vm_root --run-id $RUN_ID --deployed-sha $EXPECTED_SHA --profile-file $profile_vm_path" | jq -er .verifiedManifestSha256)
[[ $verified_manifest =~ ^[0-9a-f]{64}$ && $(sha256sum "$input_dir/manifest.json" | cut -d' ' -f1) == "$verified_manifest" ]] || { echo 'Copied fixture manifest digest mismatch' >&2; exit 1; }
echo "Starting bounded $MODE for $RUN_ID; selected core API flows only"
traffic_status=running
workload_start_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -v "$input_dir:/input:ro" -v "$raw_dir:/reports" -v "$script_dir:/scripts:ro" \
  -e MODE="$MODE" -e MANIFEST_PATH=/input/manifest.json -e PROFILE_PATH=/input/profile.json \
  -e RUN_ID="$RUN_ID" -e DEPLOYED_SHA="$EXPECTED_SHA" -e CONFIRM_PRODUCTION=joinchalktalk.com \
  -e REPORT_DIR=/reports -e K6_PROMETHEUS_RW_SERVER_URL=http://127.0.0.1:19090/api/v1/write \
  -e 'K6_PROMETHEUS_RW_TREND_STATS=p(50),p(90),p(95),p(99)' \
  -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_HOST=127.0.0.1 \
  -e K6_WEB_DASHBOARD_EXPORT="/reports/$RUN_ID-$MODE.html" \
  grafana/k6:2.4.0@sha256:d41bb79cd8de5a7ad619b53570e3712633e8bff0937010a5c6c57a4747e7a276 \
  run --out experimental-prometheus-rw --summary-trend-stats='avg,med,p(90),p(95),p(99)' /scripts/workload.js
workload_end_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
node "$script_dir/coverage.mjs" "$MODE" "$raw_dir/$RUN_ID-$MODE-summary.json" "$input_dir/manifest.json" > "$raw_dir/coverage.json"
sleep 120
node "$script_dir/preflight.mjs" all "$RUN_ID"
traffic_status=passed
printf '{"start":"%s","end":"%s"}\n' "$workload_start_utc" "$workload_end_utc" > "$raw_dir/window.json"
if node "$script_dir/report.mjs" "$RUN_ID" "$raw_dir/window.json" "$raw_dir/$RUN_ID-$MODE-summary.json" "$raw_dir/report.html"; then
  report_status=generated
else
  report_status=failed
fi
node "$script_dir/sanitize-artifacts.mjs" "$input_dir/manifest.json" "$raw_dir" "$sanitized_dir" "$RUN_ID" "$MODE" "$source_workflow_url"
artifacts_published=true
