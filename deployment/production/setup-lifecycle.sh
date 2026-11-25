#!/usr/bin/env bash
# Provision only lifecycle evidence/request storage; no holds, deployment or activation.
set -euo pipefail
if [[ $# != 3 || $EUID != 0 ]]; then
  echo "Usage (root): setup-lifecycle.sh ABSOLUTE_ROOT WRITER_UID WRITER_GID" >&2
  exit 1
fi
root=$1 uid=$2 gid=$3
if [[ $root != /* || $root == / || ! $uid =~ ^[0-9]+$ || ! $gid =~ ^[0-9]+$ || $uid == 0 ]]; then
  echo "Invalid lifecycle directory or non-root writer identity" >&2; exit 1
fi
# Refuse symlinks in every existing path component before changing anything.
path=
IFS=/ read -r -a components <<< "$root"
for component in "${components[@]}"; do
  [[ -z $component ]] && continue
  if [[ $component == . || $component == .. ]]; then echo "Invalid lifecycle path" >&2; exit 1; fi
  path=$path/$component
  if [[ -L $path || ( -e $path && ! -d $path ) ]]; then echo "Unsafe lifecycle path" >&2; exit 1; fi
done
install -d -o 0 -g 0 -m 0700 "$root"
for role in api worker collaboration; do
  for directory in "$root/$role" "$root/$role/requests" "$root/$role/evidence"; do
    if [[ -L $directory || ( -e $directory && ! -d $directory ) ]]; then echo "Unsafe lifecycle role path" >&2; exit 1; fi
  done
  install -d -o 0 -g 0 -m 0700 "$root/$role"
  install -d -o "$uid" -g "$gid" -m 0700 "$root/$role/requests" "$root/$role/evidence"
done
