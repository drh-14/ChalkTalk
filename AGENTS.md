# Working instructions

## Delegation threshold

Handle small and medium changes directly. Use the architect → user decision → planning → implementation handoff only for large changes.

A change is large when it has unresolved structural decisions or substantial implementation risk, such as introducing a service or dependency, changing data ownership or component boundaries, defining a new cross-system protocol, requiring a migration, or coordinating several independently complex subsystems. Decide this before delegating. File count and repetitive edits alone do not make a change large.

Documentation wording, formatting, examples, schema parity, and mechanical cross-file updates are direct work. Once the user has approved an API or architecture decision, apply its documentation updates directly unless implementation still requires a new structural decision.

For direct work, inspect the affected files, make the change, run focused validation, and report the result. Use the change workflow below for behavior changes regardless of size. For large work, involve the user in architecture and planning decisions, then hand the approved plan to implementation without requesting redundant approval.

An explicit user request to skip or use delegation overrides the default threshold.

## Change workflow

1. For product, API, database, or UI behavior changes, create or update an OpenSpec change before implementation. Complete and validate its proposal, affected specs, design, and tasks; resolve material decisions with the user before coding. Wording-only documentation, formatting, and mechanical changes that do not alter behavior do not require an OpenSpec change.
2. Implement the approved behavior with tests written from the specifications first. Run the relevant tests and repository checks, and archive the OpenSpec change after implementation and verification.
3. For every change touching frontend code or changing UI behavior, run automated tests of the affected flows in a real browser. Mock the application's API by default; use the real API and database only when the user explicitly requests full-stack coverage. Capture a screenshot for each tested user-visible scenario and attach the screenshots to the draft pull request. Unit and jsdom tests supplement rather than replace browser tests. If browser testing cannot run, report the gap and ask the user before publication.
4. Commit the scoped change on a feature branch and run the no-mistakes gate before publication. Address its findings and verify the final head; if the gate is unavailable or blocked, report that explicitly rather than treating other checks as a gate pass.
5. Publish or update a pull request in **draft** mode. If a publication tool opens it as ready, convert it to draft immediately. Keep it in draft until the user explicitly asks to mark it ready for review.
6. Deliver **one commit per pull request**. Squash the scoped work and any no-mistakes fix commits into a single commit before handoff. When updating an existing PR after a squash, use a lease-protected force push, then verify the PR contains exactly one commit and that checks pass on its final head.

## Specification-driven tests

When changing API or database behavior, derive tests from the applicable API and database references: `documentation/api/`, `documentation/openapi.yaml`, and `documentation/database.md`. At the appropriate public seam, cover the documented success response, headers, error cases, authentication and validation rules, lifecycle behavior, and persistence constraints affected by the change.
