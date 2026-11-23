#!/usr/bin/env bash
# Disposable guests only. No host mounts, production inventory or credentials.
set -euo pipefail
release="${1:-}"
case "$release" in
  22.04|24.04|26.04) ;;
  *) echo 'Expected Ubuntu 22.04, 24.04 or 26.04' >&2; exit 2 ;;
esac
[[ $# == 1 ]] || { echo 'Expected exactly one Ubuntu release' >&2; exit 2; }
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${RUNNER_OS:-}" == Linux ]] || {
  echo 'Privileged systemd acceptance requires a disposable GitHub-hosted Linux CI runner' >&2
  exit 2
}
script_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
image="chalktalk-maintenance-acceptance:$(basename "$work" | tr '[:upper:]' '[:lower:]')"
guest=''
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "$guest" ]]; then docker rm -f "$guest" >/dev/null || true; fi
  docker image rm "$image" >/dev/null 2>&1 || true
  python3 - "$work" <<'PY'
import shutil
import sys
shutil.rmtree(sys.argv[1])
PY
  exit "$result"
}
trap cleanup EXIT
docker pull "ubuntu:$release"
base="$(docker image inspect "ubuntu:$release" --format '{{index .RepoDigests 0}}')"
printf 'Pinned guest base: %s\n' "$base"
cat > "$work/Dockerfile" <<EOF_DOCKER
FROM $base
ENV DEBIAN_FRONTEND=noninteractive container=docker
RUN apt-get update --error-on=any && apt-get install -y --no-install-recommends systemd systemd-sysv dbus python3 python3-apt unattended-upgrades needrestart openssh-server gnupg apt-utils dpkg-dev gcc libc6-dev && apt-get clean
STOPSIGNAL SIGRTMIN+3
RUN mkdir -p /run/sshd /root/.ssh && chmod 700 /root/.ssh
CMD ["/sbin/init"]
EOF_DOCKER
docker build --label chalktalk.scope=maintenance-acceptance -t "$image" "$work"
docker image inspect "$image" --format '{{.Id}}'
guest="$(docker run -d --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock --tmpfs /tmp --publish 127.0.0.1::22 --label chalktalk.scope=maintenance-acceptance "$image")"
ready=false
for _ in {1..60}; do
  if docker exec "$guest" systemd-run --quiet --wait /bin/true >/dev/null 2>&1; then ready=true; break; fi
  [[ "$(docker inspect --format '{{.State.Running}}' "$guest")" == true ]] || break
  sleep 1
done
if [[ "$ready" != true ]]; then
  docker logs "$guest" >&2
  echo 'Acceptance failed: guest cannot execute real systemd units' >&2
  exit 1
fi
docker exec "$guest" sh -eu -c '
  test "$(cat /proc/1/comm)" = systemd
  cat /etc/os-release
  dpkg-query -W apt systemd unattended-upgrades needrestart python3-apt
  apt-config dump >/dev/null
  apt-cache policy >/dev/null
  systemd-run --wait --pipe /bin/true
'
command -v ansible-playbook >/dev/null
ssh-keygen -q -t ed25519 -N '' -f "$work/key"
docker exec -i "$guest" sh -c 'cat > /root/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys' < "$work/key.pub"
docker exec "$guest" systemctl start ssh
port="$(docker port "$guest" 22/tcp | cut -d: -f2)"
docker exec "$guest" cat /etc/ssh/ssh_host_ed25519_key.pub | awk -v port="$port" '{print "[127.0.0.1]:" port, $1, $2}' > "$work/known_hosts"
printf '[chalktalk]\n127.0.0.1 ansible_user=root ansible_port=%s ansible_python_interpreter=/usr/bin/python3\n' "$port" > "$work/inventory"
export ANSIBLE_SSH_ARGS="-o UserKnownHostsFile=$work/known_hosts -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes"
docker exec "$guest" install -d -m 0755 /etc/docker
docker exec -i "$guest" sh -c 'cat > /etc/docker/daemon.json' <<'DOCKER_SENTINEL'
{"live-restore":true,"labels":["disposable-acceptance-preserve"]}
DOCKER_SENTINEL
docker exec -i "$guest" sh -c 'cat > /etc/apt/apt.conf.d/50acceptance-exclusion' <<'EXCLUSION'
Unattended-Upgrade::Package-Blacklist { "^ct-operator$"; };
EXCLUSION
ansible-playbook -i "$work/inventory" --private-key "$work/key" "$script_dir/maintenance-acceptance.yml"
docker exec "$guest" /usr/local/lib/chalktalk-maintenance/hold.sh set update
docker exec "$guest" sh -c 'find /usr/local/lib/chalktalk-maintenance /etc/systemd/system/apt-daily*.d -maxdepth 1 -type f -exec sha256sum {} \; ; sha256sum /etc/apt/apt.conf.d/zz-chalktalk-maintenance /etc/needrestart/conf.d/99-chalktalk.conf /etc/docker/daemon.json /etc/apt/apt.conf.d/50acceptance-exclusion' | sort > "$work/before.hashes"
ansible-playbook -i "$work/inventory" --private-key "$work/key" "$script_dir/maintenance-acceptance.yml" | tee "$work/second-apply.log"
grep -Eq 'changed=0[[:space:]]+unreachable=0[[:space:]]+failed=0' "$work/second-apply.log" || { echo 'Second Ansible application was not idempotent' >&2; exit 1; }
docker exec "$guest" sh -c 'find /usr/local/lib/chalktalk-maintenance /etc/systemd/system/apt-daily*.d -maxdepth 1 -type f -exec sha256sum {} \; ; sha256sum /etc/apt/apt.conf.d/zz-chalktalk-maintenance /etc/needrestart/conf.d/99-chalktalk.conf /etc/docker/daemon.json /etc/apt/apt.conf.d/50acceptance-exclusion' | sort > "$work/after.hashes"
diff -u "$work/before.hashes" "$work/after.hashes"
docker exec "$guest" test -f /var/lib/chalktalk-maintenance/update.hold
docker exec "$guest" /usr/local/lib/chalktalk-maintenance/hold.sh clear update
docker exec -i "$guest" sh -c 'cat > /opt/maintenance_repository.py' < "$script_dir/maintenance_repository.py"
docker exec -i "$guest" sh -c 'cat > /opt/maintenance_process.py' < "$script_dir/maintenance_process.py"
docker exec -i "$guest" sh -c 'cat > /opt/maintenance-deploy.sh' < "$script_dir/../../deploy.sh"
docker exec -e PYTHONPATH=/opt -i "$guest" python3 - -v < "$script_dir/maintenance_guest.py"

