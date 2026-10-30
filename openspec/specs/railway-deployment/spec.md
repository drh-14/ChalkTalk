# railway-deployment Specification

## Purpose
Deploy ChalkTalk on Railway with one public same-origin gateway and private stateful services.

## Requirements

### Requirement: Public gateway

The deployment SHALL expose only the web gateway publicly. It SHALL serve compiled frontend assets and SPA routes, proxy `/api/*` unchanged except `/api/health` to upstream `/health`, and proxy `/collaboration` WebSocket upgrades to the private collaboration service. Failed API upstream requests SHALL NOT return SPA HTML.

#### Scenario: API and health routing

- **WHEN** the browser requests `/api/v1/...` or `/api/health`
- **THEN** the gateway forwards to the private API with the documented path mapping

#### Scenario: WebSocket route

- **WHEN** the browser upgrades `/collaboration`
- **THEN** the gateway forwards the upgrade to the private collaboration service

### Requirement: Trusted client address

The gateway SHALL replace untrusted client forwarding headers with Railway's edge-provided client address, HTTPS scheme, and requested host before proxying to the API. The API SHALL trust one gateway hop only while inaccessible from the public internet.

#### Scenario: Spoofed forwarding header

- **WHEN** a client supplies a forged `X-Forwarded-For` header
- **THEN** the API sees the edge-reported address, not the forged address

### Requirement: Private services and gated releases

The deployment SHALL document exact build targets, start commands, private ports, storage mounts, required variables, and a single migration command that must succeed before app rollout. Production email SHALL use Resend HTTPS; local Compose/Mailpit SHALL remain development-only. The guide SHALL identify backups and live smoke tests as required before real data.

#### Scenario: Migration failure

- **WHEN** the migration runner exits unsuccessfully
- **THEN** the operator does not roll out the new API, worker, collaboration, or web release
