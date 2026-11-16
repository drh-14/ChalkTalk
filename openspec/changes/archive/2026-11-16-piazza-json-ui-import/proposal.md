## Why

ChalkTalk can import a CLI-generated Piazza JSON file only through an operator command. An authorized course creator needs a safe, visible way to upload that file without sharing Piazza credentials, while excluding private Piazza content that is not needed for this migration.

## What Changes

- Add an import action beside the course create and join actions with a local summary, private-post omission notice, and authorization confirmation.
- Add a bounded authenticated upload API for the CLI-generated `PiazzaExport` JSON shape, with server-side validation and no source-file retention.
- Reuse the existing converter and transactional importer while filtering private posts and people referenced only by those posts.
- Permit UI re-import only by a current instructor of the already imported ChalkTalk course, checked atomically inside the import transaction. The CLI remains unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `piazza-course-import`: Adds the user-facing CLI JSON import, its privacy rules, upload contract, and authorization behavior.

## Impact

Course-home UI and client, authenticated API, multipart parser, Piazza import adapter and importer, API/OpenAPI references, and browser/API/database tests. No migration, new dependency, or Piazza credential handling.
