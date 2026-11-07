# Local development deployment

From the repository root, copy `.env.example` to the ignored `.env`, fill `AUTH_TOKEN_SECRET` and `RESEND_API_KEY`, then create the local certificate as described in the [main README](../../README.md). ChalkTalk uses a fixed verified-domain sender. Run `docker compose --profile app up --build --wait`. The root Compose file includes this directory's `compose.yml`, so the familiar command and local data volumes remain in place.

This stack runs PostgreSQL and SeaweedFS locally. API and worker send real emails through Resend HTTPS; there is no Mailpit container. Do not use real recipients in automated tests. `RESEND_API_BASE_URL` may point to a mock origin for isolated tests, but normal development should omit it.

The local Compose file uses pgvector PostgreSQL and runs the vector migration on startup. Set `EMBEDDING_API_KEY` in the ignored `.env` to enable semantic matching; without a key, search remains lexical/fuzzy. The API, worker, collaboration server, and frontend each have a named local Dockerfile. API and worker images include qpdf, Poppler, Tesseract, and English OCR data. Back up an existing populated PostgreSQL volume before switching from the former `postgres:17-alpine` image.
