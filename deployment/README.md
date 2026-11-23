# ChalkTalk deployment setups

- [Local development](local/README.md): independently bundled/external PostgreSQL and S3-compatible storage, with explicit Resend, SendGrid, or SES HTTPS email. See the guide for setup and startup.
- [Single-VM production](production/README.md): frontend, API, collaboration, and worker containers backed by Supabase PostgreSQL/Storage and Resend.
- [Production VM bootstrap](production/ansible/README.md): the Ansible playbook and manual GitHub Actions setup workflow.

There is no custom production flag. The production images set `NODE_ENV=production`; the two setups have separate Compose and environment files. For VM bootstrap and automatic deployment after successful current-`main` CI, follow the [production guide](production/README.md).
