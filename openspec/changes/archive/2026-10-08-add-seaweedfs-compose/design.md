## Context

The unprofiled Compose stack runs PostgreSQL and Mailpit. The API does not yet use object storage. See `proposal.md` for the motivation and `specs/local-object-storage/spec.md` for the observable requirements.

## Goals / Non-Goals

**Goals:** Start one local SeaweedFS S3 service with persistent data and a host endpoint during ordinary Compose startup.

**Non-Goals:** Connect the ChalkTalk API to object storage, provision buckets for a feature, or create a production storage deployment.

## Decisions

### Use the upstream single-node image

Use `chrislusf/seaweedfs:4.48` with its `mini` command and `/data` volume. Upstream documents this as the single-container S3 path. Separate master, volume, filer, and S3 services would add startup coordination without serving the requested local use case. Pinning a release avoids unplanned image upgrades.

### Publish only the S3 port on loopback

Map container port 8333 to `127.0.0.1:8333` so host tools can use S3 while avoiding a network-facing development endpoint. Other SeaweedFS interfaces remain on the Compose network.

### Use configurable development credentials

Map the SeaweedFS-specific host variables `SEAWEEDFS_ACCESS_KEY_ID` and `SEAWEEDFS_SECRET_ACCESS_KEY` to the container's `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, with local-only fallback values. Document the host override variables in `.env.example`; developers can set their own values in ignored `.env`. Ambient AWS account credentials do not override the local pair. The same credentials work for direct host clients and future Compose clients.

## Risks / Trade-offs

- [The default Compose stack gains another container and image pull] → Use one upstream image and keep application containers in their existing opt-in profile.
- [The single-node store is not resilient to loss of its Docker volume] → Treat it as local development storage and document that `down --volumes` deletes data.
- [Fallback credentials are public development values] → Bind the host port to loopback and clearly label the defaults as local-only.

## Migration Plan

Run `docker compose up -d` to pull and start the added service. Existing PostgreSQL data remains untouched. `docker compose down` keeps the SeaweedFS named volume; `docker compose down --volumes` removes it.
