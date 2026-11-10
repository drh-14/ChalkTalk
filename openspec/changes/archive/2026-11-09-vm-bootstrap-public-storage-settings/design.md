# Design

Change only the GitHub expression source for three nonsecret Storage settings from `secrets.*` to `vars.*`. The job remains attached to `environment: production`, and its shell/Ansible environment contract remains unchanged. Update the operator table so exactly four entries are variables. GitHub can fall back to repository-scoped values with the same name; document manual removal of those entries rather than adding a privileged API provenance check.
