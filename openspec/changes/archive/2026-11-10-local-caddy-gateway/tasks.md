## 1. Specification and tests

- [x] 1.1 Validate this OpenSpec change and verify the route/TLS contract is complete.
- [x] 1.2 Write Compose/Vite/route tests for the approved behavior, run them, and confirm expected failures before implementation.

## 2. Local gateway

- [x] 2.1 Add local Caddy gateway and private Vite wiring; verify resolved Compose and Caddy route tests pass.
- [x] 2.2 Add automatic persistent Caddy TLS, one-hop API trust, narrow Vite host and HMR settings; verify HTTPS/WebSocket and restart checks.

## 3. Delivery

- [x] 3.1 Update local setup and CI without manual certificates; verify docs, formatting, lint, and CI smoke checks.
- [x] 3.2 Run real-browser affected flows, capture ignored screenshots, attach them to draft PR, and verify golden/edge behavior.
- [x] 3.3 Archive OpenSpec after local verification and verify the updated canonical deployment spec.
