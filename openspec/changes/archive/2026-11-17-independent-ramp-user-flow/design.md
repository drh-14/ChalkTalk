# Design

Follow the approved dated design at `openspec/changes/archive/2026-11-17-independent-ramp-user-flow/2026-11-17-independent-ramp-user-flow.md`. It defines the independent Ramp and optional self-cleaning Smoke lifecycle, one manual VU-limit input, fixed stages, bounded writer/readers, manifest provenance, telemetry, and fail-closed cleanup retries. The compatibility seam is `deployment/load-test/vm_state.py`; legacy active records remain recoverable but never become fresh claims.
