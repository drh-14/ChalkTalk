#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
node --test deployment/local/tests/start.test.mjs
