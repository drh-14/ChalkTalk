## REMOVED Requirements

### Requirement: Single-VM deployment topology

The Railway deployment replaces the single-VM Compose deployment stack.

### Requirement: HTTPS and same-origin routing

Railway terminates TLS; the Railway gateway serves the same-origin routes over internal HTTP.

### Requirement: Email and storage configuration

Production email uses Resend HTTPS, and Railway hosts private managed PostgreSQL and persistent SeaweedFS rather than the VM Compose stack.
