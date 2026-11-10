## MODIFIED Requirements

### Requirement: Explicit manual bootstrap

The VM-bootstrap workflow SHALL run only on explicit manual dispatch from the trusted default branch. The job SHALL bind to the GitHub `production` environment without required reviewers. It SHALL read `DOMAIN` from that environment's unencrypted variable and all other inputs from its secrets. It SHALL fail before connecting when any required secret or `DOMAIN`, SSH private key, host address, or pinned port-22 host key is missing. It SHALL reject a non-main dispatch ref, keep concurrent runs serialized, and use read-only repository token permissions. It SHALL use SSH port 22 without a configurable `VM_SSH_PORT` input.

#### Scenario: Missing production secret

- **WHEN** the workflow is manually started without a required Actions secret
- **THEN** it fails without connecting to or changing the VM

#### Scenario: Wrong host identity

- **WHEN** the VM presents a host key different from the pinned, independently verified port-22 key
- **THEN** SSH fails without disabling host-key checking

### Requirement: Safe and idempotent host setup

The playbook SHALL require supported Ubuntu and passwordless noninteractive sudo before host changes. It SHALL install Docker Engine, the Compose plugin, Git, and UFW; prepare separate release and shared secret directories; allow SSH TCP port 22 before enabling UFW; and allow TCP 80/443 and UDP 443. It SHALL not start application containers, migrate data, or change Supabase resources. Repeating a successful run SHALL preserve the same configuration.

#### Scenario: Unavailable privilege escalation

- **WHEN** `ubuntu` cannot use noninteractive sudo
- **THEN** setup stops before package or firewall changes

#### Scenario: Safe firewall order

- **WHEN** the firewall is enabled
- **THEN** SSH port 22 has already been allowed, and the workflow verifies a fresh SSH connection

#### Scenario: Repeat setup

- **WHEN** setup runs again with unchanged variables and host state
- **THEN** it succeeds without changing the configured files or rules

### Requirement: Protected shared production configuration

The playbook SHALL validate all required production variables before replacing an existing environment file. It SHALL atomically render `/srv/chalktalk/shared/production.env` owned by `ubuntu` with mode `0600` inside an owner-only `0700` directory, and SHALL suppress secret values from logs and diffs. It SHALL obtain secrets from the controller environment rather than command-line arguments or committed files. The Storage endpoint, bucket, region, access key ID, and secret access key SHALL be named `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_ACCESS_KEY_ID`, and `SUPABASE_STORAGE_SECRET_ACCESS_KEY` in both Actions settings and the rendered file, with no `S3_*` aliases.

#### Scenario: Incomplete variables

- **WHEN** a required variable is absent or invalid
- **THEN** setup fails without replacing an existing production environment file or revealing its contents

#### Scenario: Prepared release host

- **WHEN** setup succeeds
- **THEN** Docker and Compose work, the firewall rules are in place, and the shared environment file has the expected ownership, permissions, and Supabase Storage key names
