#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
node --test --test-name-pattern='PORT|static|runtime failure' deployment/local/tests/start.test.mjs
