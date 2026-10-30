# Railway deployment guide

This is the **Railway Hobby** production topology for ChalkTalk. It replaces the old single-VM `deployment/compose.yml`; the repository-root `docker-compose.yml` remains the local development stack with Mailpit. Railway terminates public HTTPS. The gateway serves the built frontend on HTTP inside Railway and proxies same-origin API and WebSocket paths. Production email uses Resend's HTTPS API, **not SMTP**.

This guide does not provision Railway for you. Review every setting and run the release checks before admitting course data. Do not connect any production service to a development or mock-seeded database.

## Services and build settings

Create one Railway project/environment and these **exact service names**. Connect `web`, `api`, `worker`, `collaboration`, and `migrate` to the same GitHub repository and release branch, with repository root as the build context. In each service's Variables tab set `RAILWAY_DOCKERFILE_PATH` as shown. Disable GitHub autodeploy on all five services so the migration can finish before the application release. Deploy one reviewed commit across them; record its SHA.

| Service         | Source / Dockerfile path                | Start command                                                                 | Internal listener, public access, and storage                                                                                         |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `web`           | GitHub, `/deployment/Dockerfile.web`    | Image default (`caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`) | `PORT=8080`; **only service with a Railway public/custom domain**; health path `/api/health`; no volume                               |
| `api`           | GitHub, `/deployment/Dockerfile`        | Image default (`node apps/api/dist/server.js`)                                | `PORT=3000`; private domain only; health path `/health`; no volume                                                                    |
| `worker`        | GitHub, `/deployment/Dockerfile`        | `node apps/api/dist/jobs/main.js`                                             | No public domain, health path, or volume; one replica                                                                                 |
| `collaboration` | GitHub, `/deployment/Dockerfile`        | `node apps/api/dist/collaboration/main.js`                                    | `COLLABORATION_PORT=3100`; private domain only; no volume; one replica                                                                |
| `migrate`       | GitHub, `/deployment/Dockerfile`        | `node apps/api/dist/database/migrate.js`                                      | No public domain, health path, or volume; GitHub autodeploy **off**, restart policy **Never**, one replica; run only during a release |
| `Postgres`      | Railway PostgreSQL template             | Managed by Railway                                                            | Private `DATABASE_URL` and persistent Railway-managed data                                                                            |
| `seaweedfs`     | Docker image `chrislusf/seaweedfs:4.48` | `mini -dir=/data`                                                             | Private `:8333`; dedicated Railway volume mounted at `/data`; no public domain; one replica                                           |

Railway does not document a per-service Docker **target** setting. The separate app and web Dockerfiles therefore have the intended image as their final stage. Do not point `web` at `/deployment/Dockerfile`, or it will start the API instead. Likewise, do not point API services at the web Dockerfile. Caddy needs no certificate or Caddy data volume behind Railway's TLS edge. `api` and `collaboration` must never receive a public domain or TCP proxy.

### Variables

Use [`.env.example`](./.env.example) as a **Variables-tab checklist**, not a file to upload unchanged. Its values are examples, not credentials. A Railway reference such as `${{Postgres.DATABASE_URL}}` is entered literally in the Variables tab; Railway resolves it per environment. If you rename a service, update every private hostname/reference accordingly.

1. **`web`:** `PORT=8080`, `API_UPSTREAM=api.railway.internal:3000`, `COLLABORATION_UPSTREAM=collaboration.railway.internal:3100`, `RAILWAY_DOCKERFILE_PATH=/deployment/Dockerfile.web`. Configure the public custom domain on this service only. The `API_UPSTREAM` and `COLLABORATION_UPSTREAM` values are host:port **without** `http://`.
2. **`Postgres`:** create Railway PostgreSQL; use its private `DATABASE_URL`. Do not use a public database URL for sibling services.
3. **`seaweedfs`:** set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` to independent, strong generated secrets. Mount its volume at `/data`. Never replace the volume when redeploying.
4. **`api` and `worker`:** set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `AUTH_TOKEN_SECRET` (at least 32 random characters), `ALLOWED_SCHOOL_DOMAINS` (comma-separated), `FRONTEND_ORIGINS=https://YOUR_DOMAIN`, `FRONTEND_BASE_URL=https://YOUR_DOMAIN`, `COLLABORATION_PUBLIC_URL=wss://YOUR_DOMAIN/collaboration`, `S3_ENDPOINT=http://seaweedfs.railway.internal:8333`, `S3_BUCKET=chalktalk-resources`, `S3_REGION=us-east-1`, `S3_ACCESS_KEY_ID=${{seaweedfs.AWS_ACCESS_KEY_ID}}`, and `S3_SECRET_ACCESS_KEY=${{seaweedfs.AWS_SECRET_ACCESS_KEY}}`. Set `EMAIL_PROVIDER=resend`, `EMAIL_FROM=ChalkTalk <noreply@YOUR_VERIFIED_DOMAIN>`, and `RESEND_API_KEY` to a sending-only key stored as a Railway secret. The sender domain must be verified in Resend. Set `RAILWAY_DOCKERFILE_PATH=/deployment/Dockerfile`; `PORT=3000` on API. Set `TRUST_PROXY_HOPS=1` **on API only** after the proxy check below. Never configure production `SMTP_*` variables or an automatic SMTP fallback.
5. **`collaboration`:** set the same `DATABASE_URL`, `AUTH_TOKEN_SECRET`, `ALLOWED_SCHOOL_DOMAINS`, `FRONTEND_ORIGINS`, `FRONTEND_BASE_URL`, `COLLABORATION_PUBLIC_URL`, and `RAILWAY_DOCKERFILE_PATH=/deployment/Dockerfile`; set `COLLABORATION_PORT=3100` and `EMAIL_PROVIDER=resend` with the same `EMAIL_FROM` and `RESEND_API_KEY` because shared environment validation runs at startup. It needs no object-storage variables for its current process.
6. **`migrate`:** set `DATABASE_URL=${{Postgres.DATABASE_URL}}` and `RAILWAY_DOCKERFILE_PATH=/deployment/Dockerfile`. Its compiled runner reads only the database URL; do not copy unrelated secrets into it.

