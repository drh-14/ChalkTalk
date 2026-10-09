## Context

The answer creation path stores `body_markdown` and an empty Yjs marker `[0,0]` in one transaction. See [the approved design](../../../docs/design/2026-10-09-yjs-answer-document-core.md) and the new capability spec for behavior.

## Goals / Non-Goals

**Goals:** A private store with durable binary state, atomic text projection, serialized merge, and lifecycle guards, exercised against PostgreSQL.

**Non-Goals:** Network transport, authorization of a remote editor, live awareness, caching/debouncing, or temporary collaboration sessions.

## Decisions

- Use `yjs` 13.x and `Y.Text('content')` to match the published collaboration document shape. A plain string write cannot merge independent updates.
- Lock the answer row before its document row in one transaction; staff endorsement/deletion already locks the answer first. Decode the latest saved state inside the lock and persist before returning.
- Treat only the legacy `[0,0]` marker as unseeded. Seed from `body_markdown` once; a nonempty binary/projection mismatch is an integrity error, avoiding silent loss of CRDT history.
- Do not modify answer contributors, because this private seam has no authenticated editor identity.
- Reject empty, malformed, or oversized updates at the boundary and validate the projected text against the answer content contract.

## Risks / Trade-offs

- A transaction per accepted update costs more than batched persistence → this phase favors correctness and headless verification; a future live server must define a new flush contract.
- No user permission check in this private store → keep it unexported from HTTP routes and require the future transport to authenticate and authorize callers.
- Legacy empty documents seed on first load → row locks and an exact marker check make seeding one-time and race-safe.

## Migration Plan

No schema migration. Install the API dependency and deploy the module; existing answer routes continue as before. Revert the module and dependency to roll back because no public caller exists yet. Saved Yjs states remain in the existing table.
