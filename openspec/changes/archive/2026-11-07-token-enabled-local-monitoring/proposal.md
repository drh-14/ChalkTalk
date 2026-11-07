# Enable optional local monitoring by its token

## Why

The observability switch duplicates the presence of a protected metrics credential. Production does not include a monitoring stack, while local operators still need an optional profile.

## What Changes

Remove `OBSERVABILITY_ENABLED` from configuration and templates. Enable metrics and sanitized event spooling only when a valid `METRICS_TOKEN` is configured. Keep the local observability Compose profile; production supplies no token or monitoring services.
