# Railway deployment

Status: proposed
Date: 2026-10-30

## Context

ChalkTalk currently has a runnable single-VM Docker Compose deployment under `deployment/`. It uses Caddy for TLS, PostgreSQL and SeaweedFS volumes, separate API/worker/collaboration processes, and SES SMTP. The intended host is now Railway, with Resend's HTTPS API for production email. The application still needs PostgreSQL, SeaweedFS, WebSockets, and same-origin browser access. Local Docker Compose and Mailpit remain development tools, not the production topology.

Assumption: the first deployment is a small course project, not a multi-region/high-availability service. No production Railway project or credentials were available to inspect.

## Decision

Replace `deployment/`'s VM-specific Compose topology with a Railway-specific **Dashboard/CLI operator guide**, Railway-adapted image, and gateway configuration. The user explicitly chose this simpler manual-provisioning route over Railway Infrastructure as Code. Do not add a Railway SDK dependency or a `railway.toml`/`railway.json` file. Use one public `web` service serving built React assets and routing `/api/*` and `/collaboration` over Railway private networking to separate API and collaboration services. Keep the worker private. Use Railway PostgreSQL and a private SeaweedFS service with its own volume. Railway terminates public TLS; Caddy listens on plain HTTP inside Railway and does not manage certificates. API and worker use Resend HTTPS, with no production SMTP settings or Mailpit service.

Retain one instance of each stateful or WebSocket-facing service initially. Do not treat Docker Compose `depends_on` as a Railway deployment mechanism. Run the schema migrator once before rolling out app processes; a failed migration blocks rollout. Until that release step is automated and tested, the guide must identify it as a required manual gate. The migration runner currently has no cross-process migration lock.

## Structure

The browser sees one origin. `FRONTEND_ORIGINS`, `FRONTEND_BASE_URL`, and `COLLABORATION_PUBLIC_URL` therefore derive from the same public domain. Only `web` receives a Railway public/custom domain. Other services use `<service>.railway.internal` and fixed internal ports. SeaweedFS retains its S3-compatible endpoint and persistent `/data` directory. Railway service variables hold secrets and service references; secrets are not baked into images or committed files.

The operator guide must specify the exact Railway service contract, not merely say “deploy the app”:

| Service | Source and process | Networking and persistence | Key configuration |
| --- | --- | --- | --- |
| `web` | Repository build, static frontend plus Caddy gateway | Sole public custom domain; plain HTTP listener on Railway's selected `PORT`; private proxy to API and collaboration | Public domain, private API/collaboration host references |
| `api` | Same repository's compiled app image; `node apps/api/dist/server.js` | Private `:3000`; `/health`; no volume | Database reference; SeaweedFS S3 endpoint/credentials; public URL/origin; Resend key/sender; token secret; `TRUST_PROXY_HOPS=1` only after proxy validation |
| `worker` | Same compiled app image; `node apps/api/dist/jobs/main.js` | Private, no public domain or volume | Same DB, storage, public URL, and Resend variables as API |
| `collaboration` | Same compiled app image; `node apps/api/dist/collaboration/main.js` | Private WebSocket listener `:3100`; no volume | Same DB and frontend origin; `COLLABORATION_PORT=3100` |
| `postgres` | Railway PostgreSQL service | Private database; Railway-managed persistent storage | `DATABASE_URL` referenced by API, worker, collaboration, and migration runner |
| `seaweedfs` | Pinned SeaweedFS image in `mini` mode | Private S3 endpoint `:8333`; Railway volume mounted at `/data`; no public domain | Independent SeaweedFS access and secret keys, shared with API/worker |

The guide should state how to configure a one-time migration execution with the compiled app image and `node apps/api/dist/database/migrate.js`, check its exit status, and only then roll out the new app version. It must not imply independent Railway services respect Compose `depends_on` or that multiple concurrent pre-deploy migrations are safe.

The edge supplies `X-Real-IP`. The gateway must discard client-supplied forwarding headers and pass a trusted client address to Express; keep `TRUST_PROXY_HOPS=1` only after an integration check confirms per-IP limits distinguish clients and reject spoofing. If that cannot be established, do not publish the deployment with the current proxy setting.

## Technology choices

