## ADDED Requirements

### Requirement: Production API revision headers survive HTTPS gateway

The production HTTPS gateway SHALL preserve API-provided ETags on `/api/*` responses without adding a compression-specific suffix, so a client can use a revision ETag as `If-Match` for an authorized write. Non-API web responses MAY remain compressed.

#### Scenario: Production client reads then writes a versioned resource

- **WHEN** a browser reads an API resource through the production gateway with zstd or gzip accepted and submits an authorized `If-Match` write
- **THEN** the gateway does not alter the revision token and the API can evaluate the precondition against its own ETag
