## 1. Specification-driven tests

- [x] 1.1 Add verifier tests for idle healthy API, one-to-two scrape progression, unhealthy target timeout, and missing post-smoke HTTP/DB samples; run them red against current code
- [x] 1.2 Add executable runner test proving a failed pre-claim wait does not invoke VM claim or fixture commands; run it red

## 2. Implementation

- [x] 2.1 Split pre-traffic and post-traffic telemetry checks, implement a bounded readiness poll with target diagnostics, and pass focused tests
- [x] 2.2 Move preflight before VM attempt claim/provision in the Actions runner and pass runner ordering tests
- [x] 2.3 Update operator documentation to explain idle-API handling and the retained post-smoke gate; verify documentation against implementation

## 3. ID-free workflow and VM safety

- [x] 3.1 Add tests-first VM state cases for singleton blocking, legacy cleaned records, exact one-candidate ramp discovery, identity/age/manifest rejection, and atomic claim; run them red then green
- [x] 3.2 Add executable workflow/runner tests for no-input separate dispatches, trusted generated Smoke ID, provenance in summary/report, rerun refusal, and no-ID Ramp selection; run them red then green
- [x] 3.3 Update the runbook and deployment tests for the new operator UX; verify neither flow accepts a run-ID input or silently dispatches load

## 4. Delivery

- [x] 4.1 Run OpenSpec strict validation, focused/full relevant checks, and isolated runner verification without production access
- [x] 4.2 Prepare the validated OpenSpec change for archive after implementation checks pass
