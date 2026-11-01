## Context

See `docs/design/2026-11-01-course-collaboration-sessions.md` for the approved architecture, migration, authorization, and failure-mode details.

## Decisions

- Use the existing PostgreSQL session/participant/ticket/document records and Hocuspocus process. No new service.
- Add a forward migration to detach the post FK and persist final-snapshot confidence. Preserve all existing session and participant identities; mark legacy ended snapshots unconfirmed.
- Authorize by current course membership plus explicit participant row at every API and socket seam; staff role gives management only to participating staff and never upgrades document View to Edit.
- Make any participant an inviter; creator or participating staff manage metadata and roster; creator departure ends before course membership deletion.
- Keep final-save acknowledgement distinct from fallback ending; an unconfirmed end must be presented as last saved, not guaranteed complete.
- Reuse the existing invitation email queue and hold current eligibility locks through provider acceptance. Participant removal or creator departure may wait for an in-flight send; no invitation send is accepted after revocation commits. Remove claims of staff-wide access.
- A Hocuspocus edit authorized before a removal transaction commits may finish afterward. New edits and tickets must fail once revocation commits, and prompt socket closure begins after that commit; strict linearization of an already in-flight Yjs update is outside this change.
- Add a course Collaboration tab and remove post entry points/actions. Retain session URLs and home shortcuts.

## Risks and verification

- Post deletion, merge, course departure, and account deletion currently couple to session lifecycle; integration tests must establish preservation or correct ending before implementation.
- Hocuspocus authorization may diverge from REST; run isolated authenticated API/database/server tests, concurrent revocation and network-drop cases.
- Migrated ended snapshots cannot prove their final flush and must warn.
- Use mocked-API real browser tests and screenshots for every changed user-visible flow, plus isolated full-stack tests for the critical security cases.
