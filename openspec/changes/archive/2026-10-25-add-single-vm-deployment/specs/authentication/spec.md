## ADDED Requirements

### Requirement: Explicit one-hop reverse proxy trust

The HTTP API SHALL ignore forwarded client-IP headers by default. When deployment configuration explicitly enables exactly one trusted proxy hop, the API SHALL use the client address forwarded by that hop for per-IP authentication rate limits. Invalid hop settings SHALL fail startup.

#### Scenario: Direct local request attempts IP spoofing

- **WHEN** proxy trust is disabled and a direct client sends `X-Forwarded-For`
- **THEN** the forwarded value is ignored for the per-IP limit key

#### Scenario: Request arrives through deployment proxy

- **WHEN** one-hop trust is enabled and Caddy forwards a client's IP
- **THEN** the forwarded client IP is used for the per-IP limit key
