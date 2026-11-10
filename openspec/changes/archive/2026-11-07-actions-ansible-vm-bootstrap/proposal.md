## Why

The production Compose stack needs a repeatable way to prepare the already-provisioned OVHcloud Ubuntu VM without relying on a teammate's laptop or hand-run package and firewall commands.

## What Changes

- Add a manually dispatched GitHub Actions workflow that runs an Ansible VM-bootstrap playbook through pinned SSH host-key verification.
- Install Docker Engine, Compose, Git and UFW; create stable release and secret directories; render a restricted production environment file from GitHub Actions secrets; and configure only the intended host firewall ports.
- Keep production secrets in individual Actions secrets, never in the repository or playbook command line. The workflow refuses to connect until all required secrets and variables are supplied.
- Document manual Supabase prerequisites and the future release workflow's shared environment-file contract in a standalone Ansible guide.

## Capabilities

### New Capabilities

- `vm-bootstrap`: Manual, repeatable setup of the single Ubuntu VM through Actions and Ansible.

## Impact

New workflow and Ansible configuration under `.github/workflows/` and `deployment/ansible/`. No application runtime behavior, schema, Supabase resources, or UI changes.
