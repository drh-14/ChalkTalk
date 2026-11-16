## ADDED Requirements

### Requirement: API revision headers survive the local HTTPS gateway

The local HTTPS gateway SHALL preserve API-provided ETags on `/api/*` responses without adding a compression-specific suffix. A client SHALL be able to use a revision ETag received through the gateway as `If-Match` on a subsequent authorized write. The gateway MAY continue to compress non-API responses.

#### Scenario: Two participants finish a collaboration session

- **WHEN** two browser clients edit the same session through the local HTTPS gateway and one ends it using the latest received ETag
- **THEN** the authorized write succeeds without a gateway-induced precondition failure
- **AND** both clients observe the session as read-only

#### Scenario: API response with compression accepted by the browser

- **WHEN** a client requests a versioned API resource while accepting zstd or gzip
- **THEN** the gateway preserves the origin API ETag for use in `If-Match`
