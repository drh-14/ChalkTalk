# vm-bootstrap Specification

## Purpose

Prepare ChalkTalk's already-provisioned Ubuntu VM repeatably through a manually initiated, secret-aware setup workflow without starting the application.

## Requirements

### Requirement: Explicit manual bootstrap
The manual VM-bootstrap job SHALL bind to the GitHub Actions environment named `production`. It SHALL read exactly `DOMAIN`, `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, and `SUPABASE_STORAGE_REGION` from Actions environment variables (`vars.*`). It SHALL read SSH identity, VM address and pinned host key, database URL, Supabase Storage access keys, auth token secret, Resend API key, `METRICS_TOKEN`, and `GRAFANA_ADMIN_PASSWORD` from Actions environment secrets (`secrets.*`). It SHALL retain its existing main-only dispatch, input preflight, and fixed SSH port 22 behavior.

#### Scenario: Nonsecret Storage configuration
- **WHEN** the `production` environment has Storage endpoint, bucket, and region variables and the required secrets
- **THEN** bootstrap passes those values to the existing validation and env render without requiring duplicate Storage metadata secrets

#### Scenario: Missing Storage configuration
- **WHEN** a required Storage metadata variable is absent
- **THEN** preflight fails before connecting to the VM or replacing its production env file

#### Scenario: Missing production secret
- **WHEN** the workflow is manually started without a required Actions secret
- **THEN** it fails without connecting to or changing the VM

#### Scenario: Wrong host identity
- **WHEN** the VM presents a host key different from the pinned, independently verified port-22 key
- **THEN** SSH fails without disabling host-key checking

### Requirement: Safe and idempotent host setup

The playbook SHALL require supported Ubuntu and passwordless noninteractive sudo before host changes. It SHALL install Docker Engine, the Compose plugin, Git, and UFW; prepare separate release and shared secret directories; allow SSH TCP port 22 before enabling UFW; and allow TCP 80/443 and UDP 443. Before changing firewall rules and again before enabling UFW, it SHALL reject existing UFW user rules other than global allows for TCP 22/80/443 and UDP 443, without deleting any rules. It SHALL not start application containers, migrate data, or change Supabase resources. Repeating a successful run SHALL preserve the same configuration.

#### Scenario: Unavailable privilege escalation

- **WHEN** `ubuntu` cannot use noninteractive sudo
- **THEN** setup stops before package or firewall changes

#### Scenario: Safe firewall order

- **WHEN** the firewall is enabled
- **THEN** SSH port 22 has already been allowed, and the workflow verifies a fresh SSH connection

#### Scenario: Conflicting existing firewall rule

- **WHEN** UFW has an existing deny, scoped allow, or allow for another port
- **THEN** setup stops before changing firewall rules or enabling UFW and leaves reconciliation to the operator

#### Scenario: Repeat setup

- **WHEN** setup runs again with unchanged variables and host state
- **THEN** it succeeds without changing the configured files or rules

### Requirement: Protected shared production configuration

The playbook SHALL validate all required production variables before replacing either environment file. `DOMAIN` SHALL be a qualified DNS name of at least two dot-separated labels, each 1–63 characters and containing only ASCII letters, digits, or interior hyphens, with a total length of at most 253 characters. `METRICS_TOKEN` and `GRAFANA_ADMIN_PASSWORD` SHALL each contain at least 32 characters. The playbook SHALL atomically render `/srv/chalktalk/shared/production.env` and `/srv/chalktalk/shared/grafana.env`, each owned by `ubuntu` with mode `0600` inside an owner-only `0700` directory, and SHALL suppress secret values from logs and diffs. It SHALL obtain secrets from the controller environment rather than command-line arguments or committed files. The Storage endpoint, bucket, region, access key ID, and secret access key SHALL be named `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_ACCESS_KEY_ID`, and `SUPABASE_STORAGE_SECRET_ACCESS_KEY` in both Actions settings and `production.env`, with no `S3_*` aliases. `METRICS_TOKEN` SHALL be rendered only into `production.env`, and `GRAFANA_ADMIN_PASSWORD` only into `grafana.env`; the playbook SHALL NOT start monitoring services.

#### Scenario: Incomplete variables

- **WHEN** a required variable is absent or invalid
- **THEN** setup fails without replacing an existing production environment file or revealing its contents

#### Scenario: Prepared release host

- **WHEN** setup succeeds
- **THEN** Docker and Compose work, the firewall rules are in place, and the shared environment file has the expected ownership, permissions, and Supabase Storage key names
