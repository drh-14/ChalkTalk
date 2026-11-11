## Why

The first successful VM startup passed migrations, provider smoke, and public HTTPS, but the workflow could not mark the release successful. The deploy script is streamed into `bash -s` over SSH, and the interactive provider-smoke container can consume the remaining script from stdin before the pending-release marker is written.

## What Changes

- Run provider smoke without giving Docker Compose access to the deploy script's stdin.
- Exercise the actual streamed-script path in a regression test that reproduces a stdin-consuming child process and verifies the pending marker and finish phase.

## Capabilities

### Modified Capabilities

- `automatic-vm-deployment`: A successful streamed stage must complete its post-smoke bookkeeping before the release can be marked successful.

## Impact

Only the production deploy script and its focused tests change. The VM, database, provider integrations, and public API behavior remain unchanged.
