## Implementation

- [x] Add failing tests for disabled/enabled one-hop proxy handling and invalid configuration.
- [x] Add narrowly scoped proxy environment and Express setting; make focused tests green.
- [x] Add multistage images, isolated Compose/Caddy configuration, and an environment template.
- [x] Document pinned-revision startup, required secrets, health checks, lifecycle, and known backup/smoke gaps.
- [x] Validate OpenSpec, Compose interpolation/network/volume structure, image builds, focused tests, typecheck/lint, and feasible HTTP/WebSocket/storage smoke.

## Validation evidence

- The proxy configuration test failed as expected before implementation (`trustProxyHops` was undefined); the HTTP contract test initially could not collect because this fresh worktree lacked dependencies. After `npm ci`, both focused suites passed (18 tests), as did typecheck, ESLint and the complete 618-test non-integration suite.
- Strict OpenSpec validation and rendered Compose configuration passed. The normalized Compose model published host ports only for Caddy; database and SeaweedFS had named volumes, and the worker had outbound network access for SES.
- Both production image targets built. Caddy validated its configuration and the Node image loaded its native `argon2` dependency.
- A disposable Compose stack using `DOMAIN=localhost` completed 32 migrations, served the SPA and `/api/health` over local HTTPS, returned an expected 401 for invalid login, opened a WebSocket through `/collaboration`, and reached the SeaweedFS bucket. Two login requests with different forged `X-Forwarded-For` headers incremented a single IP rate-limit bucket (count 2), confirming Caddy did not trust client-supplied headers. The disposable stack and volumes were removed. No email was sent.