| Concern | Choice | Why | Runner-up |
| --- | --- | --- | --- |
| Public routing | Caddy gateway behind Railway TLS | Reuses the existing same-origin paths and static frontend build | Separate public domains; adds CORS, cookies, and URL changes |
| Database | Railway PostgreSQL service | Private connectivity and service-managed database lifecycle | Self-hosted Postgres container; more operations |
| Object store | Private SeaweedFS `mini` plus Railway volume | Retains the existing S3-compatible storage and data model | Railway object storage; would change storage ownership |
| Email | Resend HTTPS in API and worker | Works without Railway outbound SMTP | SES/SMTP; conflicts with the chosen transport |
| Topology setup | Dashboard/CLI guide with exact service settings | User chose lower setup complexity for a course deployment; no new SDK | Railway TypeScript IaC; more reproducible but adds an evolving deployment dependency |
| Schema release | Single migration gate before rollout | Avoids concurrent migration runners and startup races | Pre-deploy command on every service; unsafe with current runner |

Railway facts checked against its official documentation on 2026-10-30: [custom Dockerfile paths](https://docs.railway.com/builds/dockerfiles), [private DNS and HTTP service links](https://docs.railway.com/networking/domains/working-with-domains), [custom domains and TLS](https://docs.railway.com/networking/domains/working-with-domains), [public proxy headers and WebSockets](https://docs.railway.com/networking/public-networking/specs-and-limits), and [volume limits](https://docs.railway.com/volumes/reference). Railway's legacy `railway.json`/`railway.toml` Config as Code is [deprecated](https://docs.railway.com/config-as-code/reference); the chosen manual guide avoids it.

## Alternatives rejected

- Import the existing Compose file into Railway: its host ports, named networks, Caddy TLS, and startup ordering do not translate reliably to independent Railway services.
- Start a new `railway.toml` or `railway.json`: Railway has deprecated Config as Code and no longer allows new services to opt in.
- Introduce Railway TypeScript IaC now: would codify topology, but the user preferred an explicit Dashboard/CLI guide without an extra deployment dependency for this first course release. Revisit if repeated deployments drift.
- Give API and collaboration separate public domains: possible, but increases browser-origin and security configuration for no current benefit.
- Replace SeaweedFS: outside this deployment revision and contrary to the retained storage choice.
- Keep SES SMTP production variables: obsolete under the Resend HTTPS decision.
- Add a second reverse proxy or load balancer: Railway edge plus one gateway already meet the requirement.

## Trade-offs accepted

- Gateway adds one hop, and a gateway outage affects the UI, API access, and WebSockets together.
- Private SeaweedFS and PostgreSQL each require a persistent volume. Railway Free currently permits only one volume per project; this topology needs Hobby/Pro or a different storage decision.
- A manually gated migration makes releases less automatic but is safer than concurrent pre-deploy migrators in the current codebase.
- Manual Dashboard/CLI setup is less reproducible than executable IaC; an operator can misconfigure a private domain, variable, start command, volume, or migration ordering. The guide must contain exact values and a post-provision checklist, but it cannot eliminate configuration drift.
- Single-replica SeaweedFS and collaboration favor simplicity over availability.

## Failure modes

- Railway edge/gateway unavailable: entire application is unavailable; no alternate public API path.
- API unavailable: UI may load, but application actions fail; gateway should return a clear upstream error, not silently serve SPA HTML for `/api/*`.
- Collaboration unavailable or redeployed: WebSockets disconnect; existing client reconnect/recovery behavior must be exercised in staging.
- PostgreSQL unavailable or a migration fails: API/worker/collaboration should not start a new incompatible release; existing data must not be replaced by an empty database.
- SeaweedFS unavailable or volume full: file operations fail while text discussion may remain available; do not redeploy it without the original volume.
- Resend slow/down: authentication email and queued notification delivery are affected, while local Mailpit development remains independent. Queue retry/cancellation belongs to the separate Resend email design.
- Invalid proxy headers: per-IP authentication throttling may group distinct users or permit spoofing; release test is mandatory.

## Reversibility

- Cheap: gateway image/configuration, Railway service names, internal ports, and email transport configuration.
- Expensive: moving persistent PostgreSQL/SeaweedFS data, changing the browser's public origin, and running a one-way schema migration. Backups and a restore rehearsal are prerequisites for real course data.

## Open questions

1. Confirm the Railway subscription can provision both PostgreSQL storage and the separate SeaweedFS volume; Free currently permits only one volume per project.
2. Decide whether a later release should automate the single-migrator gate. The initial design documents a manual release check.
