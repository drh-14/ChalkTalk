## MODIFIED Requirements

### Requirement: Explicit manual bootstrap
The manual VM-bootstrap job SHALL bind to the GitHub Actions environment named `production`. It SHALL read exactly `DOMAIN`, `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, and `SUPABASE_STORAGE_REGION` from Actions environment variables (`vars.*`). It SHALL read SSH identity, VM address and pinned host key, database URL, Supabase Storage access keys, auth token secret, and Resend API key from Actions environment secrets (`secrets.*`). It SHALL retain its existing main-only dispatch, input preflight, and fixed SSH port 22 behavior.

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
