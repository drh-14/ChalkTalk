# Bootstrap the production VM

This is a **manual VM setup workflow**, separate from deploying ChalkTalk. It prepares the already-provisioned OVHcloud Ubuntu VM but does **not** clone the app, run migrations, build images, or start Docker Compose. It can be invoked through GitHub Actions only after this workflow has merged to the default `main` branch. Before that, its offline tests and syntax checks can run in a PR, but the live VM setup is pending.

## Configure GitHub

Create a GitHub Actions environment named **`production`** (Settings → Environments). This workflow uses it without required reviewers; manual `workflow_dispatch` from `main` remains the initiation control. Add the following as **environment secrets**, not repository secrets. If same-named repository secrets or variables already exist, remove them after moving values so missing environment values cannot silently fall back to repository scope. Do not commit values or paste them in an issue or chat:

| Environment secret                                                     | Purpose                                                                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SSH_PRIVATE_KEY`                                                      | Private key whose public half is already authorized for the VM's `ubuntu` account.                                                     |
| `VM_HOST`                                                              | VM DNS name or IPv4 address.                                                                                                           |
| `VM_KNOWN_HOSTS`                                                       | One independently verified SSH server host-key line. The first field must match `VM_HOST` for port 22, without `[host]:port` brackets. |
| `DATABASE_URL`                                                         | Supabase direct or session-pooler PostgreSQL URL with explicit TLS mode.                                                               |
| `SUPABASE_STORAGE_ACCESS_KEY_ID`, `SUPABASE_STORAGE_SECRET_ACCESS_KEY` | Supabase Storage server-side S3 credentials.                                                                                           |
| `AUTH_TOKEN_SECRET`                                                    | Independent random secret of at least 32 characters used to HMAC-hash and verify opaque authentication-related tokens.                 |
| `RESEND_API_KEY`                                                       | Sending-only Resend HTTPS key.                                                                                                         |

Add these four unencrypted **production environment variables**:

| Environment variable        | Purpose                                                 |
| --------------------------- | ------------------------------------------------------- |
| `DOMAIN`                    | Public DNS name (2+ labels; no scheme or trailing dot). |
| `SUPABASE_STORAGE_ENDPOINT` | Supabase Storage S3 endpoint URL.                       |
| `SUPABASE_STORAGE_BUCKET`   | Name of the private Storage bucket.                     |
| `SUPABASE_STORAGE_REGION`   | Supabase Storage S3 region.                             |

To establish `VM_KNOWN_HOSTS`, compare the SSH server-key fingerprint against an independent trusted observation (for example the OVHcloud console). Only then place the corresponding public host key line in the environment secret. This key is the **server's** key, not the `ubuntu` login key. If host identity changes intentionally, reverify it before changing the variable.

For managed-service and sender prerequisites before deploying the app, follow the [Compose deployment guide](../README.md). The playbook does not initialize Supabase or start the app.

## Run and inspect

1. Confirm the `ubuntu` account can use `sudo -n true` and the configured SSH key on port 22. Have OVHcloud console access available in case host firewall settings need recovery. Confirm the OVHcloud network firewall also permits SSH TCP 22 and web traffic; it is separate from UFW. Bootstrap rejects existing UFW user rules other than global allows for TCP 22/80/443 and UDP 443; inspect `sudo ufw show added` and reconcile any other rules through the VM console before running it. Bootstrap does not delete existing rules.
2. After merging this workflow to `main`, open **Actions → Bootstrap production VM → Run workflow** and select `main`. Other refs are rejected. The workflow validates required values and the pinned host-key entry before connecting; SSH verifies the VM's identity during connection.
3. The playbook installs Git, UFW, Docker Engine and Compose plugin from Docker's signed Ubuntu repository; prepares `/srv/chalktalk/releases` and `/srv/chalktalk/shared`; allows SSH before enabling UFW; permits TCP 80/443 and UDP 443; verifies a fresh SSH connection, Docker/Compose, firewall and env-file permissions; and reports whether a reboot is pending. It does not reboot automatically.
4. On success, `/srv/chalktalk/shared/production.env` is owned by `ubuntu`, mode `0600`, in an owner-only `0700` directory. The workflow renders it atomically from Actions secrets and variables, suppressing values in Ansible logs. Rerun bootstrap after rotating a secret; it does not restart the app to consume the new value.

A later release checkout should live under `/srv/chalktalk/releases`. For application deployment commands, see the [production deployment guide](../README.md); when using bootstrap, replace its manual `deployment/production/.env` path with `/srv/chalktalk/shared/production.env` in each `--env-file` command. Bootstrap does not configure Compose to use this file automatically.

Do **not** use unredacted `docker compose config` in logs: it can print secrets. Docker-published container ports may bypass UFW's host-input rules. The later deployment must ensure only the web gateway publishes TCP 80/443 and UDP 443; API and collaboration ports must not be published. The OVHcloud network firewall is an additional independent control.

## Offline validation

A separate, secret-free PR workflow runs these checks automatically. To reproduce on a trusted development machine with Python 3.12+, Docker Compose, and `actionlint`:

```sh
python -m pip install -r deployment/production/ansible/requirements-dev.txt
ansible-galaxy collection install -r deployment/production/ansible/collections/requirements.yml
python -m unittest discover -s deployment/production/ansible/tests -v
ansible-playbook -i 'chalktalk,' deployment/production/ansible/bootstrap.yml --syntax-check
ansible-lint deployment/production/ansible/bootstrap.yml deployment/production/ansible/tests/render-env.yml
actionlint .github/workflows/vm-bootstrap.yml .github/workflows/vm-bootstrap-verify.yml
```

`--syntax-check` does not modify the local host or VM. Do not run the full bootstrap playbook against localhost. The first real VM run remains pending your secret/variable configuration and a manually initiated workflow after merge.
