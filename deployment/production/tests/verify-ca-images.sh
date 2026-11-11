#!/usr/bin/env bash
# Execute the production Node images and verify the pinned CA is in Node's extra trust store.
set -euo pipefail

cd "$(dirname "$0")/../../.."
if (( $# == 0 )); then
  set -- api worker collaboration
fi

for service in "$@"; do
  case "$service" in
    api|worker|collaboration) ;;
    *) echo "Unknown production image: $service" >&2; exit 2 ;;
  esac
  image="chalktalk-ca-${service}:test"
  docker build -q -f "deployment/production/Dockerfile.${service}" -t "$image" . >/dev/null
  docker run --rm -i "$image" node - <<'NODE'
const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const tls = require('node:tls');

assert.ok(process.env.NODE_EXTRA_CA_CERTS, 'NODE_EXTRA_CA_CERTS must be set');
const expected = '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
const fingerprints = tls.getCACertificates('extra').map((pem) =>
  new X509Certificate(pem).fingerprint256.replaceAll(':', '').toLowerCase(),
);
assert.ok(fingerprints.includes(expected), 'Supabase Root 2021 CA is not loaded by Node');
NODE
  echo "Production $service image loads the pinned Supabase CA"
done