Set `OBSERVABILITY_ENABLED=false` unless you deliberately provision the additional metrics token and durable log spool; the lean deployment uses Railway logs. Keep all source-linked app services at one replica initially. Configure the Railway service health checks only for API and web as listed above. The web health check depends on API readiness; do not deploy web first and mistake an upstream health failure for a broken static image.

## First deployment and each release

1. Verify the Railway project is on a plan that permits both the PostgreSQL storage and the separate SeaweedFS volume. Create `Postgres` and `seaweedfs`, attach `/data`, set credentials, and confirm SeaweedFS responds on its private endpoint. Configure the other services and variables, leaving their GitHub autodeploy **disabled**.
2. Pin a tested release commit on the connected branch. Build and deploy **only `migrate`** for that commit. Confirm the process `node apps/api/dist/database/migrate.js` exits **0** in Railway logs. Its restart policy is **Never**. Never start two migration runs concurrently: the current runner has no cross-process lock. A failed migration is a release blocker; do not deploy the new app services until diagnosed and fixed.
3. Manually deploy `api`, `worker`, `collaboration`, and then `web` from that **same commit**. In each service's Command Palette choose **Deploy Latest Commit** after checking the connected branch's SHA. Do not assume a Railway reference variable or a former Compose `depends_on` enforces the schema release gate. If the branch advances between steps, stop and re-pin it before continuing.
4. Confirm `/health` on private API, the worker loop, collaboration listener, SeaweedFS bucket access, and the public checks below. The API creates the configured S3 bucket on first startup if missing. Check logs for startup errors; a failed container or missing private DNS is not a successful release.

For a real course, back up PostgreSQL and the SeaweedFS volume **off-host** and perform a restore rehearsal before storing irreplaceable data. Railway volumes are persistent, but not a substitute for an independent recoverable backup. Schema migrations may be one-way, so rolling back code alone may be unsafe. An automated single-migrator release gate and backup automation are not included in this skeleton.

## Release smoke checks

From a machine outside Railway, replace `YOUR_DOMAIN`:

```sh
curl -i https://YOUR_DOMAIN/                   # compiled SPA, HTML
curl -i https://YOUR_DOMAIN/courses/example     # SPA route, HTML
curl -i https://YOUR_DOMAIN/api/health          # 200 from API /health
curl -i https://YOUR_DOMAIN/api/v1/posts        # API response, not SPA HTML
```

Log in with a test account, create and read a test post, upload and download a harmless file, join a live collaboration session and verify the `wss://YOUR_DOMAIN/collaboration` upgrade/reconnect. Send an authentication email and a queued notification/digest to a test mailbox through Resend; confirm local Mailpit is **not** involved. A failed API upstream must return an upstream error, not `index.html`.

### Trusted client IP release gate

Railway's edge supplies `X-Real-IP`. Caddy forwards that value as the **only** `X-Forwarded-For` value and replaces `X-Forwarded-Proto` with `https`; Express trusts exactly one Caddy hop. Verify on the real Railway domain, with two distinct client IPs and forged client-supplied forwarding headers, that the API's per-IP login limits distinguish the clients and cannot be bypassed by changing the forged headers. Do **not** publish with `TRUST_PROXY_HOPS=1` until this passes. Neither the API nor collaboration may be publicly reachable around Caddy. The local gateway test below validates Caddy's header mapping, but cannot prove what the Railway edge itself overwrites.

## Local gateway verification

The gateway integration test starts Caddy with mock private API/WebSocket upstreams and checks SPA fallback, `/api/health` rewriting, API path preservation, WebSocket upgrade, forged forwarding-header replacement, and API failure behavior:

```sh
docker pull caddy:2.10-alpine
node --test deployment/gateway.test.mjs
docker build -f deployment/Dockerfile.web -t chalktalk-railway-web .
docker build -f deployment/Dockerfile -t chalktalk-railway-app .
GATEWAY_TEST_IMAGE=chalktalk-railway-web node --test deployment/gateway.test.mjs
```

Docker must be running. A skipped gateway test because its image is unavailable is **not** a pass; pull/build the image and rerun. These local tests do not replace the Railway-domain, database, storage, mail, and WebSocket smoke checks.

Railway references: [Dockerfile paths](https://docs.railway.com/builds/dockerfiles), [private domains](https://docs.railway.com/networking/domains/working-with-domains), [edge headers and WebSockets](https://docs.railway.com/networking/public-networking/specs-and-limits), [GitHub autodeploy controls](https://docs.railway.com/deployments/github-autodeploys), [variables](https://docs.railway.com/variables/reference), [volumes](https://docs.railway.com/volumes), and [restart policies](https://docs.railway.com/deployments/restart-policy).
