# Local development deployment

From the repository root, copy `.env.example` to the ignored `.env`, fill `AUTH_TOKEN_SECRET`, `RESEND_API_KEY`, and the verified `joinchalktalk.com` `EMAIL_FROM`, then create the local certificate as described in the [main README](../../README.md). Run `docker compose --profile app up --build --wait`. The root Compose file includes this directory's `compose.yml`, so the familiar command and local data volumes remain in place.

This stack runs PostgreSQL and SeaweedFS locally. API and worker send real emails through Resend HTTPS; there is no Mailpit container. Do not use real recipients in automated tests. `RESEND_API_BASE_URL` may point to a mock origin for isolated tests, but normal development should omit it.

The optional semantic-search override is `docker compose -f docker-compose.yml -f deployment/local/compose.semantic.yml --profile app up --build --wait`.
