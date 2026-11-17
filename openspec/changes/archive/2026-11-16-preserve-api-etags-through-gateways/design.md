# Design

## Context

Both Caddy gateways currently apply `encode zstd gzip` to all paths. Caddy's encoded variant rewrites a strong API ETag, while ChalkTalk's optimistic writes compare `If-Match` against the unencoded origin revision. A full-stack collaboration test exposed repeated 412 responses through the local gateway.

## Decision

Apply Caddy response encoding only to non-API paths using a named path matcher. Keep the `/api/health` and `/api/*` reverse-proxy routes and all authentication/CSRF behavior unchanged. Mirror the matcher in local and production configs. Avoid client-side ETag normalization: the origin API remains the authority for revision tokens, and client normalization would be brittle for other proxies or ETag formats.

## Verification

Run the two-browser collaboration test through the disposable local Compose gateway, including successful End session and read-only state in both clients. Validate the production Caddyfile with Caddy's parser and assert the adapted route's encoder matcher excludes `/api/*`; compare local and production gateway policies. CI must retain the local browser screenshots.

## Rejected alternatives

- Strip `-zstd`/`-gzip` in clients: depends on Caddy's current suffix and leaves other API clients broken.
- Disable compression everywhere: safe but needlessly degrades static web assets.
- Change the API's optimistic concurrency contract: unrelated, wider behavioral risk.
