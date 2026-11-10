## 1. Specification and tests

- [x] 1.1 Validate OpenSpec artifacts and record the agreed VM-bootstrap contract.
- [x] 1.2 Write failing tests of the workflow/Ansible executable seams: missing inputs, safe env rendering, Compose shared-path semantics, and firewall ordering.

## 2. Workflow and host setup

- [x] 2.1 Add the manual Actions workflow, pinned tooling, secret preflight, trusted host-key setup and concurrency policy.
- [x] 2.2 Add the Ansible playbook, collection requirements, protected env template and verification tasks.
- [x] 2.3 Add a standalone Ansible guide for manual Supabase preflight, shared env path, Actions secret setup and future Compose commands.

## 3. Verification and delivery

- [x] 3.1 Run actionlint, Ansible syntax/lint, fixture-based render/Compose checks, formatting, and repository checks.
- [x] 3.2 Record that a live VM run is pending operator-supplied Actions secrets, pinned host key and connection settings; do not run UFW on the CI runner.
- [x] 3.3 Archive the verified OpenSpec behavior.
- [ ] 3.4 Run no-mistakes and publish a one-commit draft PR with final-head CI checks.
