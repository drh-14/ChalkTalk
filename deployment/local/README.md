# Local development deployment

From the repository root, copy `.env.example` to the ignored `.env`. Replace `AUTH_TOKEN_SECRET`, `METRICS_TOKEN`, and `GRAFANA_ADMIN_PASSWORD` with independent random values and set `RESEND_API_KEY`; create the local certificate as described in the [main README](../../README.md). ChalkTalk uses a fixed verified-domain sender.

Run `docker compose up --build --wait`. This single command starts the app, migrations, PostgreSQL, SeaweedFS, Prometheus, Grafana, Elasticsearch, and Logstash. A fresh database starts without users or courses. Create a course in the app or use the [explicit Piazza import](../../README.md#importing-a-piazza-class). The root Compose file includes this directory's `compose.yml`, so the familiar command and local data volumes remain in place.

The API and worker send real emails through Resend HTTPS; there is no Mailpit container. Do not use real recipients in automated tests. `RESEND_API_BASE_URL` may point to a mock origin for isolated tests, but normal development should omit it.

The local Compose file uses pgvector PostgreSQL and runs the vector migration on startup. Set `EMBEDDING_API_KEY` in the ignored `.env` to enable semantic matching; without a key, search remains lexical/fuzzy. The API, worker, collaboration server, and frontend each have a named local Dockerfile. API and worker images include qpdf, Poppler, Tesseract, and English OCR data. Back up an existing populated PostgreSQL volume before switching from the former `postgres:17-alpine` image.
