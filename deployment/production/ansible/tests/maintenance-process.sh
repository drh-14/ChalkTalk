#!/usr/bin/env bash
# Nonprivileged process tests only: no systemd acceptance claim, no host mounts.
set -euo pipefail
release="${1:-22.04}"
case "$release" in 22.04) code=jammy ;; 24.04) code=noble ;; 26.04) code=resolute ;; *) exit 2 ;; esac
script_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
image="chalktalk-maintenance-process:$(basename "$work" | tr '[:upper:]' '[:lower:]')"
cleanup() {
  result=$?
  trap - EXIT
  docker image rm "$image" >/dev/null 2>&1 || true
  python3 - "$work" <<'PY'
import shutil,sys
shutil.rmtree(sys.argv[1])
PY
  exit "$result"
}
trap cleanup EXIT
python3 - "$script_dir" "$work" "$code" <<'PY'
from pathlib import Path
import shutil,sys
from jinja2 import Environment, StrictUndefined
source, work, code = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
shutil.copytree(source / '../../maintenance', work / 'maintenance', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
shutil.copy(source / 'maintenance_process.py', work)
shutil.copy(source / '../../deploy.sh', work / 'maintenance-deploy.sh')
for name, destination in [('maintenance-apt.conf.j2','apt.conf'), ('maintenance-needrestart.conf.j2','needrestart.conf')]:
    template = Environment(undefined=StrictUndefined).from_string((source / '../templates' / name).read_text())
    (work / destination).write_text(template.render(ansible_distribution_release=code))
PY
cat > "$work/Dockerfile" <<EOF_DOCKER
FROM ubuntu:$release
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update --error-on=any && apt-get install -y --no-install-recommends python3 python3-apt unattended-upgrades needrestart && apt-get clean
COPY maintenance/ /usr/local/lib/chalktalk-maintenance/
RUN install -d -o root -g root -m 0755 /var/lib/chalktalk-maintenance && python3 /usr/local/lib/chalktalk-maintenance/policy.py capture-exclusions
COPY apt.conf /etc/apt/apt.conf.d/zz-chalktalk-maintenance
COPY needrestart.conf /etc/needrestart/conf.d/99-chalktalk.conf
COPY maintenance_process.py /opt/maintenance_process.py
COPY maintenance-deploy.sh /opt/maintenance-deploy.sh
CMD ["sh", "-c", "python3 /usr/local/lib/chalktalk-maintenance/policy.py; exec python3 /opt/maintenance_process.py -v"]
EOF_DOCKER
docker build -t "$image" "$work"
docker run --rm --security-opt no-new-privileges "$image"
