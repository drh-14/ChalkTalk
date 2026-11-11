# Local development deployment

Follow the [main README's local setup](../../README.md#start-locally) for configuration, startup, migration from older `.env` files, and explicit Piazza imports. The local Compose entry point is `deployment/local/compose.yml`.

## Local HTTPS

Caddy creates the local HTTPS certificate and its own CA automatically when Compose starts. No certificate-generation command or certificate file is needed before startup. After the stack is running, export **only the CA's public root certificate**:

```bash
docker compose -f deployment/local/compose.yml --env-file .env cp \
  gateway:/data/caddy/pki/authorities/local/root.crt /tmp/chalktalk-local-root.crt
```

Trust `/tmp/chalktalk-local-root.crt` once in your host OS or browser trust store (on macOS, open it in Keychain Access and set it to **Always Trust**; on Linux, use your distribution's CA-import procedure). Never export Caddy's `root.key` or mount its private CA data on the host. Its `/data` volume preserves the CA across restarts; if you delete volumes, export and trust the newly generated root. Until then, the browser will warn about the certificate. Open `https://<DOMAIN>:<WEB_PORT>` (defaults: `https://localhost:5173`) after trusting the root.

The API and worker send real emails through Resend HTTPS; there is no Mailpit container. Do not use real recipients in automated tests. `RESEND_API_BASE_URL` may point to a mock origin for isolated tests, but normal development should omit it.

The local Compose file uses pgvector PostgreSQL and runs the vector migration on startup. Set `EMBEDDING_API_KEY` in the ignored `.env` to enable semantic matching; without a key, search remains lexical/fuzzy. The API, worker, collaboration server, and frontend each have a named local Dockerfile. API and worker images include qpdf, Poppler, Tesseract, and English OCR data. Back up an existing populated PostgreSQL volume before switching from the former `postgres:17-alpine` image.
