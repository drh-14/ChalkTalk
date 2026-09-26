# Working instructions

## Delegation threshold

Handle small and medium changes directly. Use the architect → user decision → planning → implementation handoff only for large changes.

A change is large when it has unresolved structural decisions or substantial implementation risk, such as introducing a service or dependency, changing data ownership or component boundaries, defining a new cross-system protocol, requiring a migration, or coordinating several independently complex subsystems. Decide this before delegating. File count and repetitive edits alone do not make a change large.

Documentation wording, formatting, examples, schema parity, and mechanical cross-file updates are direct work. Once the user has approved an API or architecture decision, apply its documentation updates directly unless implementation still requires a new structural decision.

For direct work, inspect the affected files, make the change, run focused validation, and report the result. For large work, create an OpenSpec change before implementation. Complete and validate its proposal, specs, design, and tasks with the user involved in architecture and planning decisions; then hand the approved plan to implementation without requesting redundant approval. Archive the OpenSpec change after implementation and verification are complete.

An explicit user request to skip or use delegation overrides the default threshold.