docker exec -i "$guest" sh -c 'cat > /etc/systemd/system/apt-daily-upgrade.timer.d/zz-acceptance-drift.conf' <<'TIMER_DRIFT'
[Timer]
RandomizedDelaySec=45m
TIMER_DRIFT
docker exec "$guest" systemctl daemon-reload
if ansible-playbook -i "$work/inventory" --private-key "$work/key" "$script_dir/maintenance-acceptance.yml"; then
  echo 'Unsafe later timer configuration was incorrectly accepted' >&2
  exit 1
fi
docker exec "$guest" test -f /var/lib/chalktalk-maintenance/bootstrap.hold
docker exec "$guest" test -f /etc/systemd/system/apt-daily-upgrade.timer.d/zz-acceptance-drift.conf
docker exec "$guest" sh -c '/usr/local/lib/chalktalk-maintenance/hold.sh clear bootstrap "$(cat /var/lib/chalktalk-maintenance/bootstrap.hold)"'
docker exec "$guest" rm /etc/systemd/system/apt-daily-upgrade.timer.d/zz-acceptance-drift.conf
docker exec "$guest" systemctl daemon-reload

# An unsafe later operator fragment must fail verification and leave the bootstrap hold.
docker exec -i "$guest" sh -c 'cat > /etc/apt/apt.conf.d/zzzz-acceptance-drift' <<'DRIFT'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Origins-Pattern:: "origin=Forbidden,archive=unsafe";
DRIFT
if ansible-playbook -i "$work/inventory" --private-key "$work/key" "$script_dir/maintenance-acceptance.yml"; then
  echo 'Unsafe later configuration was incorrectly accepted' >&2
  exit 1
fi
docker exec "$guest" test -f /var/lib/chalktalk-maintenance/bootstrap.hold
docker exec "$guest" test -f /etc/apt/apt.conf.d/zzzz-acceptance-drift
if ansible-playbook -i "$work/inventory" --private-key "$work/key" "$script_dir/maintenance-acceptance.yml"; then
  echo 'Bootstrap incorrectly took over a previous failure hold' >&2
  exit 1
fi
docker exec "$guest" sh -c '/usr/local/lib/chalktalk-maintenance/hold.sh clear bootstrap "$(cat /var/lib/chalktalk-maintenance/bootstrap.hold)"'
docker exec "$guest" rm /etc/apt/apt.conf.d/zzzz-acceptance-drift
docker exec -i "$guest" sh -c 'cat > /etc/apt/sources.list.d/acceptance-bootstrap-failure.list' <<'BOOTSTRAP_FAILURE'
deb [trusted=yes] file:/opt/absent-acceptance-bootstrap ./
BOOTSTRAP_FAILURE
docker exec "$guest" sh -c 'rm -rf /var/lib/apt/lists/*'
if DOMAIN=fixture.invalid DATABASE_URL=fixture SUPABASE_STORAGE_ENDPOINT=fixture SUPABASE_STORAGE_BUCKET=fixture SUPABASE_STORAGE_REGION=fixture SUPABASE_STORAGE_ACCESS_KEY_ID=fixture SUPABASE_STORAGE_SECRET_ACCESS_KEY=fixture AUTH_TOKEN_SECRET=0123456789abcdef0123456789abcdef RESEND_API_KEY=fixture METRICS_TOKEN=0123456789abcdef0123456789abcdef GRAFANA_ADMIN_PASSWORD=0123456789abcdef0123456789abcdef ansible-playbook -i "$work/inventory" --private-key "$work/key" "$script_dir/../bootstrap.yml" > "$work/bootstrap.log" 2>&1; then
  echo 'Actual bootstrap unexpectedly passed broken package sources' >&2
  exit 1
fi
grep -Fq 'TASK [Install host prerequisites]' "$work/bootstrap.log" || {
  cat "$work/bootstrap.log" >&2
  echo 'Actual bootstrap failed before its package task' >&2
  exit 1
}
docker exec "$guest" test -s /var/lib/chalktalk-maintenance/bootstrap.hold
echo "Ubuntu $release maintenance acceptance passed"
