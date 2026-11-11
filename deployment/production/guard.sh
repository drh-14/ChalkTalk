#!/usr/bin/env bash
# Validate the completed CI event before accessing production credentials.
set -euo pipefail

[[ "${CI_EVENT:-}" == push && "${CI_BRANCH:-}" == main && "${CI_CONCLUSION:-}" == success ]] || {
  echo 'Not a successful main push CI run' >&2; exit 1;
}
[[ "${CI_HEAD_REPOSITORY:-}" == drh-14/ChalkTalk && "${CI_RUN_REPOSITORY:-}" == drh-14/ChalkTalk ]] || {
  echo 'CI run did not originate from ChalkTalk' >&2; exit 1;
}
[[ "${CI_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid CI SHA' >&2; exit 1; }
current="$(git ls-remote https://github.com/drh-14/ChalkTalk.git refs/heads/main | cut -f1)"
[[ "$current" == "$CI_SHA" ]] || { echo 'CI SHA is no longer current main' >&2; exit 1; }
printf '%s\n' "$CI_SHA"
