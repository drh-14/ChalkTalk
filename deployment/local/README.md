# Local development deployment

Follow the [main README's local setup](../../README.md#start-locally): copy this directory's `.env.example` to the ignored repository-root `.env`, configure `DOMAIN` and credentials, then use the single default startup command. Course population is an explicit Piazza import.

Run `docker compose -f deployment/local/compose.yml --env-file .env up --build --wait` from the repository root. The local Compose file preserves the existing `chalktalk` project and named volumes by default.

If your `.env` predates this setup, remove any `PORT` entry before starting. Local Compose fixes the API's internal port at 3000; startup fails before migrations when `PORT` is present, while direct API runs may still override it.

Caddy generates a persistent local CA on first startup. After the stack is running, export and trust only its public root certificate as described in the [main README](../../README.md#3-trust-the-local-https-certificate-and-open-the-app). Vite remains private HTTP behind Caddy and hot reloads through the gateway.

The API and worker send real emails through Resend HTTPS; there is no Mailpit container. Do not use real recipients in automated tests. `RESEND_API_BASE_URL` may point to a mock origin for isolated tests, but normal development should omit it.

The local Compose file uses pgvector PostgreSQL and runs the vector migration on startup. Set `EMBEDDING_API_KEY` in the ignored `.env` to enable semantic matching; without a key, search remains lexical/fuzzy. The API, worker, collaboration server, and frontend each have a named local Dockerfile. API and worker images include qpdf, Poppler, Tesseract, and English OCR data. Back up an existing populated PostgreSQL volume before switching from the former `postgres:17-alpine` image.
