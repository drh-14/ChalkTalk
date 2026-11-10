## Context

Production Compose is defined on the draft deployment branch. It can already accept an absolute `COMPOSE_ENV_FILE`, but its current guide places `.env` inside a release checkout. The VM exists and accepts the `ubuntu` SSH key. The operator manually provisions Supabase and verifies the Data API is disabled.

## Goals / Non-Goals

**Goals:** A manual, repeatable Actions-to-VM setup; pinned SSH host identity; fail-before-change secret/sudo checks; owner-only shared env; safe firewall ordering; no laptop-specific setup.

**Non-Goals:** Creating Supabase resources, starting Compose, running migrations, building releases, backing up data, or adding observability.

## Decisions

- Keep setup distinct from routine release deployment. `workflow_dispatch` checks out trusted `main`, has read-only token permissions, and serializes runs. Repository-level secrets are the accepted pilot model, without environment reviewer approval.
- The workflow uses the existing `SSH_PRIVATE_KEY` secret, individual database, Storage, Resend and auth secrets, and a pinned host key from an independent operator observation. Ansible reads secrets from the controller environment, not command-line arguments or committed files.
- The playbook uses `ubuntu` and requires `sudo -n true`. It installs Docker packages from Docker's signed Ubuntu repository, Git, and UFW; allows the configured SSH port before enabling UFW; and verifies a new SSH connection afterward.
- Keep `/srv/chalktalk/releases` separate from `/srv/chalktalk/shared/production.env`, with the shared directory mode `0700` and file mode `0600`. Validate before atomic replacement and set `no_log` on secret-bearing tasks. Later deployments pass the shared path through both Compose mechanisms.

## Risks / Trade-offs

- Actions secrets are not committed, but are available in runner memory and the VM's plaintext environment file during setup. Repository writers able to change trusted workflow code can use repository secrets; branch protection and write-access discipline matter because the user chose no environment reviewer.
- UFW alone does not protect Docker-published ports. The later release workflow must reject Compose models that publish anything beyond web TCP 80/443 and UDP 443; OVHcloud's network firewall is separately configured.
- First live VM run needs operator-supplied Actions secrets, host key, address and port. No live UFW mutation will run on GitHub's test runner. Do not reboot automatically; report pending reboot.
