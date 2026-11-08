# Bootstrap the production VM

This is a **manual VM setup workflow**, separate from deploying ChalkTalk. It prepares the already-provisioned OVHcloud Ubuntu VM but does **not** clone the app, run migrations, build images, or start Docker Compose. It can be invoked through GitHub Actions only after this workflow has merged to the default `main` branch. Before that, its offline tests and syntax checks can run in a PR, but the live VM setup is pending.

## Configure GitHub

Set these **repository Actions secrets** (Settings → Secrets and variables → Actions → Secrets). Do not commit their values or paste them in an issue or chat:

| Secret                                     | Purpose                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `SSH_PRIVATE_KEY`                          | Private key whose public half is already authorized for the VM's `ubuntu` account. |
| `DATABASE_URL`                             | Supabase direct or session-pooler PostgreSQL URL with explicit TLS mode.           |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Supabase Storage server-side S3 credentials.                                       |
| `AUTH_TOKEN_SECRET`                        | Independent random signing secret of at least 32 characters.                       |
| `RESEND_API_KEY`                           | Sending-only Resend HTTPS key.                                                     |

Set these **repository Actions variables**:

| Variable                                | Purpose                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VM_HOST`                               | VM DNS name or IP address.                                                                                                                                                                                       |
| `VM_SSH_PORT`                           | SSH TCP port (normally `22`).                                                                                                                                                                                    |
| `VM_KNOWN_HOSTS`                        | One SSH known-hosts line containing the VM's _independently verified_ host key. For a non-22 port, the first field must be `[host]:port`. Do not fill it from an unchecked `ssh-keyscan` result in the workflow. |
| `DOMAIN`                                | Public domain (for example `joinchalktalk.com`, no scheme).                                                                                                                                                      |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION` | Supabase private Storage S3 settings.                                                                                                                                                                            |

To establish `VM_KNOWN_HOSTS`, compare the SSH server-key fingerprint against an independent trusted observation (for example the OVHcloud console). Only then place the corresponding public host key line in the variable. This key is the **server's** key, not the `ubuntu` login key. If host identity changes intentionally, reverify it before changing the variable.

Before the first app deployment, manually create the Supabase project and **private** Storage bucket and disable the Supabase Data API. ChalkTalk's application migrations use `public` tables and do not rely on Data API RLS. The playbook cannot verify that dashboard setting and does not initialize Supabase. Configure the verified Resend sender separately.

## Run and inspect

1. Confirm the `ubuntu` account can use `sudo -n true` and the configured SSH key/port. Have OVHcloud console access available in case host firewall settings need recovery. Confirm the OVHcloud network firewall also permits the SSH port and web traffic; it is separate from UFW.
2. After merging this workflow to `main`, open **Actions → Bootstrap production VM → Run workflow** and select `main`. Other refs are rejected. The workflow validates required values and pinned SSH identity before connecting.
3. The playbook installs Git, UFW, Docker Engine and Compose plugin from Docker's signed Ubuntu repository; prepares `/srv/chalktalk/releases` and `/srv/chalktalk/shared`; allows SSH before enabling UFW; permits TCP 80/443 and UDP 443; verifies a fresh SSH connection, Docker/Compose, firewall and env-file permissions; and reports whether a reboot is pending. It does not reboot automatically.
4. On success, `/srv/chalktalk/shared/production.env` is owned by `ubuntu`, mode `0600`, in an owner-only `0700` directory. The workflow renders it atomically from Actions secrets and variables, suppressing values in Ansible logs. Rerun bootstrap after rotating a secret; a separate app restart is still needed to consume it.

A later release checkout should live under `/srv/chalktalk/releases`. Its deployment command must pass the stable env path both for interpolation and for Compose's service `env_file`, for example:

```sh
export COMPOSE_ENV_FILE=/srv/chalktalk/shared/production.env
COMPOSE_FILE=/srv/chalktalk/releases/YOUR_SHA/deployment/production/compose.yml
docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" config --quiet
# Then build/up only after the managed-service and published-port checks pass.
```

Do **not** use unredacted `docker compose config` in logs: it can print secrets. Docker-published container ports may bypass UFW's host-input rules. The later deployment must ensure only the web gateway publishes TCP 80/443 and UDP 443; API and collaboration ports must not be published. The OVHcloud network firewall is an additional independent control.

## Offline validation

A separate, secret-free PR workflow runs these checks automatically. To reproduce on a trusted development machine with Python 3.12+, Docker Compose, and `actionlint`:

```sh
python -m pip install -r deployment/ansible/requirements-dev.txt
ansible-galaxy collection install -r deployment/ansible/collections/requirements.yml
python -m unittest discover -s deployment/ansible/tests -v
ansible-playbook -i 'chalktalk,' deployment/ansible/bootstrap.yml --syntax-check
ansible-lint deployment/ansible/bootstrap.yml deployment/ansible/tests/render-env.yml
actionlint .github/workflows/vm-bootstrap.yml .github/workflows/vm-bootstrap-verify.yml
```

`--syntax-check` does not modify the local host or VM. Do not run the full bootstrap playbook against localhost. The first real VM run remains pending your secret/variable configuration and a manually initiated workflow after merge.
